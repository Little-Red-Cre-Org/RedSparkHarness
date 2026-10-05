import { expect, it } from 'vitest'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import type { NativeSessionContinuations } from '@deepseek-ai/dsh-native-session-execution'
import { SessionId, type Session } from '@deepseek-ai/dsh-session/native'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent-protocol'
import { NativeSubagentContinuations } from '../src/continuation.ts'

it('lists only selected continuable descriptors and preserves per-item diagnostics', async () => {
  const parentId = SessionId('parent')
  const oneShot = SessionId('one-shot')
  const child = SessionId('child')
  const damaged = SessionId('damaged')
  const unsupported = SessionId('unsupported')
  const session = { id: parentId, header: { cwd: '/selected' } } as Session
  const agent = { scope: {} } as NativeAgent
  const signal = new AbortController().signal
  const descriptor = (id: string, data: unknown) => ({ header: { id, cwd: '/selected' }, inheritedEventCount: 0,
    events: [{ type: 'subagent/descriptor', data }], defaults: {} })
  const candidates = [
    { path: [oneShot] as const, status: 'ready' as const },
    { path: [oneShot, child] as const, status: 'idle' as const },
    { path: [damaged] as const, status: 'ready' as const },
    { path: [unsupported] as const, status: 'ready' as const },
  ]
  const operations = {
    catalog: async (scope: string) => scope === 'children' ? candidates.filter(row => row.path.length === 1) : candidates,
    inspect: async (path: readonly SessionId[]) => {
      const id = path[path.length - 1]
      if (id === unsupported) return { kind: 'diagnostic', id, reason: 'unsupported' }
      const data = id === oneShot ? snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'spawn' })
        : id === child ? snapshotSubagentDescriptor({ mode: 'continuable', provider: 'spawn', label: 'Nested' })
          : { version: 3, mode: 'continuable', provider: 'spawn', label: 1 }
      return { kind: 'child', observation: descriptor(id!, data) }
    },
  } as unknown as NativeSessionContinuations
  const context = { signal, scope: { contains: () => true }, require: () => ({
    configuration: () => ({}), continuations: () => operations,
  }) } as unknown as NativeContext
  const provider = new NativeSubagentContinuations(context, 'spawn', () => {})
  expect(await provider.list(agent, session, 'children', signal)).toEqual([
    { kind: 'diagnostic', id: damaged, reason: 'corrupt' },
    { kind: 'diagnostic', id: unsupported, reason: 'unsupported' },
  ])
  expect(await provider.list(agent, session, 'descendants', signal)).toEqual([
    { kind: 'child', id: child, label: 'Nested', status: 'idle', parent: oneShot, depth: 2 },
    { kind: 'diagnostic', id: damaged, reason: 'corrupt', parent: parentId, depth: 1 },
    { kind: 'diagnostic', id: unsupported, reason: 'unsupported', parent: parentId, depth: 1 },
  ])
})
