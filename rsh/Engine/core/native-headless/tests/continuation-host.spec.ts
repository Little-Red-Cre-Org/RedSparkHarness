/** Real native Host continuation turns share the selected model executor and released Session writer. */
import { mkdtemp, rm } from 'node:fs/promises'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as storagePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { plugin as agentPlugin, NativeAgentId, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type { NativeAgentExecution } from '@deepseek-ai/dsh-native-agent'
import { plugin as executionPlugin, type NativeSessionExecutionOperations, type NativeSessionContinuation,
  type NativeActiveSessionOperations, type NativeActiveSessionOwner,
  type NativeContinuationObservation } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeRootRouteId } from '@deepseek-ai/dsh-native-session-execution'
import { plugin as modelExecutionPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { plugin as meterPlugin, type NativeTokenMeterOperations } from '@deepseek-ai/dsh-token-meter/native'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import type { NativeToolDelegationContext, NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import { plugin as presetsPlugin, type NativeAgentPresetOperations } from '@deepseek-ai/dsh-agent-presets/native'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session/native'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { SessionPersistenceCorruptionError } from '@deepseek-ai/dsh-session-persistence/native'
import { NativeSessionProjectionRegistry, type NativeProjectionDefinition } from '@deepseek-ai/dsh-session-projection/native'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { NativeAgentInstructions } from '@deepseek-ai/dsh-agent-instructions/native'
import type { NativeRequestContexts } from '@deepseek-ai/dsh-request-context-definition'
import { MockAdapter, textResponse, toolCallResponse } from '../../agent-loop/tests/mock-adapter.ts'
import { NativeHeadlessApplication, plugin as appPlugin } from '../src/native.ts'
import { NativeContinuationActivation } from '../src/continuation-activation.ts'
import type { NativeContinuationSession } from '../src/continuation-session.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    'test/native-observer-first': number
    'test/native-observer-second': number
  }

  interface SessionProjectionMap {
    'test/native-observer-first': number
    'test/native-observer-second': number
  }
}

type NativeObserverKey = 'test/native-observer-first' | 'test/native-observer-second'
type NativeObserverUnit = Omit<NativeProjectionDefinition<NativeObserverKey, number>, 'wire'> & {
  wire: NonNullable<NativeProjectionDefinition<NativeObserverKey, number>['wire']>
}

const observerUnit = (key: NativeObserverKey): NativeObserverUnit => ({
  key,
  stateSchema: z.number(),
  init: () => 0,
  apply: state => state + 1,
  wire: { viewSchema: z.number(), view: state => state },
  stateVersion: 1,
})

async function fixture(script: ConstructorParameters<typeof MockAdapter>[0], selectedPreset = false,
  providers: readonly NativePlugin[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'rsh-continuation-host-'))
  const scope = new NativeScope()
  const model = new MockAdapter(script)
  let app: NativeHeadlessApplication | undefined
  let storage: NativeSessionPersistenceOperations | undefined
  let agents: NativeAgentRegistry | undefined
  let execution: NativeSessionExecutionOperations | undefined
  let tools: NativeToolRegistry | undefined
  let activeSessions: NativeActiveSessionOperations | undefined
  let presets: NativeAgentPresetOperations | undefined
  let meter: NativeTokenMeterOperations | undefined
  const capture: NativePlugin = { apiVersion: 1, name: 'continuation-capture', targets: ['host'],
    requires: ['application', 'sessionPersistence', 'agents', 'sessionExecution', 'tools', 'activeSessions', 'tokenMeter'],
    optional: ['agentPresets'], provides: [],
    resolve: () => (context) => {
      const application = context.require('application')
      if (!(application instanceof NativeHeadlessApplication)) throw new Error('missing native headless')
      app = application
      storage = context.require('sessionPersistence')
      agents = context.require('agents')
      execution = context.require('sessionExecution')
      tools = context.require('tools')
      activeSessions = context.require('activeSessions')
      presets = context.optional('agentPresets')
      meter = context.require('tokenMeter')
    } }
  const modelProvider: NativePlugin = { apiVersion: 1, name: 'continuation-model', targets: ['host'],
    requires: [], provides: ['model'], resolve: () => (context) => { context.provide('model', model) } }
  const standing: NativePlugin = { apiVersion: 1, name: 'test-standing', targets: ['host'], requires: ['agentPresets'],
    provides: [], resolve: () => (context) => {
      context.effect(context.require('agentPresets').register({ id: 'test', name: 'Test', scope }))
    } }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    ...providers.map(plugin => ({ plugin, scope, config: undefined })),
    { plugin: appPlugin, scope, config: { cwd: root, provider: 'mock', model: 'parent', systemPrompt: 'Parent.', maxSteps: 4 } },
    { plugin: executionPlugin, scope, config: undefined },
    { plugin: agentPlugin, scope, config: undefined },
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: modelExecutionPlugin, scope, config: undefined },
    { plugin: meterPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: root } },
    { plugin: storagePlugin, scope, config: { root: join(root, 'sessions'), compression: 'none' } },
    { plugin: modelProvider, scope, config: undefined },
    ...selectedPreset ? [{ plugin: presetsPlugin, scope, config: { default: 'test' } },
      { plugin: standing, scope, config: undefined }] : [],
  ], 'host'))
  await host.start()
  if (app === undefined || storage === undefined || agents === undefined || execution === undefined || tools === undefined
    || activeSessions === undefined || meter === undefined) {
    throw new Error('missing continuation fixture services')
  }
  return { root, host, scope, model, app, storage, agents, execution, tools, activeSessions, meter, events: host.events, presets,
    async close() { await host.stop(); await rm(root, { recursive: true }) } }
}


