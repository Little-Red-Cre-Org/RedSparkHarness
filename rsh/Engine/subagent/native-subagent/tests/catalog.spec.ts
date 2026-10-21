import { expect, it, vi } from 'vitest'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import type { NativeSessionContinuations, NativeSessionDelegation } from '@deepseek-ai/dsh-native-session-execution'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent-protocol'
import { NativeSubagentContinuations } from '../src/continuation.ts'
import { NativeSpawnSubagents, type NativeSubagentRequest } from '../src/index.ts'

it('reports a finished-listener failure and continues without changing the settled child result', async () => {
  const parent = { scope: {} } as NativeAgent
  const session = { id: SessionId('parent') } as Session
  const result: unknown[] = []
  const failure = new Error('observer failed')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const execution = { delegate: async (_agent: NativeAgent, _session: Session, request: NativeSessionDelegation) => {
    request.onEvent?.({ type: 'turn/end', data: { reason: { kind: 'completed' } } } as SessionEvent)
    return { exitCode: 0 }
  } }
  const activeSessions = { onDetached: () => async () => {} }
  const context = { signal: new AbortController().signal, require: (name: string) => name === 'activeSessions' ? activeSessions : execution,
    optional: () => undefined } as unknown as NativeContext
  const provider = new NativeSpawnSubagents(context, 'spawn')
  const request: NativeSubagentRequest = { agent: parent, session, label: 'child', prompt: [], maxDepth: 1,
    routeOverrides: {},
    config: { cwd: '/selected', provider: 'model', model: 'test', systemPrompt: '', maxSteps: 1, builtinTools: false } }
  provider.onFinished(() => { throw failure })
  provider.onFinished(async () => { throw failure })
  provider.onFinished((finished) => { result.push(finished.result) })

  await expect(provider.run(request, new AbortController().signal)).resolves.toMatchObject({ stopReason: 'completed' })
  await vi.waitFor(() => { expect(warn).toHaveBeenCalledTimes(2) })
  expect(result).toEqual([expect.objectContaining({ stopReason: 'completed' })])
  expect(warn).toHaveBeenNthCalledWith(1, 'native-subagent: finished observer failed', failure)
  expect(warn).toHaveBeenNthCalledWith(2, 'native-subagent: finished observer failed', failure)
  await provider.dispose()
  warn.mockRestore()
})

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
  const provider = new NativeSubagentContinuations(context, 'spawn', () => {}, () => {})
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
