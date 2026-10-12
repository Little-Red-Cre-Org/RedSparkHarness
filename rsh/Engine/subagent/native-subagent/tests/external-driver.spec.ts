import { setTimeout as delay } from 'node:timers/promises'
import { expect, it } from 'vitest'
import { NativeAgentId, type NativeAgent } from '@deepseek-ai/dsh-native-agent'
import { NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin, type NativeServices } from '@deepseek-ai/dsh-native-runtime'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner,
  NativeSessionDelegationAuthority, NativeSessionExecutionOperations } from '@deepseek-ai/dsh-native-session-execution'
import { NativeToolRegistry, type NativeExternalToolOperations } from '@deepseek-ai/dsh-native-tools'
import { NativeModelExecution, type NativeResponsesPreparedGeneration } from '@deepseek-ai/dsh-native-model-execution'
import type { NativeResponsesRoute } from '@deepseek-ai/dsh-native-model-execution/responses-transport'
import { createUserMessage, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm/native'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionEvent, type SessionEventMap, type SessionEventType,
  type SessionAppendInput, type SurfaceEventType, type SurfaceIntent } from '@deepseek-ai/dsh-session/native'
import type { NativeExternalSubagentDriver, NativeExternalSubagentRequest } from '../src/external-driver.ts'
import type { NativeExternalModelAttemptLease } from '../src/external-driver.ts'
import { NativeSpawnSubagents, plugin as subagentPlugin, serializeNativeExternalJson, type NativeSubagentOperations } from '../src/index.ts'

const remoteProvider = 'test-remote'

function owner(sessionId: string, invocation: 'root' | 'delegated', parent?: SessionId,
  append?: (type: string) => void, flush?: (type: string | undefined) => void | Promise<void>): NativeActiveSessionOwner {
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
      await flush?.(event)
      pendingEvent = undefined
    },
    readEvents: async () => session.snapshotEvents(), messages: () => [], enqueue: async () => 'message', remove: async () => {},
    retain: () => { throw new Error('external children do not retain Program owners') }, onEvent: () => () => {},
    onIdle: () => async () => {}, beforeStep: () => async () => {},
  } as unknown as NativeActiveSessionOwner
}