it('reprepares a same-id text edit made while admitted instructions are preparing', async () => {
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const prepared: string[][] = []
  const instructions = {
    seed() {},
    async prepare(_session: unknown, inputs: readonly UserMessage[]) {
      prepared.push(inputs.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])))
      if (prepared.length === 1) { entered.resolve(undefined); await release.promise }
      return []
    },
  } as unknown as NativeAgentInstructions
  const provider: NativePlugin = { apiVersion: 1, name: 'test-instructions', targets: ['host'],
    requires: [], provides: ['agentInstructions'],
    resolve: () => (context) => { context.provide('agentInstructions', instructions) } }
  const state = await fixture([textResponse('Edited input accepted.')], false, [provider])
  const id = SessionId('same-id-edit-during-instructions')
  const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Original queued text.' }] })
  const signal = new AbortController().signal
  let active: NativeActiveSessionOwner | undefined
  const attached = state.activeSessions.onAttached(async (owner) => {
    if (owner.session.id !== id) return
    active = owner
    await owner.enqueue(message, 'next-step', false, signal)
  })
  try {
    const running = state.app.executeRootTurn({ id, resume: false }, signal)
    await entered.promise
    if (active === undefined) throw new Error('the exact active owner was not attached')
    await expect(active.editPendingText(message.id, [{ type: 'text', text: 'Edited queued text.' }], signal))
      .resolves.toEqual({ kind: 'updated' })
    release.resolve(undefined)
    await expect(running).resolves.toMatchObject({ answer: 'Edited input accepted.' })

    expect(prepared).toHaveLength(2)
    expect(prepared[0]).toContain('Original queued text.')
    expect(prepared[1]).toContain('Edited queued text.')
    const wire = JSON.stringify(state.model.requests[0]?.messages)
    expect(wire).toContain('Edited queued text.')
    expect(wire).not.toContain('Original queued text.')
    const reader = await state.storage.open(id, 'read')
    try {
      const events = (await reader.read()).events
      const splice = events.find(event => event.type === 'agent/inbox/spliced'
        && event.data.removedCount === 1
        && event.data.outcome === 'canceled'
        && event.data.inserted.some(inserted => inserted.id === message.id))
      if (splice?.type !== 'agent/inbox/spliced') throw new Error('the durable edit splice was not recorded')
      expect(splice.data.target).toBe('next-step')
      expect(splice.data.removedCount).toBe(1)
      expect(splice.data.outcome).toBe('canceled')
      expect(splice.data.inserted).toHaveLength(1)
      expect(splice.data.inserted[0]?.id).toBe(message.id)
      expect(splice.data.inserted[0]?.content).toEqual([{ type: 'text', text: 'Edited queued text.' }])
      const userEvent = events.find(event => event.type === 'user/message')
      if (userEvent?.type !== 'user/message') throw new Error('the edited user message was not committed')
      expect(userEvent.data.id).toBe(message.id)
      expect(userEvent.data.content).toEqual([{ type: 'text', text: 'Edited queued text.' }])
    } finally { await reader.close() }
  } finally {
    release.resolve(undefined)
    await attached()
    await state.close()
  }
})

it.each([
  ['while the model is streaming', 'streaming'],
  ['during final turn settlement', 'wrap-up'],
  ['after abort before settlement', 'second-wake'],
] as const)('parks pending root steers when cancellation lands %s', async (_label, timing) => {
  const script: ConstructorParameters<typeof MockAdapter>[0] = timing === 'wrap-up'
    ? [textResponse('First root turn completed.'), textResponse('Pending steer consumed.')]
    : ['hang', textResponse('Pending steer consumed.')]
  const state = await fixture(script)
  const streamStarted = Promise.withResolvers<undefined>()
  const releaseStream = Promise.withResolvers<undefined>()
  const originalStream = state.model.stream.bind(state.model)
  let holdFirstStream = timing !== 'wrap-up'
  vi.spyOn(state.model, 'stream').mockImplementation(async function* (options) {
    for await (const chunk of originalStream(options)) {
      yield chunk
      if (holdFirstStream && chunk.type === 'text-delta') {
        holdFirstStream = false
        streamStarted.resolve(undefined)
        await releaseStream.promise
      }
    }
  })
  const id = SessionId(`root-cancel-inbox-${timing}`)
  const steer = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'First pending steer.' }] })
  const secondSteer = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Second pending steer.' }] })
  const controller = new AbortController()
  const settlementEntered = Promise.withResolvers<undefined>()
  const releaseSettlement = Promise.withResolvers<undefined>()
  const ownerAttached = Promise.withResolvers<undefined>()
  let holdSettlement = timing === 'wrap-up'
  let owner: NativeActiveSessionOwner | undefined
  let execution: NativeAgentExecution | undefined
  let removeIdle: (() => Promise<void>) | undefined
  const attached = state.activeSessions.onAttached(async (active) => {
    if (active.session.id !== id) return
    owner = active
    execution = state.agents.execution(active.agent)
    if (holdSettlement) {
      removeIdle = active.onIdle(async () => {
        if (!holdSettlement) return
        holdSettlement = false
        settlementEntered.resolve(undefined)
        await releaseSettlement.promise
      })
    }
    ownerAttached.resolve(undefined)
  })
  const running = state.app.executeRootTurn({ id, resume: false }, controller.signal)
    .then(value => ({ value }), error => ({ error }))
  try {
    await ownerAttached.promise
    if (owner === undefined || execution === undefined) throw new Error('the exact active root owner was not attached')
    const rootOwner = owner
    const rootExecution = execution

    if (timing === 'wrap-up') {
      await settlementEntered.promise
      await rootOwner.enqueue(steer, 'next-step', true, controller.signal)
      controller.abort({ kind: 'user' })
      releaseSettlement.resolve(undefined)
      expect(await running).toHaveProperty('value')
    } else {
      await streamStarted.promise
      await rootOwner.enqueue(steer, 'next-step', true, controller.signal)
      controller.abort({ kind: 'user' })
      if (timing === 'second-wake') {
        await rootOwner.enqueue(secondSteer, 'next-step', true, new AbortController().signal)
      }
      releaseStream.resolve(undefined)
      expect(await running).toHaveProperty('error')
    }

    await vi.waitFor(() => expect(rootExecution.status).toBe('idle'))
    if (timing === 'second-wake') {
      const reader = await state.storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'turn/start')).toHaveLength(2)
        expect(events.filter(event => event.type === 'user/message' && event.data.id === steer.id)).toHaveLength(1)
        expect(events.filter(event => event.type === 'user/message' && event.data.id === secondSteer.id)).toHaveLength(1)
        expect(events.filter(event => event.type === 'agent/inbox/spliced'
          && event.data.inserted.some(message => message.id === steer.id))).toHaveLength(1)
        expect(events.filter(event => event.type === 'agent/inbox/spliced'
          && event.data.inserted.some(message => message.id === secondSteer.id))).toHaveLength(1)
      } finally { await reader.close() }
      expect(state.model.requests).toHaveLength(2)
    } else {
      const pendingReader = await state.storage.open(id, 'read')
      try {
        const events = (await pendingReader.read()).events
        expect(events.filter(event => event.type === 'turn/start')).toHaveLength(1)
        expect(events.filter(event => event.type === 'agent/inbox/spliced'
          && event.data.inserted.some(message => message.id === steer.id))).toHaveLength(1)
        expect(events.filter(event => event.type === 'user/message' && event.data.id === steer.id)).toHaveLength(0)
      } finally { await pendingReader.close() }

      await expect(state.app.executeRootTurn({ id, resume: true }, new AbortController().signal))
        .resolves.toMatchObject({ answer: 'Pending steer consumed.' })
      await vi.waitFor(() => expect(rootExecution.status).toBe('idle'))
      const reader = await state.storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'turn/start')).toHaveLength(2)
        expect(events.filter(event => event.type === 'user/message' && event.data.id === steer.id)).toHaveLength(1)
      } finally { await reader.close() }
      expect(state.model.requests).toHaveLength(2)
    }
  } finally {
    releaseStream.resolve(undefined)
    releaseSettlement.resolve(undefined)
    if (!controller.signal.aborted) controller.abort({ kind: 'user' })
    await running
    await attached()
    await removeIdle?.()
    await state.close()
  }
})

