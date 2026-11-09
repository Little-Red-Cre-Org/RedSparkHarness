/** Native permission presets seed a fresh Session with its standing permission facts. */
import { describe, expect, it } from 'vitest'
import { SessionSeq } from '@redspark/rsh-session/native'
import type { SessionEvent } from '@redspark/rsh-session/native'
import type { NativeActiveSessionOwner } from '@redspark/rsh-native-session-execution'
import { plugin } from '../src/native.ts'

/** The smallest owner a seeding observer touches: durable reads, appends, and a flush. */
function owner(events: SessionEvent[], mode = 'workspace-write', policy = 'ask') {
  const log = [...events]
  const sessions = { header: { cwd: '/w' } }
  const record = {
    invocation: 'root' as const,
    writerAvailable: true,
    session: sessions,
    readEvents: async () => [...log],
    append: (type: string, data: unknown) => {
      log.push({ type, seq: SessionSeq(log.length), time: 0, data } as SessionEvent)
      return log.at(-1) as SessionEvent
    },
    flush: async () => undefined,
  }
  return { owner: record as unknown as NativeActiveSessionOwner, log, mode, policy }
}

/** Install the plugin against a stub service surface and return the seeding observer. */
function install(seedMode = 'workspace-write', seedPolicy = 'ask') {
  const observers: ((owner: NativeActiveSessionOwner) => Promise<void>)[] = []
  const context = {
    require: (name: string) => {
      if (name === 'activeSessions') {
        return {
          owner: () => undefined,
          onAttached: (observer: (owner: NativeActiveSessionOwner) => Promise<void>) => {
            observers.push(observer)
            return () => Promise.resolve()
          },
        }
      }
      if (name === 'agents') return { get: () => undefined }
      if (name === 'sandboxPolicy') return { resolve: () => ({ mode: seedMode, workspaceRoot: '/w' }) }
      if (name === 'approval') return { policy: seedPolicy }
      throw new Error('unexpected service ' + name)
    },
    effect: (disposer: () => Promise<void>) => disposer,
    provide: () => undefined,
  }
  const resolved = plugin.resolve({}) as unknown as (context: unknown) => void
  resolved(context)
  return observers
}

describe('native permission presets', () => {
  it('seeds permission/preset, sandbox/mode and approval/policy on a fresh Session', async () => {
    const observers = install()
    const { owner: live, log } = owner([])
    for (const observer of observers) await observer(live)
    expect(log.map(event => event.type).slice(0, 3)).toEqual(['permission/preset', 'sandbox/mode', 'approval/policy'])
    expect(log[1]).toMatchObject({ data: { mode: 'workspace-write' } })
    expect(log[2]).toMatchObject({ data: { policy: 'ask' } })
  })

  it('appends nothing when the Session already logged every permission fact', async () => {
    const observers = install()
    const existing = [
      { type: 'permission/preset', seq: SessionSeq(0), time: 0, data: { preset: 'workspace-write' } },
      { type: 'sandbox/mode', seq: SessionSeq(1), time: 0, data: { mode: 'workspace-write' } },
      { type: 'approval/policy', seq: SessionSeq(2), time: 0, data: { policy: 'ask' } },
    ] as SessionEvent[]
    const { owner: live, log } = owner(existing)
    for (const observer of observers) await observer(live)
    expect(log).toHaveLength(3)
  })

  it('fills only the missing facts of a partially initialized Session', async () => {
    const observers = install('danger-full-access', 'never')
    const existing = [
      { type: 'sandbox/mode', seq: SessionSeq(0), time: 0, data: { mode: 'workspace-write' } },
    ] as SessionEvent[]
    const { owner: live, log } = owner(existing)
    for (const observer of observers) await observer(live)
    // The logged sandbox mode outranks the deployment default, so the pair no longer
    // matches a preset and no permission/preset is invented; the missing approval is filled.
    expect(log.filter(event => event.type === 'sandbox/mode')).toHaveLength(1)
    expect(log.filter(event => event.type === 'permission/preset')).toHaveLength(0)
    expect(log.filter(event => event.type === 'approval/policy')).toHaveLength(1)
    expect(log.at(-1)).toMatchObject({ type: 'approval/policy', data: { policy: 'never' } })
  })
})
