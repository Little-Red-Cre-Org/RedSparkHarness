import { setTimeout as delay } from 'node:timers/promises'
import { expect, it } from 'vitest'
import { NativeAgentId, type NativeAgent } from '@deepseek-ai/dsh-native-agent'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin, type NativeServices } from '@deepseek-ai/dsh-native-runtime'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner,
  NativeSessionExecutionOperations } from '@deepseek-ai/dsh-native-session-execution'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionEvent, type SessionEventMap, type SessionEventType,
  type SessionAppendInput, type SurfaceEventType, type SurfaceIntent } from '@deepseek-ai/dsh-session/native'
import type { NativeExternalSubagentDriver, NativeExternalSubagentRequest } from '../src/external-driver.ts'
import { NativeSpawnSubagents, plugin as subagentPlugin, type NativeSubagentOperations } from '../src/index.ts'

const remoteProvider = 'test-remote'

function owner(sessionId: string, invocation: 'root' | 'delegated', parent?: SessionId,
  append?: (type: string) => void, flush?: (type: string | undefined) => void): NativeActiveSessionOwner {
  const id = SessionId(sessionId)
  const agent = { id: NativeAgentId(id), scope: new NativeScope() } as NativeAgent
  const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 1, cwd: '/selected',
    isSeeded: false, delegationDepth: invocation === 'root' ? 0 : 1, ...parent === undefined ? {} : { parentSession: parent } })
  let pendingEvent: string | undefined
  const appendToSession: Session['append'] = <T extends SessionEventType>(type: T, data: SessionEventMap[T],
    ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent<T>] : []): SessionEvent<T> => {
    const event = session.append(type, data, ...opts)
    pendingEvent = type
    append?.(type)
    return event
  }
  return { agent, session, invocation, inheritedEventCount: 0, writerAvailable: true,
    append: appendToSession,
    appendBatch: (inputs: readonly SessionAppendInput[]) => session.appendBatch(inputs), flush: async () => {
      const event = pendingEvent
      flush?.(event)
      pendingEvent = undefined
    },
    readEvents: async () => session.snapshotEvents(), messages: () => [], enqueue: async () => 'message', remove: async () => {},
    retain: () => { throw new Error('external children do not retain Program owners') }, onEvent: () => () => {},
    onIdle: () => async () => {}, beforeStep: () => async () => {},
  } as unknown as NativeActiveSessionOwner
}

function fixture(selectedDriver: NativeExternalSubagentDriver, owners: NativeActiveSessionOwner[], order: string[]) {
  const scope = new NativeScope()
  const current = new Map(owners.map(value => [value.agent, value]))
  let detached: ((value: NativeActiveSessionOwner) => Promise<void>) | undefined
  const activeSessions = {
    owner: (agent: NativeAgent, session: Session) => {
      const value = current.get(agent)
      return value?.session === session && value.writerAvailable ? value : undefined
    },
    owners: () => [...current.values()].filter(value => value.writerAvailable),
    onDetached: (observer: (value: NativeActiveSessionOwner) => Promise<void>) => {
      detached = observer
      return async () => { detached = undefined }
    },
  } as unknown as NativeActiveSessionOperations
  const execution = { configuration: () => ({ cwd: '/selected', provider: 'parent-provider', model: 'parent-model',
    systemPrompt: 'Parent prompt.', maxSteps: 4, maxTokens: 100 }) } as unknown as NativeSessionExecutionOperations
  const base: NativePlugin = { apiVersion: 1, name: 'external-subagent-test-base', targets: ['host'], requires: [],
    optional: [], provides: ['sessionExecution', 'activeSessions', 'promptSections'], resolve: () => (context) => {
      context.provide('sessionExecution', execution)
      context.provide('activeSessions', activeSessions)
      context.provide('promptSections', { register: () => () => {} } as unknown as NativeServices['promptSections'])
    } }
  const adapter: NativePlugin = { apiVersion: 1, name: 'external-subagent-test-adapter', targets: ['host'], requires: [],
    optional: [], provides: ['externalSubagentDriver'], resolve: () => (context) => {
      context.provide('externalSubagentDriver', selectedDriver)
      context.own(() => { order.push('driver-disposed') })
    } }
  let operations: NativeSubagentOperations | undefined
  const capture: NativePlugin = { apiVersion: 1, name: 'external-subagent-test-capture', targets: ['host'],
    requires: ['subagents'], optional: [], provides: [], resolve: () => (context) => {
      operations = context.require('subagents')
      context.own(() => { order.push('consumer-disposed') })
    } }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    { plugin: subagentPlugin, scope, config: { providerName: remoteProvider } },
    { plugin: adapter, scope, config: undefined },
    { plugin: base, scope, config: undefined },
  ], 'host'))
  return { host, current, async detach(value: NativeActiveSessionOwner) {
    current.delete(value.agent)
    await detached?.(value)
  }, get operations() {
    if (operations === undefined) throw new Error('test composition did not expose subagents')
    return operations
  }, disposeProvider() {
    if (operations === undefined) throw new Error('test composition did not expose subagents')
    return (operations as NativeSpawnSubagents).dispose()
  } }
}