it('re-admits a promoted captured next-turn head while request contexts await acceptance', async () => {
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const calls: { readonly inputs: readonly UserMessage[]; readonly durableTypes: readonly string[] }[] = []
  const contexts = {
    hasProviders: () => true,
    async prepareAndAccept(request: { readonly inputs: readonly UserMessage[]; readonly durableEvents: readonly SessionEvent[] },
      accept: (messages: readonly UserMessage[]) => Promise<'accepted' | 'rejected'>) {
      calls.push({ inputs: structuredClone(request.inputs), durableTypes: request.durableEvents.map(event => event.type) })
      if (calls.length === 1) { entered.resolve(undefined); await release.promise }
      return accept([])
    },
  } as unknown as NativeRequestContexts
  const provider: NativePlugin = { apiVersion: 1, name: 'test-request-contexts', targets: ['host'],
    requires: [], provides: ['requestContexts'],
    resolve: () => (context) => { context.provide('requestContexts', contexts) } }
  const state = await fixture([textResponse('Promoted input accepted.')], false, [provider])
  const id = SessionId('promote-during-request-contexts')
  const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Queued head.' }] })
  const signal = new AbortController().signal
  let active: NativeActiveSessionOwner | undefined
  let execution: ReturnType<typeof state.agents.execution> | undefined
  const attached = state.activeSessions.onAttached(async (owner) => {
    if (owner.session.id !== id) return
    active = owner
    execution = state.agents.execution(owner.agent)
    await owner.enqueue(message, 'next-turn', false, signal)
  })
  try {
    const running = state.app.executeRootTurn({ id, resume: false }, signal)
    await entered.promise
    if (active === undefined || execution === undefined) throw new Error('the exact active owner was not attached')
    const runAgent = vi.spyOn(execution, 'run')
    await expect(active.promotePending(message.id, signal)).resolves.toEqual({ kind: 'promoted' })
    release.resolve(undefined)
    await expect(running).resolves.toMatchObject({ answer: 'Promoted input accepted.' })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.inputs).toEqual(calls[1]?.inputs)
    expect(calls[0]?.inputs.map(input => input.id)).toEqual([message.id])
    expect(calls[0]?.durableTypes).not.toContain('agent/inbox/moved')
    expect(calls[1]?.durableTypes).toContain('agent/inbox/moved')
    expect(runAgent).not.toHaveBeenCalled()
    expect(state.model.requests).toHaveLength(1)
    expect(JSON.stringify(state.model.requests[0]?.messages).split('Queued head.')).toHaveLength(2)
  } finally {
    release.resolve(undefined)
    await attached()
    await state.close()
  }
})

it('does not wake after promotion durability crosses the input claim', async () => {
  const entered = Promise.withResolvers<undefined>()
  const releasePreparation = Promise.withResolvers<undefined>()
  const flushEntered = Promise.withResolvers<undefined>()
  const releaseFlush = Promise.withResolvers<undefined>()
  const prepared: string[][] = []
  const instructions = {
    seed() {},
    async prepare(_session: unknown, inputs: readonly UserMessage[]) {
      prepared.push(inputs.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])))
      if (prepared.length === 1) { entered.resolve(undefined); await releasePreparation.promise }
      return []
    },
  } as unknown as NativeAgentInstructions
  const provider: NativePlugin = { apiVersion: 1, name: 'test-instructions', targets: ['host'],
    requires: [], provides: ['agentInstructions'],
    resolve: () => (context) => { context.provide('agentInstructions', instructions) } }
  const state = await fixture([textResponse('Promoted input accepted.')], false, [provider])
  const id = SessionId('promote-flush-cross-claim')
  const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Queued head.' }] })
  const signal = new AbortController().signal
  let holdFlush = false
  let writer: Awaited<ReturnType<NativeSessionPersistenceOperations['create']>> | undefined
  const create = state.storage.create.bind(state.storage)
  const captureWriter = vi.spyOn(state.storage, 'create').mockImplementation(async (header, options) => {
    const created = await create(header, options)
    writer = created
    const flush = created.flush.bind(created)
    vi.spyOn(created, 'flush').mockImplementation(async (flushOptions) => {
      if (holdFlush) {
        holdFlush = false
        flushEntered.resolve(undefined)
        await releaseFlush.promise
      }
      return flush(flushOptions)
    })
    return created
  })
  let active: NativeActiveSessionOwner | undefined
  let execution: ReturnType<typeof state.agents.execution> | undefined
  const attached = state.activeSessions.onAttached(async (owner) => {
    if (owner.session.id !== id) return
    active = owner
    execution = state.agents.execution(owner.agent)
    await owner.enqueue(message, 'next-turn', false, signal)
  })
  try {
    const running = state.app.executeRootTurn({ id, resume: false }, signal)
    await entered.promise
    if (active === undefined || execution === undefined || writer === undefined) {
      throw new Error('the exact active owner and its writer were not attached')
    }
    const runAgent = vi.spyOn(execution, 'run')
    holdFlush = true
    const promotion = active.promotePending(message.id, signal)
    let promotionCompleted = false
    void promotion.then(() => { promotionCompleted = true })
    await flushEntered.promise
    expect(promotionCompleted).toBe(false)
    releasePreparation.resolve(undefined)
    await vi.waitFor(() => {
      expect(prepared).toHaveLength(2)
      expect(active?.messages('next-turn')).toEqual([])
      expect(active?.messages('next-step')).toEqual([])
    })
    releaseFlush.resolve(undefined)
    await expect(promotion).resolves.toEqual({ kind: 'promoted' })
    expect(runAgent).not.toHaveBeenCalled()
    await expect(running).resolves.toMatchObject({ answer: 'Promoted input accepted.' })

    expect(prepared).toEqual([['Queued head.'], ['Queued head.']])
    expect(state.model.requests).toHaveLength(1)
  } finally {
    releasePreparation.resolve(undefined)
    releaseFlush.resolve(undefined)
    await attached()
    captureWriter.mockRestore()
    await state.close()
  }
})

