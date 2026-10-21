/** External tool capture cancellation and settlement ownership. */
import { expect, it, vi } from 'vitest'
import { NativeAgentId, NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { NativeModelExecution } from '@deepseek-ai/dsh-native-model-execution'
import { NativeSessionExecutionRegistry, type NativeSessionExecutionOwner } from '../src/index.ts'

it('waits for every owner release before rejecting failed registry disposal', async () => {
  const agents = new NativeAgentRegistry({ emit() {} })
  const registry = new NativeSessionExecutionRegistry(agents)
  const failure = new Error('first owner cleanup failed')
  const cleanupAEntered = Promise.withResolvers<undefined>()
  const cleanupBEntered = Promise.withResolvers<undefined>()
  const settleCleanupB = Promise.withResolvers<undefined>()
  const registrations = ['registry-release-a', 'registry-release-b'].map((id) => {
    const agent = { id: NativeAgentId(id), scope: new NativeScope() }
    const releaseAgent = agents.register(agent)
    const sessionId = SessionId(id)
    const session = Session.create(sessionId, undefined, {
      version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 0, isSeeded: false,
    })
    const operations = {
      schemas: [],
      programSchemas: [],
      promptText: '',
      async execute() { throw new Error('no tool should be invoked') },
      async dispose() {
        if (id === 'registry-release-a') {
          cleanupAEntered.resolve(undefined)
          throw failure
        }
        cleanupBEntered.resolve(undefined)
        await settleCleanupB.promise
      },
    }
    const owner: NativeSessionExecutionOwner = {
      agent,
      session,
      config: { cwd: '/', provider: 'test', model: 'test', systemPrompt: '', maxSteps: 1 },
      async captureExternalTools() { return operations },
      async delegate() { return { exitCode: 0 } },
    }
    const releaseOwner = registry.register(owner)
    return { agent, session, releaseAgent, releaseOwner }
  })
  await Promise.all(registrations.map(({ agent, session }) => agents.withInitiator(agent, () =>
    registry.captureExternalTools(agent, session, {
      depth: 1, maxDepth: 2, cwd: '/', provider: 'test', model: 'test', maxSteps: 1,
      toolNames: [], builtinToolNames: [], programToolNames: [],
    }, new AbortController().signal))))

  const disposal = registry.dispose()
  let disposalSettled = false
  const observedDisposal = disposal.then(() => { disposalSettled = true }, () => { disposalSettled = true })
  try {
    await Promise.all([cleanupAEntered.promise, cleanupBEntered.promise])
    const releaseFailure: unknown = await registrations[0]!.releaseOwner().then(() => undefined, (reason: unknown) => reason)
    expect(releaseFailure).toBeInstanceOf(AggregateError)
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(registry.dispose()).toBe(disposal)
    expect(disposalSettled).toBe(false)
  } finally {
    settleCleanupB.resolve(undefined)
    await observedDisposal
    await Promise.all(registrations.map(({ releaseAgent }) => releaseAgent()))
  }
  expect(disposalSettled).toBe(true)
  const error: unknown = await disposal.catch((reason: unknown) => reason)
  expect(error).toBeInstanceOf(AggregateError)
  expect((error as AggregateError).errors).toHaveLength(1)
  expect((error as AggregateError).errors[0]).toBeInstanceOf(AggregateError)
  expect(((error as AggregateError).errors[0] as AggregateError).errors).toEqual([failure])
})

it('disposes a capture that settles after parent release and drains before release completes', async () => {
  const agents = new NativeAgentRegistry({ emit() {} })
  const agent = { id: NativeAgentId('external-capture-session'), scope: new NativeScope() }
  const releaseAgent = agents.register(agent)
  const sessionId = SessionId('external-capture-session')
  const session = Session.create(sessionId, undefined, {
    version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 0, isSeeded: false,
  })
  const registry = new NativeSessionExecutionRegistry(agents)
  const captureEntered = Promise.withResolvers<undefined>()
  const settleCapture = Promise.withResolvers<undefined>()
  const disposeEntered = Promise.withResolvers<undefined>()
  const settleDispose = Promise.withResolvers<undefined>()
  const operations = {
    schemas: [],
    programSchemas: [],
    promptText: '',
    async execute() { throw new Error('no tool should be invoked') },
    dispose: vi.fn(async () => { disposeEntered.resolve(undefined); await settleDispose.promise }),
  }
  const owner: NativeSessionExecutionOwner = {
    agent,
    session,
    config: { cwd: '/', provider: 'test', model: 'test', systemPrompt: '', maxSteps: 1 },
    async captureExternalTools() {
      captureEntered.resolve(undefined)
      await settleCapture.promise
      return operations
    },
    async delegate() { return { exitCode: 0 } },
  }
  const releaseOwner = registry.register(owner)
  const capture = agents.withInitiator(agent, () => registry.captureExternalTools(agent, session, {
    depth: 1, maxDepth: 2, cwd: '/', provider: 'test', model: 'test', maxSteps: 1,
    toolNames: [], builtinToolNames: [], programToolNames: [],
  }, new AbortController().signal))
  await captureEntered.promise

  const release = releaseOwner()
  settleCapture.resolve(undefined)
  await disposeEntered.promise
  let releaseSettled = false
  void release.then(() => { releaseSettled = true })
  await Promise.resolve()
  expect(releaseSettled).toBe(false)

  settleDispose.resolve(undefined)
  await expect(capture).rejects.toThrow()
  await release
  expect(operations.dispose).toHaveBeenCalledOnce()
  await releaseAgent()
})

it('captures the prepared provider generation and drains an undelivered response before closing', async () => {
  const agents = new NativeAgentRegistry({ emit() {} })
  const agent = { id: NativeAgentId('external-responses-session'), scope: new NativeScope() }
  const releaseAgent = agents.register(agent)
  const sessionId = SessionId('external-responses-session')
  const session = Session.create(sessionId, undefined, {
    version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 0, isSeeded: false,
  })
  const captureEntered = Promise.withResolvers<undefined>()
  const releaseResponse = Promise.withResolvers<undefined>()
  const bodyCancelEntered = Promise.withResolvers<undefined>()
  const releaseBodyCancel = Promise.withResolvers<undefined>()
  const transportCloseEntered = Promise.withResolvers<undefined>()
  const releaseTransportClose = Promise.withResolvers<undefined>()
  let currentGeneration = 'prepared'
  let preparedCount = 0
  const capturedGenerations: string[] = []
  let transportClosed = false
  const body = new ReadableStream<Uint8Array>({
    async cancel() {
      bodyCancelEntered.resolve(undefined)
      await releaseBodyCancel.promise
    },
  })
  const transport = {
    route: { provider: 'test', model: 'test' },
    outputTokenLimit: 'unsupported' as const,
    async projectRequest(request: null) { return request },
    async forward() {
      captureEntered.resolve(undefined)
      await releaseResponse.promise
      return { status: 200, contentType: 'text/event-stream', body }
    },
    async close() {
      transportCloseEntered.resolve(undefined)
      await releaseTransportClose.promise
      transportClosed = true
    },
  }
  const modelExecution = new NativeModelExecution({
    async prepareCall(provider, model) {
      const generation = currentGeneration
      preparedCount++
      return {
        model: { provider, id: model, name: model },
        supportsOutputTokenLimit: async () => false,
        async *stream() {},
        nativeResponses: { async capture() {
          capturedGenerations.push(generation)
          return transport
        } },
      }
    },
    async *stream() {},
  })
  const prepared = await modelExecution.prepareStep({ provider: 'test', model: 'test' })
  currentGeneration = 'replacement'
  const owner: NativeSessionExecutionOwner = {
    agent,
    session,
    config: { cwd: '/', provider: 'test', model: 'test', systemPrompt: '', maxSteps: 1 },
    captureExternalResponses: (route, maxTokens, _reasoningEffort, signal) =>
      modelExecution.captureResponsesOperation(prepared, route, maxTokens, signal),
    async delegate() { return { exitCode: 0 } },
  }
  const registry = new NativeSessionExecutionRegistry(agents)
  const releaseOwner = registry.register(owner)
  const captured = await agents.withInitiator(agent, () => registry.captureExternalResponses(agent, session,
    { provider: 'test', model: 'test' }, undefined, undefined, new AbortController().signal))
  expect(preparedCount).toBe(1)
  expect(capturedGenerations).toEqual(['prepared'])

  const forward = captured.transport.forward(null, new AbortController().signal)
  await captureEntered.promise
  const closing = captured.transport.close()
  await expect(captured.transport.projectRequest(null, new AbortController().signal)).rejects.toThrow('transport is closed')
  releaseResponse.resolve(undefined)
  await bodyCancelEntered.promise
  expect(transportClosed).toBe(false)
  releaseBodyCancel.resolve(undefined)
  await expect(forward).rejects.toThrow()
  await transportCloseEntered.promise
  expect(transportClosed).toBe(false)
  releaseTransportClose.resolve(undefined)
  await closing
  expect(transportClosed).toBe(true)
  await expect(captured.generation.capture({ route: { provider: 'test', model: 'test' } }, new AbortController().signal))
    .rejects.toThrow('Responses transport is closed')
  expect(capturedGenerations).toEqual(['prepared'])
  expect(preparedCount).toBe(1)
  await releaseOwner()
  await releaseAgent()
})