function requestFor(value: NativeActiveSessionOwner) {
  return { agent: value.agent, session: value.session, label: 'Summarize the issue.', prompt: [{ type: 'text' as const, text: 'Use only the supplied task.' }],
    options: { maxDepth: 2 } }
}

const drainCases = [
  { name: 'successful cleanup', cleanupFails: false, terminalFlushFails: false },
  { name: 'range cleanup failure', cleanupFails: true, terminalFlushFails: false },
  { name: 'terminal persistence failure', cleanupFails: false, terminalFlushFails: true },
] as const

it.each(drainCases)('drains a ready child and preserves $name through owner and Provider release', async ({ cleanupFails, terminalFlushFails }) => {
  const order: string[] = []
  const parent = owner('external-parent', 'root', undefined, type => order.push(`append:${type}`),
    (type) => {
      order.push(`flush:${type}`)
      if (terminalFlushFails && type === 'subagent/external-end') throw new Error('parent terminal persistence failed')
    })
  const result = Promise.withResolvers<{ output: readonly [{ type: 'text'; text: string }]; stopReason: 'completed' }>()
  const quiescence = Promise.withResolvers<undefined>()
  const disposeStarted = Promise.withResolvers<undefined>()
  const published = Promise.withResolvers<NativeExternalSubagentRequest>()
  const started = Promise.withResolvers<undefined>()
  const finished = Promise.withResolvers<undefined>()
  let detachedRequest: NativeExternalSubagentRequest | undefined
  let terminalCleanupFailure: Error | undefined
  const driver: NativeExternalSubagentDriver = { name: remoteProvider, routeFields: [],
    capabilities: { persona: false, toolFilter: false, outputSchema: false },
    start: async (request, signal) => {
      detachedRequest = request
      order.push('driver-ready')
      published.resolve(request)
      signal.addEventListener('abort', () => { result.reject(signal.reason) }, { once: true })
      return { remoteId: 'remote-17', result: result.promise, dispose: async () => {
        order.push('range-dispose-started')
        disposeStarted.resolve(undefined)
        await quiescence.promise
        if (cleanupFails) {
          terminalCleanupFailure = new Error('external child range cleanup was not confirmed')
          throw terminalCleanupFailure
        }
        order.push('range-quiescent')
      } }
    } }
  const state = fixture(driver, [parent], order)
  try {
    await state.host.start()
    state.operations.onExternalStarted(() => {
      order.push('published-start')
      started.resolve(undefined)
    })
    state.operations.onExternalFinished(() => {
      order.push('published-finish')
      finished.resolve(undefined)
    })
    const resolved = state.operations.resolve(requestFor(parent))
    expect(() => state.operations.run({ ...resolved }, new AbortController().signal)).toThrow('unused request')
    const run = state.operations.run(resolved, new AbortController().signal).then(
      result => ({ kind: 'result' as const, result }),
      (error: unknown) => ({ kind: 'error' as const, error }),
    )
    await published.promise
    await started.promise
    expect(detachedRequest).toMatchObject({ parentSessionId: parent.session.id, rootSessionId: parent.session.id,
      limits: { maxSteps: 4, maxTokens: 100 }, route: { provider: 'parent-provider', model: 'parent-model' } })
    expect(detachedRequest).not.toHaveProperty('agent')
    expect(detachedRequest).not.toHaveProperty('session')
    expect(detachedRequest).not.toHaveProperty('writer')
    expect(order.indexOf('published-start')).toBeGreaterThan(order.indexOf('flush:subagent/external-start'))
    expect(() => state.operations.run(resolved, new AbortController().signal)).toThrow('unused request')

    const drainFails = cleanupFails || terminalFlushFails
    let detachOutcome: { kind: 'resolved' } | { kind: 'rejected'; error: unknown }
    let stopOutcome: { kind: 'resolved' } | { kind: 'rejected'; error: unknown }
    let runOutcome: Awaited<typeof run>
    if (drainFails) {
      result.resolve({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' })
      await disposeStarted.promise
      expect(order).not.toContain('driver-disposed')
      expect(order).not.toContain('append:subagent/external-end')
      quiescence.resolve(undefined)
      runOutcome = await run
      detachOutcome = await state.detach(parent).then(
        () => ({ kind: 'resolved' as const }),
        (error: unknown) => ({ kind: 'rejected' as const, error }),
      )
      stopOutcome = await state.host.stop().then(
        () => ({ kind: 'resolved' as const }),
        (error: unknown) => ({ kind: 'rejected' as const, error }),
      )
    } else {
      const detaching = state.detach(parent).then(
        () => ({ kind: 'resolved' as const }),
        (error: unknown) => ({ kind: 'rejected' as const, error }),
      )
      const stopping = state.host.stop().then(
        () => ({ kind: 'resolved' as const }),
        (error: unknown) => ({ kind: 'rejected' as const, error }),
      )
      await disposeStarted.promise
      expect(order).not.toContain('driver-disposed')
      expect(order).not.toContain('append:subagent/external-end')
      quiescence.resolve(undefined)
      const outcomes = await Promise.all([detaching, stopping])
      detachOutcome = outcomes[0]
      stopOutcome = outcomes[1]
      runOutcome = await run
    }
    if (drainFails) {
      const expectedFailure = cleanupFails ? terminalCleanupFailure : new Error('parent terminal persistence failed')
      expect(detachOutcome.kind).toBe('rejected')
      expect(stopOutcome.kind).toBe('rejected')
      expect(runOutcome.kind).toBe('error')
      const errors = (value: unknown): string[] => value instanceof AggregateError
        ? [value.message, ...value.errors.flatMap(errors)] : [value instanceof Error ? value.message : String(value)]
      if (expectedFailure !== undefined) {
        if (detachOutcome.kind === 'rejected') expect(errors(detachOutcome.error)).toContain(expectedFailure.message)
        if (stopOutcome.kind === 'rejected') expect(errors(stopOutcome.error)).toContain(expectedFailure.message)
        if (runOutcome.kind === 'error') expect(errors(runOutcome.error)).toContain(expectedFailure.message)
      }
      const disposal = state.disposeProvider()
      expect(state.disposeProvider()).toBe(disposal)
      const disposalOutcome = await disposal.then(
        () => ({ kind: 'resolved' as const }),
        (error: unknown) => ({ kind: 'rejected' as const, error }),
      )
      expect(disposalOutcome.kind).toBe('rejected')
      if (disposalOutcome.kind === 'rejected' && expectedFailure !== undefined) {
        expect(errors(disposalOutcome.error)).toContain(expectedFailure.message)
      }
      if (cleanupFails) {
        expect(terminalCleanupFailure).toBeDefined()
        expect(order).not.toContain('range-quiescent')
        expect(order).not.toContain('append:subagent/external-end')
        expect(order).not.toContain('published-finish')
      } else {
        expect(order).toContain('append:subagent/external-end')
        expect(order).toContain('flush:subagent/external-end')
        expect(order).not.toContain('published-finish')
      }
    } else {
      expect(detachOutcome.kind).toBe('resolved')
      expect(stopOutcome.kind).toBe('resolved')
      await finished.promise
      expect(order.indexOf('range-quiescent')).toBeLessThan(order.indexOf('append:subagent/external-end'))
      expect(order.indexOf('published-finish')).toBeGreaterThan(order.indexOf('append:subagent/external-end'))
      expect(order.filter(value => value === 'append:subagent/external-end')).toHaveLength(1)
    }
    expect(drainFails).toBe(cleanupFails || terminalFlushFails)
    expect(order.indexOf('consumer-disposed')).toBeLessThan(order.indexOf('driver-disposed'))
  } finally {
    quiescence.resolve(undefined)
    await state.host.stop().catch(() => {})
  }
})

it('surfaces abort-time cleanup failure before an unresolved child result and preserves the owner drain', async () => {
  const order: string[] = []
  const parent = owner('external-abort-parent', 'root')
  const result = Promise.withResolvers<{ output: readonly []; stopReason: 'completed' }>()
  const cleanupAttempted = Promise.withResolvers<undefined>()
  const allowCleanupFailure = Promise.withResolvers<undefined>()
  const cleanupFailure = new Error('abort cleanup could not confirm range quiescence')
  const published = Promise.withResolvers<NativeExternalSubagentRequest>()
  const started = Promise.withResolvers<undefined>()
  const driver: NativeExternalSubagentDriver = { name: remoteProvider, routeFields: [],
    capabilities: { persona: false, toolFilter: false, outputSchema: false },
    start: async (request, signal) => {
      published.resolve(request)
      signal.addEventListener('abort', () => { /* The adapter keeps result pending until range cleanup. */ }, { once: true })
      return { remoteId: 'remote-abort', result: result.promise, dispose: async () => {
        cleanupAttempted.resolve(undefined)
        await allowCleanupFailure.promise
        throw cleanupFailure
      } }
    } }
  const state = fixture(driver, [parent], order)
  try {
    await state.host.start()
    state.operations.onExternalStarted(() => { started.resolve(undefined) })
    const resolved = state.operations.resolve(requestFor(parent))
    const signal = new AbortController()
    const run = state.operations.run(resolved, signal.signal).then(
      () => ({ kind: 'resolved' as const }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    )
    await published.promise
    await started.promise
    signal.abort(new Error('caller cancelled'))
    await cleanupAttempted.promise
    const detaching = state.detach(parent).then(
      () => ({ kind: 'resolved' as const }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    )
    allowCleanupFailure.resolve(undefined)
    const [runOutcome, detachOutcome] = await Promise.all([run, detaching])
    const messages = (value: unknown): string[] => value instanceof AggregateError
      ? [value.message, ...value.errors.flatMap(messages)] : [value instanceof Error ? value.message : String(value)]
    expect(runOutcome.kind).toBe('rejected')
    expect(detachOutcome.kind).toBe('rejected')
    if (runOutcome.kind === 'rejected') expect(messages(runOutcome.error)).toContain(cleanupFailure.message)
    if (detachOutcome.kind === 'rejected') expect(messages(detachOutcome.error)).toContain(cleanupFailure.message)
    expect(order).not.toContain('append:subagent/external-end')

    const disposal = state.disposeProvider()
    expect(state.disposeProvider()).toBe(disposal)
    const disposalOutcome = await disposal.then(
      () => ({ kind: 'resolved' as const }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    )
    expect(disposalOutcome.kind).toBe('rejected')
    if (disposalOutcome.kind === 'rejected') expect(messages(disposalOutcome.error)).toContain(cleanupFailure.message)
  } finally {
    allowCleanupFailure.resolve(undefined)
    await state.host.stop().catch(() => {})
  }
})

it.each(['ordinary result failure', 'Node AbortError cancellation'] as const)(
  'keeps a successful external drain successful when the run reports %s', async (resultKind) => {
    const order: string[] = []
    const parent = owner(`external-${resultKind}`, 'root', undefined, type => order.push(`append:${type}`),
      type => order.push(`flush:${type}`))
    const result = Promise.withResolvers<{ output: readonly []; stopReason: 'completed' }>()
    const cleanup = Promise.withResolvers<undefined>()
    const cleanupStarted = Promise.withResolvers<undefined>()
    const started = Promise.withResolvers<undefined>()
    const ordinaryFailure = new Error('external child returned an ordinary failure')
    let cancellationReason: unknown
    const driver: NativeExternalSubagentDriver = { name: remoteProvider, routeFields: [],
      capabilities: { persona: false, toolFilter: false, outputSchema: false },
      start: async (_request, signal) => {
        const childResult = resultKind === 'Node AbortError cancellation'
          ? delay(60_000, { output: [], stopReason: 'completed' as const }, { signal })
          : result.promise
        signal.addEventListener('abort', () => { cancellationReason = signal.reason }, { once: true })
        return { remoteId: 'remote-result-error', result: childResult, dispose: async () => {
          cleanupStarted.resolve(undefined)
          await cleanup.promise
          order.push('range-quiescent')
        } }
      } }
    const state = fixture(driver, [parent], order)
    try {
      await state.host.start()
      state.operations.onExternalStarted(() => { started.resolve(undefined) })
      const run = state.operations.run(state.operations.resolve(requestFor(parent)), new AbortController().signal).then(
        () => ({ kind: 'resolved' as const }),
        (error: unknown) => ({ kind: 'rejected' as const, error }),
      )
      await started.promise
      const rawDisposal = state.disposeProvider()
      expect(state.disposeProvider()).toBe(rawDisposal)
      const disposal = rawDisposal.then(
        () => ({ kind: 'resolved' as const }),
        (error: unknown) => ({ kind: 'rejected' as const, error }),
      )
      await cleanupStarted.promise
      if (resultKind === 'ordinary result failure') result.reject(ordinaryFailure)
      cleanup.resolve(undefined)
      const [runOutcome, disposalOutcome] = await Promise.all([run, disposal])
      expect(runOutcome.kind).toBe('rejected')
      expect(disposalOutcome.kind).toBe('resolved')
      if (runOutcome.kind === 'rejected' && resultKind === 'ordinary result failure') {
        expect(runOutcome.error).toBe(ordinaryFailure)
      }
      if (runOutcome.kind === 'rejected' && resultKind === 'Node AbortError cancellation') {
        expect(runOutcome.error).toMatchObject({ name: 'AbortError', cause: cancellationReason })
        expect(cancellationReason).toBeDefined()
      }
      expect(order).toContain('range-quiescent')
      expect(order).toContain('flush:subagent/external-end')
    } finally {
      cleanup.resolve(undefined)
      await state.host.stop().catch(() => {})
    }
  },
)
it('rejects a resolved external request when its invocation-root owner has been replaced', async () => {
  const order: string[] = []
  const root = owner('external-root', 'root')
  const parent = owner('external-nested-parent', 'delegated', root.session.id)
  let launches = 0
  const driver: NativeExternalSubagentDriver = { name: remoteProvider, routeFields: [],
    capabilities: { persona: false, toolFilter: false, outputSchema: false },
    start: async () => {
      launches++
      return { remoteId: 'should-not-start', result: Promise.resolve({ output: [], stopReason: 'completed' }), dispose: async () => {} }
    } }
  const state = fixture(driver, [root, parent], order)
  try {
    await state.host.start()
    const resolved = state.operations.resolve(requestFor(parent))
    const replacement = owner('external-root', 'root')
    state.current.set(root.agent, replacement)
    expect(() => state.operations.run(resolved, new AbortController().signal)).toThrow('released or replaced parent/root owner')
    expect(launches).toBe(0)
  } finally {
    await state.host.stop()
  }
})