it('rejects teardown-time mutations and completes an admitted promotion without a late wake', async () => {
  const state = await fixture([])
  const id = SessionId('promotion-during-owner-teardown')
  const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Durable queued head.' }] })
  const flushEntered = Promise.withResolvers<undefined>()
  const releaseFlush = Promise.withResolvers<undefined>()
  let holdFlush = false
  let writer: Awaited<ReturnType<NativeSessionPersistenceOperations['create']>> | undefined
  const create = state.storage.create.bind(state.storage)
  const captureWriter = vi.spyOn(state.storage, 'create').mockImplementation(async (header, options) => {
    const created = await create(header, options)
    writer = created
    const flush = created.flush.bind(created)
    vi.spyOn(created, 'flush').mockImplementation(async (flushOptions) => {
      if (holdFlush) {
        holdFlush = false
        flushEntered.resolve(undefined)
        await releaseFlush.promise
      }
      return flush(flushOptions)
    })
    return created
  })
  const signal = new AbortController().signal
  let active: NativeActiveSessionOwner | undefined
  let releaseRetention: (() => void) | undefined
  const attached = state.activeSessions.onAttached(async (owner) => {
    if (owner.session.id !== id) return
    active = owner
    releaseRetention = owner.retain()
  })
  try {
    await state.app.executeSessionOperation({ id, resume: false }, async (owner) => {
      await owner.enqueue(message, 'next-turn', false, signal)
    }, signal)
    if (active === undefined || writer === undefined) throw new Error('the retained active writer was not captured')

    holdFlush = true
    const promotion = active.promotePending(message.id, signal)
    await flushEntered.promise
    const disposing = state.app.dispose()
    let mutationError: unknown
    try { void active.editPendingText(message.id, [{ type: 'text', text: 'Too late.' }], new AbortController().signal) }
    catch (error: unknown) { mutationError = error }
    expect(mutationError).toBeDefined()

    releaseFlush.resolve(undefined)
    await expect(promotion).resolves.toEqual({ kind: 'promoted' })
    await disposing
    const reader = await state.storage.open(id, 'read')
    try {
      expect((await reader.read()).events).toContainEqual(expect.objectContaining({
        type: 'agent/inbox/moved', data: { messageId: message.id },
      }))
    } finally { await reader.close() }
    expect(state.model.requests).toHaveLength(0)
  } finally {
    releaseFlush.resolve(undefined)
    releaseRetention?.()
    await attached()
    captureWriter.mockRestore()
    await state.close()
  }
})


it('reports projection observers without starving units or poisoning the retained writer', async () => {
  const state = await fixture([])
  const id = SessionId('projection-observer-failure')
  const projections = new NativeSessionProjectionRegistry()
  projections.register(observerUnit('test/native-observer-first'))
  projections.register(observerUnit('test/native-observer-second'))
  const changed: string[] = []
  const accepted: string[] = []
  const observerFailure = new Error('projection subscriber failed')
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  projections.onChanged(() => { throw observerFailure })
  projections.onChanged((_session, key) => { changed.push(key) })

  try {
    await state.app.executeSessionOperation({ id, resume: false }, async (owner) => {
      projections.attach(owner)
      const removeFailure = owner.onEvent(() => { throw observerFailure })
      const removeAccepted = owner.onEvent((event) => { accepted.push(event.type) })
      try {
        owner.append('turn/start', { turn: 1 })
        await owner.flush()
        owner.append('step/start', { turn: 1, step: 1 })
        await owner.flush()

        expect(projections.stateOf(owner.session, 'test/native-observer-first')).toBe(2)
        expect(projections.stateOf(owner.session, 'test/native-observer-second')).toBe(2)
      } finally {
        removeFailure()
        removeAccepted()
        projections.detach(owner)
      }
    }, new AbortController().signal)

    expect(changed).toEqual([
      'test/native-observer-first', 'test/native-observer-second',
      'test/native-observer-first', 'test/native-observer-second',
    ])
    expect(accepted).toEqual(['turn/start', 'step/start'])
    expect(report).toHaveBeenCalledTimes(6)
    expect(report).toHaveBeenCalledWith('native-continuation: accepted-event observer failed', observerFailure)
    const reader = await state.storage.open(id, 'read')
    try {
      expect((await reader.read()).events.map(event => event.type)).toEqual(['turn/start', 'step/start'])
    } finally {
      await reader.close()
    }
  } finally {
    projections.dispose()
    report.mockRestore()
    await state.close()
  }
})



it('routes root maintenance and execution through the original Agent without an extra model turn', async () => {
  const state = await fixture([textResponse('Scheduled root complete.').map(chunk => chunk.type === 'usage'
    ? { ...chunk, usage: { inputTokens: 1000, outputTokens: 20, cacheReadTokens: 50 } } : chunk), textResponse('Capacity unknown.')])
  const signal = new AbortController().signal
  const id = SessionId('scheduled-root')
  const routeId = brandString<NativeRootRouteId>('root')
  let original: NativeActiveSessionOwner | undefined
  try {
    const route = state.app.rootExecution.resolve(routeId)
    expect(Object.isFrozen(route)).toBe(true)
    expect(Object.isFrozen(route.configuration)).toBe(true)
    await state.app.rootExecution.maintenance({ route: routeId, id, resume: false }, async (owner) => {
      original = owner
      expect(state.app.rootExecution.capture(owner)).toBe(route)
      expect(state.model.requests).toHaveLength(0)
    }, signal)
    expect(await state.app.rootExecution.settle({ route: routeId, id }, signal)).toBeUndefined()
    expect(state.model.requests).toHaveLength(0)
    if (original === undefined) throw new Error('root maintenance did not attach its owner')
    const completedOwner = original
    expect(() => state.app.rootExecution.capture(completedOwner)).toThrow('exact attached root owner')
    const resolveModel = state.model.resolveModel.bind(state.model)
    const metadata = vi.spyOn(state.model, 'resolveModel').mockImplementation(async (provider, model) => ({
      ...await resolveModel(provider, model), context: { contextWindow: 8192 },
    }))
    const measured: { capacity: number | undefined; baseline: string; tokens: number }[] = []
    const observe = (): void => {
      const owner = state.activeSessions.owners().find(candidate => candidate.session.id === id)
      if (owner === undefined) throw new Error('missing original meter owner')
      expect(state.app.rootExecution.capture(owner)).toBe(route)
      const measurement = state.meter.measure(owner.session)
      measured.push({ capacity: owner.session.requestContext()?.contextWindow,
        baseline: measurement.baseline.kind, tokens: measurement.totalTokens })
    }
    const result = await state.app.rootExecution.execute({ route: routeId, id, resume: true,
      message: createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'text', text: 'Run the scheduled root.' }] }),
      onEvent: (event) => { if (event.type === 'assistant/message') observe() } }, signal)
    expect(result.answer).toBe('Scheduled root complete.')
    expect(state.model.requests).toHaveLength(1)
    expect(JSON.stringify(state.model.requests[0]?.messages)).toContain('Run the scheduled root.')
    expect(state.agents.get(original.agent.id)).toBe(original.agent)
    expect(measured).toEqual([{ capacity: 8192, baseline: 'usage', tokens: 1070 }])
    metadata.mockRestore()
    await state.app.rootExecution.execute({ route: routeId, id, resume: true,
      message: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue.' }] }),
      onEvent: (event) => { if (event.type === 'assistant/message') observe() } }, signal)
    expect(measured[1]).toMatchObject({ capacity: undefined, baseline: 'estimated' })
    await state.app.dispose()
    expect(() => state.app.rootExecution.settle({ route: routeId, id }, signal)).toThrow('application is disposed')
  } finally { await state.close() }
})