function fixture(selectedDriver: NativeExternalSubagentDriver, owners: NativeActiveSessionOwner[], order: string[],
  authority?: NativeSessionDelegationAuthority,
  captureExternalTools?: NativeSessionExecutionOperations['captureExternalTools'],
  captureExternalResponses?: NativeSessionExecutionOperations['captureExternalResponses']) {
  const scope = new NativeScope()
  const tools = new NativeToolRegistry(new NativeAgentRegistry({ emit() {} }), scope)
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
    systemPrompt: 'Parent prompt.', maxSteps: 4, maxTokens: 100 }),
  delegationAuthority: (agent: NativeAgent, session: Session) => {
    const value = current.get(agent)
    return value?.session === session && value.writerAvailable
      ? authority ?? Object.freeze({ toolNames: Object.freeze([]), programToolNames: Object.freeze([]),
        builtinToolNames: Object.freeze([]), approvalRequired: false })
      : undefined
  },
  captureExternalTools: captureExternalTools ?? (async (): Promise<NativeExternalToolOperations> => ({
    schemas: [], programSchemas: [], promptText: '',
    execute: async () => { throw new Error('unexpected external tool call') }, dispose: async () => {},
  })),
  ...captureExternalResponses === undefined ? {} : { captureExternalResponses },
  } as unknown as NativeSessionExecutionOperations
  const base: NativePlugin = { apiVersion: 1, name: 'external-subagent-test-base', targets: ['host'], requires: [],
    optional: [], provides: ['sessionExecution', 'activeSessions', 'promptSections', 'tools'], resolve: () => (context) => {
      context.provide('sessionExecution', execution)
      context.provide('activeSessions', activeSessions)
      context.provide('tools', tools)
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

it('inherits nested Responses generations for same and overridden routes', async () => {
  const order: string[] = []
  const parent = owner('external-inherited-context-parent', 'root')
  const firstLaunched = Promise.withResolvers<NativeExternalSubagentRequest>()
  const secondLaunched = Promise.withResolvers<NativeExternalSubagentRequest>()
  const results = [Promise.withResolvers<{ output: readonly [{ type: 'text'; text: string }]; stopReason: 'completed' }>(),
    Promise.withResolvers<{ output: readonly [{ type: 'text'; text: string }]; stopReason: 'completed' }>()]
  const launched: NativeExternalSubagentRequest[] = []
  const captures: { readonly generation: string; readonly route: NativeResponsesRoute; readonly maxTokens?: number }[] = []
  const toolGenerations: NativeResponsesPreparedGeneration[] = []
  const closed: string[] = []
  let activeAdapterGeneration = 'selected-parent'
  let preparedCalls = 0
  const modelExecution = new NativeModelExecution({
    async prepareCall(provider, model) {
      const generation = `${provider}/${model}/${activeAdapterGeneration}/${++preparedCalls}`
      return { model: { provider, id: model, name: model, reasoning: { efforts: [
        { id: ReasoningEffortId('high'), name: 'High' }, { id: ReasoningEffortId('medium'), name: 'Medium' },
      ] } }, supportsOutputTokenLimit: async () => true, async *stream() {}, nativeResponses: {
        async capture(request, signal) {
          signal.throwIfAborted()
          captures.push({ generation, route: request.route,
            ...request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens } })
          const route = request.route
          return { route, outputTokenLimit: 'supported',
            async projectRequest(body) { return body },
            async forward() { throw new Error('nested test does not forward provider requests') },
            async close() { closed.push(`${generation}:${route.provider}/${route.model}`) },
          }
        },
      } }
    },
    async *stream() {},
  })
  const parentRoute = { provider: 'external-parent-provider', model: 'external-parent-model' }
  const parentPrepared = await modelExecution.prepareStep(parentRoute)
  const parentCapture = await modelExecution.captureResponsesOperation(parentPrepared, parentRoute, undefined,
    new AbortController().signal, ReasoningEffortId('high'))
  activeAdapterGeneration = 'replacement-after-parent-prepare'
  const driver: NativeExternalSubagentDriver = { name: remoteProvider, modelProtocol: 'responses',
    routeFields: ['provider', 'model', 'reasoningEffort'],
    capabilities: { persona: false, toolFilter: true, outputSchema: false },
    start: async (request) => {
      const index = launched.push(request) - 1
      if (index === 0) firstLaunched.resolve(request)
      else secondLaunched.resolve(request)
      return { remoteId: `remote-nested-${index}`, result: results[index]!.promise, dispose: async () => {} }
    } }
  const authority: NativeSessionDelegationAuthority = Object.freeze({
    toolNames: Object.freeze(['read_file', 'registry-tool']),
    programToolNames: Object.freeze(['program-tool']),
    builtinToolNames: Object.freeze(['read_file']),
    approvalRequired: false,
  })
  const state = fixture(driver, [parent], order, authority,
    async (_agent, _session, _context, _signal, selectedGeneration) => {
      if (selectedGeneration === undefined) throw new Error('test expected the selected operation generation')
      toolGenerations.push(selectedGeneration)
      return { schemas: [], programSchemas: [], promptText: '',
        execute: async () => { throw new Error('unexpected external tool call') }, dispose: async () => {} }
    },
    async (_agent, _session, route, maxTokens, reasoningEffort, signal, selectedGeneration) => {
      if (selectedGeneration === undefined) throw new Error('test expected an inherited prepared generation')
      return selectedGeneration.capture({ route,
        ...maxTokens === undefined ? {} : { maxTokens },
        ...reasoningEffort === undefined ? {} : { reasoningEffort } }, signal)
    })
  try {
    await state.host.start()
    const resolved = state.operations.resolve({ ...requestFor(parent),
      options: { maxDepth: 4, maxSteps: 2, toolFilter: { deny: ['registry-tool'] } },
      delegationContext: {
        depth: 2, maxDepth: 5, cwd: '/external-child', provider: 'external-parent-provider', model: 'external-parent-model',
        reasoningEffort: ReasoningEffortId('high'), maxSteps: 3,
        toolNames: ['read_file', 'registry-tool'], builtinToolNames: ['read_file'], programToolNames: ['program-tool'],
      },
      responsesGeneration: parentCapture.generation,
    })
    const running = state.operations.run(resolved, new AbortController().signal)
    const request = await firstLaunched.promise
    expect(request).toMatchObject({ parentDepth: 2, maxDepth: 4, cwd: '/external-child',
      route: { provider: 'external-parent-provider', model: 'external-parent-model', reasoningEffort: 'high' },
      limits: { maxSteps: 2 },
      authority: { toolNames: ['read_file'], programToolNames: ['program-tool'], builtinToolNames: ['read_file'] },
    })
    expect(request.limits).not.toHaveProperty('maxTokens')
    expect(captures[0]).toEqual({ generation: 'external-parent-provider/external-parent-model/selected-parent/1',
      route: { provider: 'external-parent-provider', model: 'external-parent-model' } })
    expect(preparedCalls).toBe(1)
    expect(captures[1]).toEqual({ generation: 'external-parent-provider/external-parent-model/selected-parent/1',
      route: { provider: 'external-parent-provider', model: 'external-parent-model' } })
    expect(toolGenerations[0]?.route).toEqual({ provider: 'external-parent-provider', model: 'external-parent-model' })
    results[0]!.resolve({ output: [{ type: 'text', text: 'same route' }], stopReason: 'completed' })
    await expect(running).resolves.toMatchObject({ stopReason: 'completed' })

    const changedRoute = state.operations.resolve({ ...requestFor(parent),
      options: { maxDepth: 4, maxSteps: 2, provider: 'child-provider', model: 'child-model',
        reasoningEffort: ReasoningEffortId('medium'), maxTokens: 50 },
      ...resolved.delegationContext === undefined ? {} : { delegationContext: resolved.delegationContext },
      responsesGeneration: parentCapture.generation,
    })
    const changedRunning = state.operations.run(changedRoute, new AbortController().signal)
    const changed = await secondLaunched.promise
    expect(changed.route).toMatchObject({ provider: 'child-provider', model: 'child-model', reasoningEffort: 'medium' })
    expect(changed.limits).toEqual({ maxSteps: 2, maxTokens: 50 })
    expect(captures[2]).toEqual({ generation: 'child-provider/child-model/replacement-after-parent-prepare/2',
      route: { provider: 'child-provider', model: 'child-model' }, maxTokens: 50 })
    expect(preparedCalls).toBe(2)
    expect(toolGenerations[1]?.route).toEqual({ provider: 'child-provider', model: 'child-model' })
    results[1]!.resolve({ output: [{ type: 'text', text: 'changed route' }], stopReason: 'completed' })
    await expect(changedRunning).resolves.toMatchObject({ stopReason: 'completed' })
    const retainedParent = await parentCapture.generation.capture({ route: parentRoute }, new AbortController().signal)
    await retainedParent.transport.close()
    expect(captures[3]).toEqual({ generation: 'external-parent-provider/external-parent-model/selected-parent/1', route: parentRoute })
    expect(preparedCalls).toBe(2)
    await parentCapture.transport.close()
    expect(closed).toEqual([
      'external-parent-provider/external-parent-model/selected-parent/1:external-parent-provider/external-parent-model',
      'child-provider/child-model/replacement-after-parent-prepare/2:child-provider/child-model',
      'external-parent-provider/external-parent-model/selected-parent/1:external-parent-provider/external-parent-model',
      'external-parent-provider/external-parent-model/selected-parent/1:external-parent-provider/external-parent-model',
    ])
  } finally {
    for (const result of results) result.resolve({ output: [{ type: 'text', text: 'cleanup' }], stopReason: 'completed' })
    await state.host.stop()
  }
})

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

it('holds first model admission until the parent start flush and latches the conservative attempt ceiling', async () => {
  const order: string[] = []
  const startFlushReached = Promise.withResolvers<undefined>()
  const releaseStartFlush = Promise.withResolvers<undefined>()
  const parent = owner('external-model-gate-parent', 'root', undefined, type => order.push(`append:${type}`), async (type) => {
    order.push(`flush:${type}`)
    if (type === 'subagent/external-start') {
      startFlushReached.resolve(undefined)
      await releaseStartFlush.promise
    }
  })
  const modelAdmission = Promise.withResolvers<{ readonly admission: Promise<NativeExternalModelAttemptLease> }>()
  const result = Promise.withResolvers<{ output: readonly []; stopReason: 'completed' }>()
  const started = Promise.withResolvers<undefined>()
  const finished = Promise.withResolvers<{ readonly stopReason: string }>()
  let admissionSettled = false
  let modelOperations: NativeExternalSubagentRequest['model'] | undefined
  const driver: NativeExternalSubagentDriver = { name: remoteProvider, routeFields: [],
    capabilities: { persona: false, toolFilter: false, outputSchema: false },
    start: async (request, signal) => {
      modelOperations = request.model
      const pending = request.model.admitModelRequest({ route: { provider: 'parent-provider', model: 'parent-model' },
        requestBody: serializeNativeExternalJson({ model: 'parent-model', input: [{ role: 'user', content: 'full input' }], tools: [] }) })
      void pending.then(() => { admissionSettled = true }, () => { admissionSettled = true })
      modelAdmission.resolve({ admission: pending })
      signal.addEventListener('abort', () => { result.resolve({ output: [], stopReason: 'completed' }) }, { once: true })
      return { remoteId: 'remote-model-gate', result: result.promise, dispose: async () => { order.push('range-quiescent') } }
    } }
  const state = fixture(driver, [parent], order)
  try {
    await state.host.start()
    state.operations.onExternalStarted(() => { started.resolve(undefined) })
    state.operations.onExternalFinished((value) => { finished.resolve(value.event) })
    const resolved = state.operations.resolve({ ...requestFor(parent), options: { maxDepth: 2, maxSteps: 1 } })
    const run = state.operations.run(resolved, new AbortController().signal).then(
      value => ({ kind: 'result' as const, value }),
      (error: unknown) => ({ kind: 'error' as const, error }),
    )
    await startFlushReached.promise
    const { admission } = await modelAdmission.promise
    expect(admissionSettled).toBe(false)
    expect(order).not.toContain('append:subagent/external-operation')
    releaseStartFlush.resolve(undefined)
    await started.promise
    const lease = await admission
    expect(order.indexOf('append:subagent/external-start')).toBeLessThan(order.indexOf('append:subagent/external-operation'))
    expect(order.indexOf('flush:subagent/external-start')).toBeLessThan(order.indexOf('append:subagent/external-operation'))
    if (modelOperations === undefined) throw new Error('external driver did not receive model operations')
    await modelOperations.recordModelResponse(lease, { events: [serializeNativeExternalJson({ type: 'response.output_text.delta', delta: 'done' })],
      completed: serializeNativeExternalJson({ type: 'response.completed', response: { id: 'resp_1', output: [] } }), toolCalls: [] })
    expect(order).toContain('append:subagent/external-operation')
    const overLimit = await modelOperations.admitModelRequest({ route: { provider: 'parent-provider', model: 'parent-model' },
      requestBody: serializeNativeExternalJson({ model: 'parent-model', input: [], tools: [] }) }).then(
      () => ({ kind: 'resolved' as const }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    )
    expect(overLimit.kind).toBe('rejected')
    if (overLimit.kind === 'rejected') expect(overLimit.error).toBeInstanceOf(RangeError)
    const runOutcome = await run
    expect(runOutcome.kind).toBe('error')
    if (runOutcome.kind === 'error') expect(runOutcome.error).toBeInstanceOf(RangeError)
    expect((await finished.promise).stopReason).toBe('error')
    const operationEvents = parent.session.snapshotEvents().filter(event => event.type === 'subagent/external-operation')
    expect(operationEvents.map(event => event.data.kind)).toEqual(['model-request', 'model-response'])
    expect(operationEvents.map(event => event.data.kind === 'model-request' || event.data.kind === 'model-response'
      ? event.data.sequence : undefined)).toEqual([1, 1])
    expect(order.indexOf('range-quiescent')).toBeLessThan(order.indexOf('append:subagent/external-end'))
  } finally {
    releaseStartFlush.resolve(undefined)
    await state.host.stop().catch(() => {})
  }
})

it('drains accepted response calls and rejects an omitted grant after child completion', async () => {
  const order: string[] = []
  const parent = owner('external-tool-broker-parent', 'root', undefined, type => order.push(`append:${type}`), (type) => {
    const event = parent.session.snapshotEvents().filter(value => value.type === 'subagent/external-operation').at(-1)
    const callId = event?.data.kind === 'tool-result' || event?.data.kind === 'tool-settlement' ? `:${event.data.callId}` : ''
    order.push(`flush:${type === 'subagent/external-operation' ? `${event?.data.kind}${callId}` : type}`)
  })
  const admission = Promise.withResolvers<NativeExternalModelAttemptLease>()
  const childResult = Promise.withResolvers<{ output: readonly []; stopReason: 'completed' }>()
  const started = Promise.withResolvers<undefined>()
  const firstBodyEntered = Promise.withResolvers<undefined>()
  const releaseFirstBody = Promise.withResolvers<undefined>()
  const childDisposeStarted = Promise.withResolvers<undefined>()
  const releaseChildDispose = Promise.withResolvers<undefined>()
  let model: NativeExternalSubagentRequest['model'] | undefined
  const readFileSchema = { name: 'read_file', description: 'Read one file.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }
  const driver: NativeExternalSubagentDriver = { name: remoteProvider, routeFields: [],
    capabilities: { persona: false, toolFilter: false, outputSchema: false },
    start: async (request) => {
      model = request.model
      void request.model.admitModelRequest({ route: { provider: 'parent-provider', model: 'parent-model' },
        requestBody: serializeNativeExternalJson({ model: 'parent-model', input: [{ role: 'user', content: 'Read file.' }],
          tools: [readFileSchema] }),
      }).then(admission.resolve, admission.reject)
      return { remoteId: 'remote-tool-broker', result: childResult.promise, dispose: async () => {
        childDisposeStarted.resolve(undefined)
        await releaseChildDispose.promise
      } }
    } }
  const acceptedContext = createUserMessage({ content: [{ type: 'text', text: 'settled context' }],
    source: { kind: 'plugin', plugin: 'external-tool-test' } })
  const capture: NonNullable<NativeSessionExecutionOperations['captureExternalTools']> = async () => ({
    schemas: [readFileSchema],
    programSchemas: [], promptText: 'Captured tool prompt.',
    execute: async (call) => {
      order.push(`body:${call.callId}`)
      if (call.callId === ToolCallId('call_1')) {
        firstBodyEntered.resolve(undefined)
        await releaseFirstBody.promise
      }
      const args = call.arguments
      const path = args !== null && typeof args === 'object' && !Array.isArray(args)
        && typeof args.path === 'string' ? args.path : undefined
      return { result: { content: [{ type: 'text', text: `file ${path ?? 'undefined'}` }], isError: false },
        acceptRecordedResult: () => {
          order.push(`accepted:${call.callId}`)
          return { settlementContexts: [acceptedContext], concludesTurn: call.callId === ToolCallId('call_2') }
        },
        async readAcceptedImages() { order.push(`images:${call.callId}`); return [] },
      }
    },
    dispose: async () => { order.push('tools-disposed') },
  })
  const authority: NativeSessionDelegationAuthority = Object.freeze({ toolNames: Object.freeze(['read_file']),
    programToolNames: Object.freeze([]), builtinToolNames: Object.freeze(['read_file']), approvalRequired: false })
  const state = fixture(driver, [parent], order, authority, capture)
  try {
    await state.host.start()
    state.operations.onExternalStarted(() => { started.resolve(undefined) })
    const running = state.operations.run(state.operations.resolve(requestFor(parent)), new AbortController().signal)
    await started.promise
    const lease = await admission.promise
    const calls = [
      { callId: ToolCallId('call_1'), name: 'read_file', arguments: { path: 'notes.txt' } },
      { callId: ToolCallId('call_2'), name: 'read_file', arguments: { path: 'summary.txt' } },
      { callId: ToolCallId('call_3'), name: 'read_file', arguments: { path: 'unused.txt' } },
    ] as const
    if (model === undefined) throw new Error('external driver did not receive model operations')
    const grants = await model.recordModelResponse(lease, {
      events: [serializeNativeExternalJson({ type: 'response.output_item.added', item: {
        type: 'function_call', call_id: calls[0].callId, name: calls[0].name, arguments: JSON.stringify(calls[0].arguments),
      } }), serializeNativeExternalJson({ type: 'response.output_item.added', item: {
        type: 'function_call', call_id: calls[1].callId, name: calls[1].name, arguments: JSON.stringify(calls[1].arguments),
      } }), serializeNativeExternalJson({ type: 'response.output_item.added', item: {
        type: 'function_call', call_id: calls[2].callId, name: calls[2].name, arguments: JSON.stringify(calls[2].arguments),
      } }), serializeNativeExternalJson({ type: 'response.completed' })],
      completed: serializeNativeExternalJson({ type: 'response.completed', response: { id: 'resp_tool', output: calls.map(call => ({
        type: 'function_call', call_id: call.callId, name: call.name, arguments: JSON.stringify(call.arguments),
      })) } }), toolCalls: calls,
    })
    expect(grants).toHaveLength(3)
    const signal = new AbortController().signal
    const settlements = Promise.all(grants.slice(0, 2).map(grant => model!.executeTool(grant, signal)))
    await firstBodyEntered.promise
    expect(order).not.toContain(`body:${calls[1].callId}`)
    const nextRequest = () => model!.admitModelRequest({ route: { provider: 'parent-provider', model: 'parent-model' },
      requestBody: serializeNativeExternalJson({ model: 'parent-model', input: [], tools: [] }) })
    await expect(nextRequest()).rejects.toThrow('the previous model/tool batch has not settled')
    releaseFirstBody.resolve(undefined)
    const acceptedSettlements = await settlements
    expect(acceptedSettlements).toMatchObject([
      { result: { isError: false }, settlementContexts: [acceptedContext], concludesTurn: false, images: [] },
      { result: { isError: false }, settlementContexts: [acceptedContext], concludesTurn: true, images: [] },
    ])
    for (const call of calls.slice(0, 2)) {
      expect(order.indexOf(`flush:tool-result:${call.callId}`)).toBeLessThan(order.indexOf(`accepted:${call.callId}`))
      expect(order.indexOf(`accepted:${call.callId}`)).toBeLessThan(order.indexOf(`flush:tool-settlement:${call.callId}`))
      expect(order.indexOf(`flush:tool-settlement:${call.callId}`)).toBeLessThan(order.indexOf(`images:${call.callId}`))
    }
    await expect(nextRequest()).rejects.toThrow('a settled tool call concluded the external turn')
    childResult.resolve({ output: [], stopReason: 'completed' })
    await childDisposeStarted.promise
    await expect(model.executeTool(grants[2]!, signal)).rejects.toThrow('external tool admission is closed')
    expect(order).not.toContain(`body:${calls[2].callId}`)
    releaseChildDispose.resolve(undefined)
    await expect(running).rejects.toThrow('completed with recorded tool calls that it did not execute')
    const events = parent.session.snapshotEvents().filter(event => event.type === 'subagent/external-operation')
    expect(events.map(event => event.data.kind)).toEqual([
      'model-request', 'model-response', 'tool-call', 'tool-result', 'tool-settlement',
      'tool-call', 'tool-result', 'tool-settlement',
    ])
    expect(events[1]?.type === 'subagent/external-operation' && events[1].data.kind === 'model-response'
      ? events[1].data.toolCalls : undefined).toEqual(calls)
    expect(events[3]?.type === 'subagent/external-operation' && events[3].data.kind === 'tool-result'
      ? events[3].data.result : undefined).toEqual(acceptedSettlements[0]?.result)
    const end = parent.session.snapshotEvents().find(event => event.type === 'subagent/external-end')
    expect(end?.type === 'subagent/external-end' ? end.data.stopReason : undefined).toBe('error')
    expect(order.indexOf('tools-disposed')).toBeLessThan(order.indexOf('append:subagent/external-end'))
    expect(parent.session.snapshotEvents().some(event => event.type === 'tool/call' || event.type === 'tool/result')).toBe(false)
  } finally {
    childResult.resolve({ output: [], stopReason: 'completed' })
    releaseChildDispose.resolve(undefined)
    await state.host.stop().catch(() => {})
  }
})

it('records a response to the captured parent but rejects delivery after its active owner is replaced', async () => {
  const order: string[] = []
  const parent = owner('external-late-response-parent', 'root', undefined, type => order.push(`append:${type}`),
    (type) => { order.push(`flush:${type}`) })
  const modelAdmission = Promise.withResolvers<NativeExternalModelAttemptLease>()
  const result = Promise.withResolvers<{ output: readonly []; stopReason: 'completed' }>()
  const started = Promise.withResolvers<undefined>()
  const finished = Promise.withResolvers<{ readonly stopReason: string }>()
  let modelOperations: NativeExternalSubagentRequest['model'] | undefined
  const driver: NativeExternalSubagentDriver = { name: remoteProvider, routeFields: [],
    capabilities: { persona: false, toolFilter: false, outputSchema: false },
    start: async (request, signal) => {
      modelOperations = request.model
      void request.model.admitModelRequest({ route: { provider: 'parent-provider', model: 'parent-model' },
        requestBody: serializeNativeExternalJson({ model: 'parent-model', input: [], tools: [] }) })
        .then(modelAdmission.resolve, modelAdmission.reject)
      signal.addEventListener('abort', () => { result.reject(signal.reason) }, { once: true })
      return { remoteId: 'remote-late-response', result: result.promise, dispose: async () => { order.push('range-quiescent') } }
    } }
  const state = fixture(driver, [parent], order)
  try {
    await state.host.start()
    state.operations.onExternalStarted(() => { started.resolve(undefined) })
    state.operations.onExternalFinished((value) => { finished.resolve(value.event) })
    const resolved = state.operations.resolve({ ...requestFor(parent), options: { maxDepth: 2, maxSteps: 1 } })
    const run = state.operations.run(resolved, new AbortController().signal).then(
      value => ({ kind: 'result' as const, value }),
      (error: unknown) => ({ kind: 'error' as const, error }),
    )
    await started.promise
    const lease = await modelAdmission.promise
    if (modelOperations === undefined) throw new Error('external driver did not receive model operations')
    const replacement = owner(parent.session.id, 'root')
    state.current.set(parent.agent, { ...replacement, agent: parent.agent })
    let delivered = false
    const response = await modelOperations.recordModelResponse(lease, {
      events: [serializeNativeExternalJson({ type: 'response.output_text.delta', delta: 'late' })],
      completed: serializeNativeExternalJson({ type: 'response.completed', response: { id: 'resp_late', output: [] } }),
      toolCalls: [],
    }).then(
      () => { delivered = true; return { kind: 'resolved' as const } },
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    )
    expect(response.kind).toBe('rejected')
    expect(delivered).toBe(false)
    expect((await run).kind).toBe('error')
    expect((await finished.promise).stopReason).toBe('error')
    const operationEvents = parent.session.snapshotEvents().filter(event => event.type === 'subagent/external-operation')
    expect(operationEvents.map(event => event.data.kind)).toEqual(['model-request', 'model-response'])
    expect(replacement.session.snapshotEvents().filter(event => event.type === 'subagent/external-operation')).toEqual([])
    expect(order.indexOf('flush:subagent/external-operation')).toBeLessThan(order.indexOf('append:subagent/external-end'))
    expect(order.indexOf('range-quiescent')).toBeLessThan(order.indexOf('append:subagent/external-end'))
  } finally {
    await state.host.stop().catch(() => {})
  }
})

it('settles a cancelled attempt when its captured-parent failure flush rejects', async () => {
  const order: string[] = []
  let rejectOperationFlush = false
  const parent = owner('external-failure-flush-parent', 'root', undefined, type => order.push(`append:${type}`), async (type) => {
    order.push(`flush:${type}`)
    if (rejectOperationFlush && type === 'subagent/external-operation') throw new Error('external operation log flush failed')
  })
  const modelAdmission = Promise.withResolvers<NativeExternalModelAttemptLease>()
  const result = Promise.withResolvers<{ output: readonly []; stopReason: 'completed' }>()
  const started = Promise.withResolvers<undefined>()
  const finished = Promise.withResolvers<{ readonly stopReason: string }>()
  let modelOperations: NativeExternalSubagentRequest['model'] | undefined
  const driver: NativeExternalSubagentDriver = { name: remoteProvider, routeFields: [],
    capabilities: { persona: false, toolFilter: false, outputSchema: false },
    start: async (request, signal) => {
      modelOperations = request.model
      void request.model.admitModelRequest({ route: { provider: 'parent-provider', model: 'parent-model' },
        requestBody: serializeNativeExternalJson({ model: 'parent-model', input: [], tools: [] }) })
        .then(modelAdmission.resolve, modelAdmission.reject)
      signal.addEventListener('abort', () => { result.reject(signal.reason) }, { once: true })
      return { remoteId: 'remote-failure-flush', result: result.promise, dispose: async () => { order.push('range-quiescent') } }
    } }
  const state = fixture(driver, [parent], order)
  const cancellation = new AbortController()
  try {
    await state.host.start()
    state.operations.onExternalStarted(() => { started.resolve(undefined) })
    state.operations.onExternalFinished((value) => { finished.resolve(value.event) })
    const resolved = state.operations.resolve({ ...requestFor(parent), options: { maxDepth: 2, maxSteps: 1 } })
    const run = state.operations.run(resolved, cancellation.signal).then(
      value => ({ kind: 'result' as const, value }),
      (error: unknown) => ({ kind: 'error' as const, error }),
    )
    await started.promise
    const lease = await modelAdmission.promise
    if (modelOperations === undefined) throw new Error('external driver did not receive model operations')
    rejectOperationFlush = true
    cancellation.abort(new Error('caller cancelled external operation'))
    const failureWrite = await modelOperations.recordModelFailure(lease, { kind: 'transport', events: [] }).then(
      () => ({ kind: 'resolved' as const }),
      (error: unknown) => { order.push('failure-settled'); return { kind: 'rejected' as const, error } },
    )
    expect(failureWrite.kind).toBe('rejected')
    const runOutcome = await run
    expect(runOutcome.kind).toBe('error')
    expect((await finished.promise).stopReason).toBe('error')
    expect(order.indexOf('failure-settled')).toBeLessThan(order.indexOf('append:subagent/external-end'))
    expect(order.indexOf('range-quiescent')).toBeLessThan(order.indexOf('append:subagent/external-end'))
    if (runOutcome.kind === 'error') {
      const messages = runOutcome.error instanceof AggregateError
        ? runOutcome.error.errors.map(error => error instanceof Error ? error.message : String(error)).join('\n')
        : runOutcome.error instanceof Error ? runOutcome.error.message : String(runOutcome.error)
      expect(messages).toContain('external operation log flush failed')
    }
  } finally {
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
      (type) => { order.push(`flush:${type}`) })
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
