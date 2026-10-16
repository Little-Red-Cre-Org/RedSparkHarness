import { expect, it, vi } from 'vitest'
import { NativeAgentId, NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import { NativeSessionExecutionRegistry, type NativeSessionContinuations, type NativeSessionDelegation } from '@deepseek-ai/dsh-native-session-execution'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import {
  SUBAGENT_DESCRIPTOR_VERSION,
  snapshotSubagentDescriptor,
  type SubagentDelegationContext,
} from '@deepseek-ai/dsh-subagent-protocol'
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
  const session = { id: parentId, header: { cwd: '/selected', delegationDepth: 2 } } as Session
  const agent = { scope: {} } as NativeAgent
  const signal = new AbortController().signal
  const descriptor = (path: readonly SessionId[], data: unknown) => ({ header: { id: path.at(-1), cwd: '/selected',
    parentSession: path.length === 1 ? parentId : path.at(-2), delegationDepth: 2 + path.length }, inheritedEventCount: 0,
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
        : id === child ? { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable', provider: 'spawn', label: 'Nested' }
          : { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable', provider: 'spawn', label: 1 }
      return { kind: 'child', observation: descriptor(path, data), parentDepth: 2 + path.length - 1 }
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

it('persists and cold-resumes inherited context from the exact owner without a transient caller context', async () => {
  const parentId = SessionId('parent')
  const parent = { id: NativeAgentId(parentId), scope: new NativeScope() } as NativeAgent
  const session = Session.create(parentId, undefined, {
    version: SESSION_FORMAT_VERSION, id: parentId, createdAt: 0, isSeeded: false,
    cwd: '/selected', delegationDepth: 0,
  })
  const signal = new AbortController().signal
  const stored: SubagentDelegationContext = {
    depth: 2, maxDepth: 5, cwd: '/selected', provider: 'parent-provider', model: 'parent-model',
    maxSteps: 8, maxTokens: 200, toolNames: ['read', 'write'], builtinToolNames: ['read'], programToolNames: ['lookup'],
  }
  const events: SessionEvent[] = []
  const opened: unknown[] = []
  const childAgent = { scope: {} } as NativeAgent
  const operations = {
    observe: async (id: SessionId) => ({ header: { id, parentSession: parentId, cwd: '/selected', delegationDepth: 3 },
      events, inheritedEventCount: 0, defaults: {
        cwd: '/selected', provider: 'fallback-provider', model: 'fallback-model', maxSteps: 10, maxTokens: 100,
        builtinTools: false, systemPrompt: '',
      } }),
    open: async (request: unknown) => {
      opened.push(request)
      const id = (request as { id: SessionId }).id
      return { id, agent: childAgent, isClosing: true, done: Promise.resolve(),
        enqueue: async () => 'accepted', dispose: async () => {}, interrupt: () => {}, retainChild: () => () => {} }
    },
    maintenance: async (_id: SessionId, operation: (owner: { append: (type: string, data: unknown) => void
      flush: () => Promise<void> }, admitted: AbortSignal) => Promise<unknown>, admitted: AbortSignal) => operation({
      append: (type, data) => { events.push({ type, data } as SessionEvent) }, flush: async () => {},
    }, admitted),
  } as unknown as NativeSessionContinuations
  const agents = new NativeAgentRegistry({ emit() {} })
  const releaseAgent = agents.register(parent)
  const execution = new NativeSessionExecutionRegistry(agents)
  let releaseOwner = execution.register({ agent: parent, session,
    config: { cwd: '/selected', provider: 'current-provider', model: 'current-model', systemPrompt: '', maxSteps: 6, maxTokens: 80 },
    delegationAuthority: { toolNames: ['read'], programToolNames: [], builtinToolNames: ['read'], approvalRequired: false },
    continuations: operations,
    delegate: async () => ({ exitCode: 0 }),
  })
  const activeSessions = { onDetached: () => async () => {} }
  const context = { signal, scope: { contains: () => true }, require: (name: string) => name === 'activeSessions' ? activeSessions : execution,
    optional: () => undefined } as unknown as NativeContext
  const provider = new NativeSubagentContinuations(context, 'spawn', () => {}, () => {})
  const request: NativeSubagentRequest = { agent: parent, session, label: 'nested', prompt: [], maxDepth: 3,
    config: { cwd: '/selected', provider: 'child-provider', model: 'child-model', maxSteps: 10, maxTokens: 100,
      builtinTools: false, systemPrompt: '' }, routeOverrides: {}, delegationContext: stored }
  try {
    const started = await agents.withInitiator(parent, () => provider.start(request, signal))
    expect(events[0]).toMatchObject({ type: 'subagent/descriptor', data: { delegationContext: { depth: 2, maxDepth: 3 } } })

    await expect(agents.withInitiator(parent, () => provider.send(parent, session, started.id, [], signal))).resolves.toBe('accepted')
    expect(opened).toHaveLength(2)
    expect(opened.at(-1)).toMatchObject({ maxDepth: 3, config: {
      provider: 'child-provider', model: 'child-model', maxSteps: 6, maxTokens: 80,
    }, delegationContext: {
      depth: 2, maxDepth: 3, provider: 'current-provider', model: 'current-model', maxSteps: 6, maxTokens: 80,
      toolNames: ['read'], builtinToolNames: ['read'], programToolNames: [],
    } })

    await provider.dispose()
    await releaseOwner()
    const physicallyDeeperParent = Session.create(parentId, undefined, {
      version: SESSION_FORMAT_VERSION, id: parentId, createdAt: 0, isSeeded: false,
      cwd: '/selected', delegationDepth: 3,
    })
    releaseOwner = execution.register({ agent: parent, session: physicallyDeeperParent,
      config: { cwd: '/selected', provider: 'current-provider', model: 'current-model', systemPrompt: '', maxSteps: 6, maxTokens: 80 },
      delegationAuthority: { toolNames: ['read'], programToolNames: [], builtinToolNames: ['read'], approvalRequired: false },
      continuations: operations,
      delegate: async () => ({ exitCode: 0 }),
    })
    const resumedProvider = new NativeSubagentContinuations(context, 'spawn', () => {}, () => {})
    try {
      await expect(agents.withInitiator(parent, () => resumedProvider.send(parent, physicallyDeeperParent, started.id, [], signal)))
        .rejects.toThrow('native-subagent: stored child violates its inherited depth limits')
      expect(opened).toHaveLength(2)
    } finally {
      await resumedProvider.dispose()
    }
  } finally {
    await provider.dispose()
    await releaseOwner()
    await releaseAgent()
  }
})