it('settles each root turn while a background owner keeps the same writer for a later prompt', async () => {
  const state = await fixture([textResponse('First reply.'), textResponse('Second reply.')])
  const id = SessionId('background-owner-root')
  const signal = new AbortController().signal
  let releaseBackground: (() => void) | undefined
  const attached = Promise.withResolvers<undefined>()
  const remove = state.activeSessions.onAttached(async (owner) => {
    if (owner.session.id !== id) return
    releaseBackground = owner.retainBackground()
    attached.resolve(undefined)
  })
  try {
    const first = state.app.executeRootTurn({ id, resume: false, message: createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: 'First question.' }] }) }, signal)
    await attached.promise
    await expect(first).resolves.toMatchObject({ answer: 'First reply.' })
    expect(state.activeSessions.owners().find(owner => owner.session.id === id)?.writerAvailable).toBe(true)

    await expect(state.app.executeRootTurn({ id, resume: true, message: createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: 'Second question.' }] }) }, signal)).resolves.toMatchObject({ answer: 'Second reply.' })
    expect(state.model.requests).toHaveLength(2)
    let fullySettled = false
    const settlement = state.app.waitRootSettlement(id, signal).then(() => { fullySettled = true })
    await Promise.resolve()
    expect(fullySettled).toBe(false)

    releaseBackground?.()
    releaseBackground = undefined
    await settlement
    expect(state.activeSessions.owners().some(owner => owner.session.id === id)).toBe(false)
  } finally {
    releaseBackground?.()
    await remove()
    await state.close()
  }
})

it('does not mark a continuation foreground-settled before queued turns finish, but drains its background owner later', async () => {
  let queued = 0
  let closed = false
  const owner = {
    get hasPending() { return queued > 0 },
    async enqueue(message: { readonly id: string }) { queued++; return message.id },
    async discard() { queued = 0 },
    async close() { closed = true },
  } as unknown as NativeContinuationSession
  const gates = [Promise.withResolvers<undefined>(), Promise.withResolvers<undefined>()]
  const started = [Promise.withResolvers<undefined>(), Promise.withResolvers<undefined>()]
  let runs = 0
  const execution = {
    run: (operation: (signal: AbortSignal) => Promise<unknown>) => operation(new AbortController().signal),
  } as unknown as NativeAgentExecution
  const activation = new NativeContinuationActivation(owner, execution, {
    async run() {
      const index = runs++
      started[index]?.resolve(undefined)
      await gates[index]!.promise
      queued--
      return { exitCode: 0 }
    },
    async release() {}, async settled() {},
  }, false)
  const releaseBackground = activation.retainBackground()
  try {
    await activation.enqueue(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'First.' }] }), 'next-turn', new AbortController().signal)
    await started[0]!.promise
    await activation.enqueue(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Second.' }] }), 'next-turn', new AbortController().signal)
    let foregroundFinished = false
    const foreground = activation.waitForeground()
    void foreground.then(() => { foregroundFinished = true })
    gates[0]!.resolve(undefined)
    await started[1]!.promise
    expect(foregroundFinished).toBe(false)
    gates[1]!.resolve(undefined)
    await foreground
    expect(foregroundFinished).toBe(true)
    expect(activation.isRetained).toBe(true)
    expect(closed).toBe(false)
  } finally {
    gates.forEach((gate) => { gate.resolve(undefined) })
    releaseBackground()
    await activation.done
  }
  expect(closed).toBe(true)
})

it('catalogs selected descendants through ordinary sessions and rejects foreign inspection paths', async () => {
  const state = await fixture([])
  const signal = new AbortController().signal
  const parent = SessionId('catalog-parent')
  const ordinary = SessionId('catalog-ordinary')
  const child = SessionId('catalog-child')
  const damaged = SessionId('catalog-damaged')
  const damagedChild = SessionId('catalog-damaged-child')
  const wrongDepth = SessionId('catalog-wrong-depth')
  const foreign = SessionId('catalog-foreign')
  const createdAt = Date.now()
  try {
    await state.app.executeSessionOperation({ id: parent, resume: false }, async (owner) => {
      for (const [id, parentSession, cwd, origin, depth] of [
        [ordinary, parent, state.root, undefined, 0],
        [child, ordinary, state.root, 'subagent', 1],
        [damaged, parent, state.root, undefined, 0],
        [damagedChild, damaged, state.root, 'subagent', 1],
        [wrongDepth, parent, state.root, 'subagent', 0],
        [foreign, ordinary, join(state.root, 'other'), 'subagent', 1],
      ] as const) {
        const writer = await state.storage.create({ version: SESSION_FORMAT_VERSION, id, parentSession,
          createdAt, cwd, isSeeded: false, delegationDepth: depth, ...origin === undefined ? {} : { origin } })
        await writer.flush()
        await writer.close()
      }
      const operations = state.execution.continuations!(owner.agent, owner.session)
      expect(await operations.catalog('children', signal)).toEqual([])
      expect(await operations.catalog('descendants', signal)).toEqual([
        { path: [damaged, damagedChild], status: 'ready' },
        { path: [ordinary, child], status: 'ready' },
      ])
      expect((await operations.inspect([ordinary, child], signal)).kind).toBe('child')
      await expect(operations.inspect([ordinary], signal)).rejects.toThrow('subagent endpoint')
      await expect(operations.inspect([ordinary, foreign], signal)).rejects.toThrow('not authorized')
      await expect(operations.inspect([wrongDepth], signal)).rejects.toThrow('not authorized')
      const open = state.storage.open.bind(state.storage)
      const damagedOpen = vi.spyOn(state.storage, 'open').mockImplementation((id, mode, options) => {
        if (id === damaged) throw new SessionPersistenceCorruptionError('damaged intermediary', { cause: undefined })
        return open(id, mode, options)
      })
      try {
        expect(await operations.inspect([damaged, damagedChild], signal)).toEqual({
          kind: 'diagnostic', id: damagedChild, reason: 'corrupt',
        })
        expect((await operations.inspect([ordinary, child], signal)).kind).toBe('child')
      } finally { damagedOpen.mockRestore() }
    }, signal)
  } finally { await state.close() }
})


