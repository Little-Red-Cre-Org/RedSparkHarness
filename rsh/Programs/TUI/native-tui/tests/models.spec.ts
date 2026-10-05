/** Model menus share maintenance admission and drain cancellation before terminal release. */
import { expect, it, vi } from 'vitest'
import { setImmediate } from 'node:timers/promises'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm/native'
import type { NativeModelSelectionOperations } from '@deepseek-ai/dsh-native-model-selection/native'
import type { NativeModelSelectionState } from '@deepseek-ai/dsh-native-model-selection/types'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/native'
import { resolveNativeTuiConfig } from '../src/config.ts'
import { TerminalController } from '../src/controller.ts'
import { terminalModelOperations } from '../src/models.ts'

it('owns idle model maintenance, durable revision forwarding and cancelled menu drain', async () => {
  const config = resolveNativeTuiConfig({ cwd: process.cwd(), provider: 'fixture', model: 'fixture', systemPrompt: 'Terminal.',
    locale: 'en', background: '#000000', maxQueuedInputs: 1, maxHistoryEvents: 100, maxTranscriptEvents: 2, maxStreamChunks: 2, maxPendingHumanRequests: 2 })
  const id = SessionId('terminal-model-maintenance')
  const owner = {} as NativeActiveSessionOwner // This port proof observes identity; the real dsh snapshot owns the complete Session.
  let state: NativeModelSelectionState = { revision: null, lastUsed: null, next: null }
  const choice = { provider: 'fixture', model: 'fixture-alt', reasoningEffort: 'high' }
  let metadataFailure = false
  let holdCatalog: Promise<void> | undefined
  let refuseCatalog = false
  let catalogEntered = Promise.withResolvers<undefined>()
  const select = vi.fn<NativeModelSelectionOperations['select']>(async (observed, request) => {
    expect(observed).toBe(owner)
    expect(request.expectedRevision).toBe(state.revision)
    state = { ...state, next: request.selected, revision: SessionSeq(1) }
    return { selected: request.selected, revision: SessionSeq(1) }
  })
  const models = terminalModelOperations({ executeSessionOperation: async (request, operation, signal) => {
    expect(request).toEqual({ id, resume: true })
    return operation(owner, signal)
  } }, { state: async () => state, select, capture: async () => { throw new Error('menu must not prepare a turn') } }, {
    providers: () => [{ id: 'fixture', name: 'Fixture' }],
    catalog: async (defaults) => {
      catalogEntered.resolve(undefined)
      await holdCatalog
      if (refuseCatalog) throw new Error('catalog refused')
      return { default: defaults, groups: [], failures: [], routableProviders: ['fixture'] }
    },
    resolve: async (provider, model) => {
      if (metadataFailure) throw new Error('metadata refused')
      return { provider, id: model, name: model }
    },
  }, config, () => ({ status: 'maintenance', runMaintenance: () => { throw new Error('already reserved') } }))
  const execution = { turn: async () => ({ exitCode: 0 }), open: async () => undefined, history: async () => [], models }
  const lifetime = new AbortController()
  const controller = new TerminalController(execution, lifetime.signal, config, id)
  const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'queued' }] })
  try {
    await controller.initialize([], lifetime.signal)
    expect(controller.snapshot().model?.resolved.id).toBe('fixture')
    expect((await controller.models()).state.next).toBe(null)
    refuseCatalog = true
    await expect(controller.models()).rejects.toThrow('catalog refused')
    refuseCatalog = false
    metadataFailure = true
    const releaseCatalog = Promise.withResolvers<undefined>()
    catalogEntered = Promise.withResolvers<undefined>()
    holdCatalog = releaseCatalog.promise
    let failed = false
    const failedSelection = controller.selectModel({ selected: choice, expectedRevision: null }).finally(() => { failed = true })
    const failure = expect(failedSelection).rejects.toThrow('metadata refused')
    await catalogEntered.promise
    await setImmediate()
    expect(failed).toBe(false)
    releaseCatalog.resolve(undefined)
    await failure
    expect(select).not.toHaveBeenCalled()
    holdCatalog = undefined
    metadataFailure = false
    expect((await controller.selectModel({ selected: choice, expectedRevision: null })).state.next).toEqual(choice)
    expect(controller.snapshot().choice).toEqual(choice)
    expect(select).toHaveBeenCalledOnce()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    execution.models = { ...models, read: async (_id, signal) => {
      entered.resolve(undefined)
      await new Promise<void>((resolve) =>{  signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      await release.promise
      throw signal.reason
    } }
    const pending = controller.models()
    const rejected = expect(pending).rejects.toThrow('Cancelled')
    await entered.promise
    expect(() =>{  controller.submit(message) }).toThrow('idle terminal')
    await expect(controller.selectModel({ selected: choice, expectedRevision: SessionSeq(1) })).rejects.toThrow('idle terminal')
    controller.cancel()
    let closed = false
    const closing = controller.close().then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)
    release.resolve(undefined)
    await rejected
    await closing
    await expect(controller.models()).rejects.toThrow('closed')
  } finally { await controller.close() }
  const unsupported = new TerminalController({ ...execution, models: undefined }, lifetime.signal, config, id)
  try {
    await expect(unsupported.models()).rejects.toThrow('Providers')
    unsupported.submit(message)
    await expect(unsupported.models()).rejects.toThrow('idle terminal')
    await unsupported.settle()
  } finally { await unsupported.close() }
  const reserved = vi.fn()
  const reserve = async <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    reserved()
    return operation(lifetime.signal)
  }
  const explicitDefaults = terminalModelOperations({
    executeSessionOperation: async (_request, operation, signal) => operation(owner, signal),
  },
  { state: async () => ({ revision: null, lastUsed: null, next: null }), select, capture: async () => { throw new Error('unused capture') } },
  { providers: () => [], catalog: async defaults => ({ default: defaults, groups: [], failures: [], routableProviders: [] }),
    resolve: async (provider, model) => ({ provider, id: model, name: model }) }, { ...config, reasoningEffort: ReasoningEffortId('high') },
  () => ({ status: 'idle', runMaintenance: reserve }))
  expect((await explicitDefaults.read(id, lifetime.signal)).catalog.default.reasoningEffort).toBe('high')
  expect(reserved).toHaveBeenCalledOnce()
})