it.each([
  { label: 'false', selection: false, expectedBuiltinTools: false },
  { label: 'true', selection: true, expectedBuiltinTools: true },
  { label: 'omitted', selection: undefined, expectedBuiltinTools: true },
])('keeps continuation builtin authority within its resolved selection ($label)', async ({ selection, expectedBuiltinTools }) => {
  const state = await fixture([
    toolCallResponse('open', 'open_child', {}), toolCallResponse('observe', 'observe_child', {}),
    textResponse('Child turn completed.'), textResponse('Parent turn completed.'),
  ])
  const parentId = SessionId('builtin-selection-parent')
  const childId = SessionId('builtin-selection-child')
  const signal = new AbortController().signal
  const input = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
  const firstTurn = Promise.withResolvers<undefined>()
  const inherited: NativeToolDelegationContext = Object.freeze({
    depth: 0, maxDepth: 1, cwd: state.root, provider: 'mock', model: 'parent', maxSteps: 4,
    toolNames: Object.freeze(['observe_child', 'open_child', 'read_file']),
    builtinToolNames: Object.freeze(['read_file']), programToolNames: Object.freeze([]),
  })
  let runObservation: { builtinTools: boolean | undefined; toolNames: string[]; builtinToolNames: readonly string[] } | undefined
  let maintenanceObservation: typeof runObservation
  let maintenanceFailure: unknown
  let removeOpen: (() => Promise<void>) | undefined
  let removeObserve: (() => Promise<void>) | undefined
  try {
    removeOpen = state.tools.register({ schema: { name: 'open_child', description: 'Open a continuation.', parameters: {} },
      async execute(call) {
        const operations = state.execution.continuations!(call.agent, call.session)
        const { builtinTools: parentBuiltinTools, ...childBaseConfig } = state.execution.configuration(call.agent, call.session)
        expect(parentBuiltinTools).toBe(true)
        const child = await operations.open({ id: childId, resume: false, maxDepth: 1,
          config: { ...childBaseConfig, model: 'child', systemPrompt: 'Child.',
            ...(selection === undefined ? {} : { builtinTools: selection }) }, delegationContext: inherited,
          onEvent: (event) => { if (event.type === 'turn/end' && event.data.turn === 1) firstTurn.resolve(undefined) },
        }, call.signal)
        const releaseChild = child.retainChild()
        try {
          await child.enqueue(input('Inspect the selected tools.'), 'next-turn', call.signal)
          await child.ready
          await firstTurn.promise
          const request = state.model.requests.find(candidate => candidate.model === 'child')
          const toolNames = request?.tools?.map(schema => schema.name).sort() ?? []
          try {
            await operations.maintenance(childId, async (owner) => {
              const config = state.execution.configuration(owner.agent, owner.session)
              const authority = state.execution.delegationAuthority(owner.agent, owner.session)
              maintenanceObservation = { builtinTools: config.builtinTools,
                toolNames: [...(authority?.toolNames ?? [])].sort(),
                builtinToolNames: [...(authority?.builtinToolNames ?? [])] }
            }, call.signal)
          } catch (error: unknown) { maintenanceFailure = error }
          return { content: [{ type: 'text', text: JSON.stringify(toolNames) }], isError: false }
        } finally { releaseChild(); await child.dispose() }
      } })
    removeObserve = state.tools.register({ schema: { name: 'observe_child', description: 'Observe the child owner.', parameters: {} },
      async execute(call) {
        const config = state.execution.configuration(call.agent, call.session)
        const authority = state.execution.delegationAuthority(call.agent, call.session)
        runObservation = { builtinTools: config.builtinTools,
          toolNames: [...(authority?.toolNames ?? [])].sort(),
          builtinToolNames: [...(authority?.builtinToolNames ?? [])] }
        return { content: [], isError: false }
      } })

    await state.app.executeTurn({ id: parentId, resume: false, message: input('Open child.') }, signal)

    const expectedBuiltinNames = expectedBuiltinTools ? ['read_file'] : []
    const expectedToolNames = ['observe_child', 'open_child', ...(expectedBuiltinTools ? ['read_file'] : [])]
    expect(runObservation).toEqual({ builtinTools: expectedBuiltinTools, toolNames: expectedToolNames,
      builtinToolNames: expectedBuiltinNames })
    expect(maintenanceFailure).toBeUndefined()
    expect(maintenanceObservation).toEqual({ builtinTools: expectedBuiltinTools, toolNames: expectedToolNames,
      builtinToolNames: expectedBuiltinNames })
    expect(state.model.requests.find(request => request.model === 'child')?.tools?.map(schema => schema.name).sort())
      .toEqual(expectedToolNames)
  } finally {
    if (removeOpen !== undefined) await removeOpen()
    if (removeObserve !== undefined) await removeObserve()
    await state.close()
  }
})


it('retains one child writer across parent closure, processes another turn and cold-resumes the same child log', async () => {
  const state = await fixture([
    toolCallResponse('open', 'open_child', {}), textResponse('Child first.'), textResponse('Parent first.'),
    textResponse('Child second.'), textResponse('Parent saw notice.'),
    toolCallResponse('resume', 'resume_child', {}), textResponse('Child restored.'), textResponse('Parent resumed child.'),
  ], true)
  const parentId = SessionId('continuation-parent')
  const childId = SessionId('continuation-child')
  const signal = new AbortController().signal
  const firstTurn = Promise.withResolvers<undefined>()
  const secondTurn = Promise.withResolvers<undefined>()
  let child: NativeSessionContinuation | undefined
  let releaseDescendant: (() => void) | undefined
  const input = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
  const removeOpen = state.tools.register({ schema: { name: 'open_child', description: 'Open child.', parameters: {} },
    async execute(call) {
      const operations = state.execution.continuations!(call.agent, call.session)
      const failedId = SessionId('failed-preset-child')
      const failure = new Error('child announcement refused')
      const leases: Promise<void>[] = []
      if (state.presets === undefined) throw new Error('missing real preset Provider')
      const acquire = state.presets.acquire.bind(state.presets)
      const acquired = vi.spyOn(state.presets, 'acquire').mockImplementation((preset) => {
        const lease = acquire(preset)
        return { ...lease, release: (reason) => { const released = lease.release(reason); leases.push(released); return released } }
      })
      const stopAnnouncement = state.events.on(state.scope, 'agent/created', (agent) => {
        if (agent.id === NativeAgentId(failedId)) throw failure
      })
      try {
        await expect(operations.open({ id: failedId, resume: false, maxDepth: 1,
          config: state.execution.configuration(call.agent, call.session) }, call.signal)).rejects.toBe(failure)
        expect(leases).toHaveLength(1)
        await leases[0]
      } finally { acquired.mockRestore(); await stopAnnouncement() }
      child = await operations.open({ id: childId, resume: false, maxDepth: 1,
        config: { ...state.execution.configuration(call.agent, call.session), model: 'child', systemPrompt: 'Child.' },
        onEvent: (event) => {
          if (event.type === 'turn/end' && event.data.turn === 1) firstTurn.resolve(undefined)
          if (event.type === 'turn/end' && event.data.turn === 2) secondTurn.resolve(undefined)
        },
        onSettled: async () => {
          expect(state.agents.get(NativeAgentId(childId))).toBeUndefined()
          const writer = await state.storage.open(childId, 'write')
          await writer.close()
          await operations.deliver(parentId, input('Child settled durably.'), 'next-step', false, signal)
        },
      }, call.signal)
      releaseDescendant = child.retainChild()
      await child.enqueue(input('First child task.'), 'next-turn', call.signal)
      await child.ready
      await firstTurn.promise
      return { content: [], isError: false }
    } })
  const removeResume = state.tools.register({ schema: { name: 'resume_child', description: 'Resume child.', parameters: {} },
    async execute(call) {
      const operations = state.execution.continuations!(call.agent, call.session)
      const restored = await operations.open({ id: childId, resume: true, maxDepth: 1,
        config: { ...state.execution.configuration(call.agent, call.session), model: 'child', systemPrompt: 'Child.' } }, call.signal)
      await restored.enqueue(input('Continue the recorded child.'), 'next-turn', call.signal)
      await restored.ready
      await restored.done
      return { content: [], isError: false }
    } })
  try {
    await state.app.executeTurn({ id: parentId, resume: false, message: input('Start.') }, signal)
    if (child === undefined || releaseDescendant === undefined) throw new Error('missing resident child')
    expect(state.agents.get(NativeAgentId(childId))).toBe(child.agent)
    await expect(state.storage.open(childId, 'write')).rejects.toThrow()
    const parentWriter = await state.storage.open(parentId, 'write')
    await parentWriter.close()
    await child.enqueue(input('Second child task.'), 'next-turn', signal)
    await secondTurn.promise
    releaseDescendant()
    await child.done
    await state.app.executeTurn({ id: parentId, resume: true, message: input('Collect.') }, signal)
    expect(JSON.stringify(state.model.requests[4]?.messages)).toContain('Child settled durably.')
    await state.app.executeTurn({ id: parentId, resume: true, message: input('Restore child.') }, signal)
    const restoredRequest = state.model.requests.findLast(request => request.model === 'child')
    expect(JSON.stringify(restoredRequest?.messages)).toContain('Child first.')
    expect(JSON.stringify(restoredRequest?.messages)).toContain('Child second.')
    expect(JSON.stringify(restoredRequest?.messages)).toContain('Continue the recorded child.')
    const reader = await state.storage.open(childId, 'read')
    try {
      const log = await reader.read(0, Number.MAX_SAFE_INTEGER)
      expect(reader.header.agentPreset).toBe('test')
      expect(log.events.filter(event => event.type === 'turn/end').map(event => event.data.turn)).toEqual([1, 2, 3])
      expect(log.events.map(event => event.seq)).toEqual(log.events.map((_event, index) => index))
    } finally { await reader.close() }
  } finally { releaseDescendant?.(); await child?.dispose(); await removeOpen(); await removeResume(); await state.close() }
})




it('publishes the durable settlement of a retained child when its Program closes', async () => {
  const state = await fixture([
    toolCallResponse('open', 'open_child', {}),
    toolCallResponse('wait', 'wait_for_shutdown', {}),
    textResponse('Parent settled.'),
  ])
  const parentId = SessionId('shutdown-parent')
  const childId = SessionId('shutdown-child')
  const signal = new AbortController().signal
  const entered = Promise.withResolvers<undefined>()
  const settled = Promise.withResolvers<{ observation: NativeContinuationObservation | undefined; isClosing: boolean }>()
  const input = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
  const removeWait = state.tools.register({ schema: { name: 'wait_for_shutdown', description: 'Wait for Program shutdown.', parameters: {} },
    async execute(call) {
      entered.resolve(undefined)
      await new Promise<void>((resolve) => {
        call.signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
      call.signal.throwIfAborted()
      return { content: [], isError: false }
    } })
  const removeOpen = state.tools.register({ schema: { name: 'open_child', description: 'Open a child.', parameters: {} },
    async execute(call) {
      const operations = state.execution.continuations!(call.agent, call.session)
      const child = await operations.open({ id: childId, resume: false, maxDepth: 1,
        config: { ...state.execution.configuration(call.agent, call.session), model: 'child' },
        onSettled: async (_result, _failure, observation) => { settled.resolve({ observation, isClosing: operations.isClosing }) },
      }, call.signal)
      await child.enqueue(input('Hold until shutdown.'), 'next-turn', call.signal)
      await child.ready
      await entered.promise
      return { content: [], isError: false }
    } })
  try {
    const rootTurn = state.app.executeTurn({ id: parentId, resume: false, message: input('Open child.') }, signal)
      .then(value => ({ status: 'fulfilled' as const, value }), (error: unknown) => ({ status: 'rejected' as const, error }))
    await entered.promise
    expect(await rootTurn).toMatchObject({ status: 'fulfilled', value: { exitCode: 0 } })
    const closing = state.app.dispose()
    const outcome = await settled.promise
    expect(outcome.isClosing).toBe(true)
    expect(outcome.observation?.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
    expect(state.agents.get(NativeAgentId(childId))).toBeUndefined()
    await closing
  } finally {
    await state.app.dispose().catch(() => {})
    await removeOpen()
    await removeWait()
    await state.close()
  }
})


it('drains every retained root and unregisters Agents after one writer close fails', async () => {
  const state = await fixture([textResponse('Child settled.')])
  const failedId = SessionId('failed-close-root')
  const heldId = SessionId('held-close-root')
  const failure = new Error('root writer close failed')
  const failedClose = Promise.withResolvers<undefined>()
  const heldClose = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  const releases: (() => void)[] = []
  const create = state.storage.create.bind(state.storage)
  const intercept = vi.spyOn(state.storage, 'create').mockImplementation(async (...args) => {
    const writer = await create(...args)
    const close = writer.close.bind(writer)
    vi.spyOn(writer, 'close').mockImplementation(async () => {
      if (args[0].id === heldId) { heldClose.resolve(undefined); await finish.promise }
      await close()
      if (args[0].id === failedId) { failedClose.resolve(undefined); throw failure }
    })
    return writer
  })
  const causes = (error: unknown): readonly unknown[] => error instanceof AggregateError
    ? [error, ...error.errors.flatMap(causes)] : [error]
  try {
    const childId = SessionId('detached-failure-child')
    const detachedFailure = new Error('detached observer failed')
    const removeObserver = state.activeSessions.onDetached(async (owner) => {
      if (owner.session.id === childId) throw detachedFailure
    })
    try {
      await state.app.executeSessionOperation({ id: SessionId('one-shot-parent'), resume: false }, async (owner) => {
        const result = state.execution.delegate(owner.agent, owner.session, { id: childId, maxDepth: 1,
          config: state.execution.configuration(owner.agent, owner.session),
          message: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Child task.' }] }),
        }, new AbortController().signal)
        expect(causes(await result.catch((error: unknown) => error))).toContain(detachedFailure)
        const writer = await state.storage.open(childId, 'write')
        await writer.close()
      }, new AbortController().signal)
    } finally { await removeObserver() }
    for (const id of [failedId, heldId]) {
      await state.app.executeSessionOperation({ id, resume: false }, async (owner) => {
        releases.push(owner.retain())
      }, new AbortController().signal)
    }
    let settled = false
    const disposal = state.app.dispose().then(() => { settled = true; return undefined }, (error: unknown) => {
      settled = true
      return error
    })
    await Promise.all([failedClose.promise, heldClose.promise])
    await Promise.resolve()
    expect(settled).toBe(false)
    finish.resolve(undefined)
    expect(causes(await disposal)).toContain(failure)
    expect(state.agents.get(NativeAgentId(failedId))).toBeUndefined()
    expect(state.agents.get(NativeAgentId(heldId))).toBeUndefined()
    expect(state.model.requests).toHaveLength(1)
  } finally {
    finish.resolve(undefined)
    for (const release of releases) release()
    intercept.mockRestore()
    await state.host.stop().catch((error: unknown) => { expect(causes(error)).toContain(failure) })
    await rm(state.root, { recursive: true, force: true })
  }
})

it('keeps the active Session writer open until detached Consumers finish', async () => {
  const state = await fixture([])
  const id = SessionId('detached-writer-drain')
  const detached = Promise.withResolvers<undefined>()
  const observerStarted = Promise.withResolvers<undefined>()
  const releaseObserver = Promise.withResolvers<undefined>()
  let applicationDisposal: Promise<void> | undefined
  const remove = state.activeSessions.onDetached(async (owner) => {
    if (owner.session.id !== id) return
    expect(owner.writerAvailable).toBe(true)
    expect(() => owner.enqueue(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Late input.' }] }),
      'next-turn', false, new AbortController().signal)).toThrow('owner is detaching')
    applicationDisposal = state.app.dispose()
    observerStarted.resolve(undefined)
    await releaseObserver.promise
    await owner.flush()
    detached.resolve(undefined)
  })
  try {
    const operation = state.app.executeSessionOperation({ id, resume: false }, async (owner) => {
      expect(owner.writerAvailable).toBe(true)
    }, new AbortController().signal)
    await observerStarted.promise
    let disposed = false
    void applicationDisposal?.then(() => { disposed = true }, () => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    releaseObserver.resolve(undefined)
    await operation
    await detached.promise
    await applicationDisposal
    expect(disposed).toBe(true)
    expect(state.activeSessions.owners().some(owner => owner.session.id === id)).toBe(false)
  } finally {
    releaseObserver.resolve(undefined)
    await remove()
    await state.close()
  }
})

it.each(['initial-turn', 'already-aborted-settlement'] as const)('drains a retained root before rejecting %s cancellation', async (mode) => {
  const state = await fixture(mode === 'initial-turn' ? ['hang'] : [textResponse('Root settled.')])
  const id = SessionId('cancelled-retained-root')
  const controller = new AbortController()
  const detached = Promise.withResolvers<undefined>()
  const releaseCleanup = Promise.withResolvers<undefined>()
  const cleanupFailure = new Error('retained cleanup failed')
  let release: (() => void) | undefined
  const removeAttached = state.activeSessions.onAttached(async (owner) => { release = owner.retain() })
  const removeDetached = state.activeSessions.onDetached(async () => {
    detached.resolve(undefined)
    await releaseCleanup.promise
    throw cleanupFailure
  })
  try {
    const request = { id, resume: false, message: createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text' as const, text: 'Start retained work.' }] }) }
    let pending: Promise<unknown>
    if (mode === 'initial-turn') {
      pending = state.app.executeRootTurn({ ...request, onChunk: (chunk): void => {
        if (chunk.type === 'text-delta') controller.abort({ kind: 'user' })
      } }, controller.signal).catch((error: unknown) => error)
    } else {
      await state.app.executeTurn(request, controller.signal)
      controller.abort({ kind: 'user' })
      pending = state.app.waitRootSettlement(id, controller.signal).catch((error: unknown) => error)
    }
    let settled = false
    void pending.then(() => { settled = true })
    await detached.promise
    expect(settled).toBe(false)
    releaseCleanup.resolve(undefined)
    const result = await pending
    const causes = (error: unknown): readonly unknown[] => error instanceof AggregateError
      ? error.errors.flatMap(causes) : [error]
    if (mode === 'initial-turn') {
      expect(causes(result)[0]).toMatchObject({ message: 'aborted' })
      expect(causes(result)).toContain(cleanupFailure)
    } else {
      expect(causes(result)).toContain(controller.signal.reason)
      expect(causes(result)).toContain(cleanupFailure)
    }
    expect(state.activeSessions.owners()).toHaveLength(0)
    const writer = await state.storage.open(id, 'write')
    await writer.close()
  } finally {
    releaseCleanup.resolve(undefined)
    release?.()
    await removeAttached()
    await removeDetached()
    await state.close()
  }
})
