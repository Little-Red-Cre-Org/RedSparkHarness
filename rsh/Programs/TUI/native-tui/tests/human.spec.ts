/** Exact terminal request ownership and stale-answer cancellation without a second writer. */
import { expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import { NativeHost, NativeScope, ResourceOwner, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeApprovalRequestId, type NativeApprovalAnswerer, type NativeApprovalAnswererRequest } from '@deepseek-ai/dsh-native-approval'
import type { NativeActiveSessionOwner, NativeActiveSessionOperations, NativeRootRouteId } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeUserQuestionAnswerer } from '@deepseek-ai/dsh-user-questions/native'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import { TerminalController } from '../src/controller.ts'
import { bindTerminalHumanAnswerers } from '../src/human.ts'
import { resolveNativeTuiConfig } from '../src/config.ts'
import { createNativeHeadlessApplication, resolveNativeHeadlessConfig, plugin as headlessPlugin, type NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import { localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import { plugin as storagePlugin } from '@deepseek-ai/dsh-session-persistence-jsonl/native'
import { plugin as agentPlugin } from '@deepseek-ai/dsh-native-agent/native'
import { plugin as executionPlugin } from '@deepseek-ai/dsh-native-session-execution/native'
import { plugin as modelPlugin } from '@deepseek-ai/dsh-native-model-execution/native'
import { createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm/native'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'

it('answers exact root requests, refuses stale input and drains cancelled or removed presentations', async () => {
  const id = SessionId('terminal-human')
  const agent = {} as NativeAgent // The port proof checks exact identity; the dsh snapshot owns the actual Agent and writer.
  const owner = { agent, invocation: 'root', session: { id } } as NativeActiveSessionOwner
  const config = resolveNativeTuiConfig({ cwd: process.cwd(), provider: 'fixture', model: 'fixture', systemPrompt: 'Terminal.',
    locale: 'en', background: '#000000', maxQueuedInputs: 1, maxHistoryEvents: 100, maxTranscriptEvents: 2,
    maxStreamChunks: 2, maxPendingHumanRequests: 2 })
  const lifetime = new AbortController()
  const controller = new TerminalController({ turn: async () => ({ exitCode: 0 }), open: async () => undefined,
    history: async () => [], sessions: async () => [] }, lifetime.signal, config, id)
  let approval!: NativeApprovalAnswerer
  let questions!: NativeUserQuestionAnswerer
  const removedApproval = vi.fn()
  const removedQuestions = vi.fn(async () => undefined)
  const active = { owners: () => [owner] }
  const executor = { interactionOwner: (candidate: NativeAgent) => candidate === agent
    ? { agent, session: owner.session, displayRootAgent: agent, displayRootSessionId: id } : undefined,
  rootExecution: { capture: () => ({ id: 'root' as NativeRootRouteId,
    configuration: { cwd: process.cwd(), provider: 'fixture', model: 'fixture', systemPrompt: 'Terminal.', maxSteps: 4 } }),
  cancel: async () => undefined } }
  const scope = new NativeScope()
  const registrations = new ResourceOwner()
  const context = { scope, own: registrations.own.bind(registrations) }
  bindTerminalHumanAnswerers(controller.human, active, executor, value => controller.ownsSession(value), context,
    { registerAnswerer: (answerer) => { approval = answerer; return removedApproval } },
    { registerAnswerer: (_name, answerer) => { questions = answerer; return removedQuestions } })
  const request: NativeApprovalAnswererRequest = { id: NativeApprovalRequestId('terminal-approval'), agent,
    toolName: 'write_file', reason: 'Write requested file', policy: 'ask', signal: lifetime.signal }
  try {
    await controller.initialize([], lifetime.signal)
    expect(controller.ownsSession(SessionId('another'))).toBe(false)
    expect(approval({ ...request, agent: {} as NativeAgent })).toBeUndefined()
    const delegated = vi.fn(async () => ({ answers: [] }))
    await questions.ask({ agent, session: { id: SessionId('another') } as NativeActiveSessionOwner['session'],
      questions: [], signal: lifetime.signal }, delegated)
    expect(delegated).toHaveBeenCalledOnce()
    const allowed = approval(request)
    const shown = controller.snapshot().human!
    expect(shown).toMatchObject({ kind: 'approval', toolName: 'write_file' })
    await expect(controller.sessions()).rejects.toThrow('idle terminal')
    await expect(controller.selectSession(SessionId('another'))).rejects.toThrow('idle terminal')
    expect(controller.ownsSession(id)).toBe(true)
    expect(() =>{  controller.answerHuman('yes', shown) }).toThrow('/allow')
    controller.answerHuman('/allow', shown)
    expect(await allowed).toBe('allowed-once')
    const cancelled = new AbortController()
    const { reason: _reason, ...withoutReason } = request
    const pending = approval({ ...withoutReason, signal: cancelled.signal })
    const stale = controller.snapshot().human!
    const rejection = expect(pending).rejects.toThrow('caller cancelled')
    cancelled.abort(new Error('caller cancelled'))
    await rejection
    await expect(approval({ ...request, signal: cancelled.signal })).rejects.toThrow('caller cancelled')
    const refused = approval(request)
    expect(() =>{  controller.answerHuman('/allow', stale) }).toThrow('No pending')
    controller.answerHuman('/deny', controller.snapshot().human!)
    expect(await refused).toBe('rejected')

    const answers = questions.ask({ agent, session: owner.session, signal: lifetime.signal, questions: [
      { id: 'one', question: 'Choose one', options: [{ label: 'A' }, { label: 'B' }] },
      { id: 'many', question: 'Choose several', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true },
      { id: 'custom', question: 'Other answer', options: [{ label: 'A' }] },
      { id: 'text', question: 'Write text' },
    ] }, delegated)
    const first = controller.snapshot().human!
    for (const input of ['', '/other', '/other ', '3', '1,1', '1,2']) {
      expect(() =>{  controller.answerHuman(input, first) }).toThrow('Enter option')
    }
    controller.answerHuman('2', first)
    await vi.waitFor(() =>{  expect(controller.snapshot().human).toMatchObject({ question: { id: 'many' } }) })
    controller.answerHuman('1,2', controller.snapshot().human!)
    await vi.waitFor(() =>{  expect(controller.snapshot().human).toMatchObject({ question: { id: 'custom' } }) })
    controller.answerHuman('/other custom answer', controller.snapshot().human!)
    await vi.waitFor(() =>{  expect(controller.snapshot().human).toMatchObject({ question: { id: 'text' } }) })
    controller.answerHuman('free text', controller.snapshot().human!)
    expect(await answers).toEqual({ answers: [
      { id: 'one', selected: ['B'] }, { id: 'many', selected: ['A', 'B'] },
      { id: 'custom', selected: [], custom: 'custom answer' }, { id: 'text', selected: [], custom: 'free text' },
    ] })
    expect(() =>{  controller.answerHuman('late', first) }).toThrow('No pending')
    const queued = [approval(request), approval(request)]
    const rejected = queued.map(operation => expect(operation).rejects.toThrow('closed'))
    await expect(approval(request)).rejects.toThrow('queue is full')
    await controller.close()
    await Promise.all(rejected)
    expect(controller.snapshot().human).toBeUndefined()
    expect(controller.ownsSession(id)).toBe(false)
    expect(approval(request)).toBeUndefined()
    await expect(controller.human.approval(request)).rejects.toThrow('closed')
  } finally { await controller.close(); await registrations.dispose() }
  expect(removedApproval).toHaveBeenCalledOnce()
  expect(removedQuestions).toHaveBeenCalledOnce()
  bindTerminalHumanAnswerers(controller.human, active, executor, () => false, context)

  const root = await mkdtemp(join(tmpdir(), 'rsh-tui-human-root-'))
  const settings = { ...config, cwd: root }
  const turnSettings = resolveNativeHeadlessConfig({ cwd: root, provider: 'fixture', model: 'fixture', systemPrompt: 'Terminal.' })
  const entered = Promise.withResolvers<AbortSignal>()
  const release = Promise.withResolvers<undefined>()
  let primary!: NativeHeadlessApplication
  let foreign!: NativeHeadlessApplication
  let terminal!: TerminalController
  let rootApproval!: NativeApprovalAnswerer
  let rootQuestions!: NativeUserQuestionAnswerer
  let roots!: NativeActiveSessionOperations
  let persistence!: NativeSessionPersistenceOperations
  let admission = entered
  let cleanup = release
  const model: NativePlugin = { apiVersion: 1, name: 'human-root-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => (context) => { context.provide('model', { async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
      const signal = request.signal!
      admission.resolve(signal)
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      await cleanup.promise
      throw signal.reason
    } }) } }
  const recipient: NativePlugin = { apiVersion: 1, name: 'human-root-recipient', targets: ['host'],
    requires: ['fs', 'sessionPersistence', 'agents', 'sessionExecution', 'activeSessions', 'modelExecution'],
    optional: headlessPlugin.optional ?? [], provides: [],
    resolve: () => (context) => {
      const authority = { execution: context.require('sessionExecution'), active: context.require('activeSessions') }
      roots = authority.active
      persistence = context.require('sessionPersistence')
      primary = createNativeHeadlessApplication(context, turnSettings, context.scope, authority)
      foreign = createNativeHeadlessApplication(context, turnSettings, context.scope, authority)
      terminal = new TerminalController({ turn: (request, signal) => primary.executeRootTurn(request, signal),
        open: async (id, resume, signal) => { await primary.executeSessionOperation({ id, resume }, async () => undefined, signal) },
        history: async () => [], sessions: async () => [] }, context.signal, settings, id)
      context.own(() => terminal.close())
      bindTerminalHumanAnswerers(terminal.human, authority.active, primary, value => terminal.ownsSession(value), context,
        { registerAnswerer: (answerer) => { rootApproval = answerer; return () => undefined } },
        { registerAnswerer: (_name, answerer) => { rootQuestions = answerer; return async () => undefined } })
    } }
  const host = new NativeHost(resolveInstallation([
    { plugin: recipient, scope, config: undefined }, { plugin: model, scope, config: undefined },
    { plugin: agentPlugin, scope, config: undefined }, { plugin: executionPlugin, scope, config: undefined },
    { plugin: modelPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: root } },
    { plugin: storagePlugin, scope, config: { root: join(root, 'sessions'), compression: 'none' } },
  ], 'host'))
  const run = new AbortController()
  const closeFailure = new Error('ordinary root writer cleanup failed')
  const causes = (error: unknown): readonly unknown[] => error instanceof AggregateError ? error.errors.flatMap(causes) : [error]
  let work: Promise<unknown> | undefined
  try {
    await host.start()
    await terminal.initialize([], run.signal)
    const message = () => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'External root input.' }] })
    work = primary.executeRootTurn({ id, resume: true, message: message() }, run.signal)
    const signal = await entered.promise
    const owned = roots.owners().find(owner => owner.session.id === id)!
    expect(terminal.snapshot().busy).toBe(false)
    const question = rootApproval({ ...request, agent: owned.agent, signal })
    const rejected = expect(question).rejects.toEqual(expect.anything())
    expect(terminal.snapshot().human?.kind).toBe('approval')
    terminal.cancel()
    await vi.waitFor(() => { expect(signal.aborted).toBe(true) })
    await rejected
    expect(terminal.snapshot().human).toBeUndefined()
    expect(terminal.snapshot().busy).toBe(true)
    await expect(terminal.sessions()).rejects.toThrow('idle terminal')
    let settled = false
    const settlement = terminal.settle().then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    release.resolve(undefined)
    await settlement
    await expect(work).rejects.toEqual(signal.reason)
    work = undefined
    expect(terminal.snapshot().busy).toBe(false)

    admission = Promise.withResolvers<AbortSignal>()
    cleanup = Promise.withResolvers<undefined>()
    work = foreign.executeRootTurn({ id, resume: true, message: message() }, run.signal)
    const foreignSignal = await admission.promise
    const foreignOwner = roots.owners().find(owner => owner.session.id === id)!
    expect(rootApproval({ ...request, agent: foreignOwner.agent, signal: foreignSignal })).toBeUndefined()
    const next = vi.fn(async () => ({ answers: [] }))
    await rootQuestions.ask({ agent: foreignOwner.agent, session: foreignOwner.session, questions: [], signal: foreignSignal }, next)
    expect(next).toHaveBeenCalledOnce()
    expect(terminal.snapshot().human).toBeUndefined()
    terminal.cancel()
    expect(foreignSignal.aborted).toBe(false)
    run.abort()
    cleanup.resolve(undefined)
    try { await work } catch (error: unknown) { if (error !== run.signal.reason) throw error }
    work = undefined
    await foreign.dispose()

    const open = persistence.open.bind(persistence)
    const intercept = vi.spyOn(persistence, 'open').mockImplementation(async (...args) => {
      const writer = await open(...args)
      if (args[1] === 'write') {
        const close = writer.close.bind(writer)
        vi.spyOn(writer, 'close').mockImplementation(async () => { await close(); throw closeFailure })
      }
      return writer
    })
    admission = Promise.withResolvers<AbortSignal>()
    cleanup = Promise.withResolvers<undefined>()
    work = primary.executeRootTurn({ id, resume: true, message: message() }, new AbortController().signal)
      .catch((error: unknown) => error)
    const failedSignal = await admission.promise
    const failedOwner = roots.owners().find(owner => owner.session.id === id)!
    const failedPrompt = Promise.resolve(rootApproval({ ...request, agent: failedOwner.agent, signal: failedSignal }))
      .catch((error: unknown) => error)
    terminal.cancel()
    await vi.waitFor(() => { expect(failedSignal.aborted).toBe(true) })
    cleanup.resolve(undefined)
    await terminal.settle()
    await work
    expect(await failedPrompt).toBe(failedSignal.reason)
    expect(terminal.snapshot().busy).toBe(true)
    expect(() => { terminal.submit(message()) }).toThrow('closed')
    let failure: unknown
    try { terminal.status(new AbortController().signal) } catch (error: unknown) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    expect(causes((failure as Error).cause)).toContain(closeFailure)
    await expect(primary.executeRootTurn({ id, resume: true, message: message() }, new AbortController().signal))
      .rejects.toThrow('disposed')
    intercept.mockRestore()
  } finally {
    run.abort(); cleanup.resolve(undefined)
    try { await work } catch (error: unknown) { if (error !== run.signal.reason) throw error }
    try { await host.stop() } catch (error: unknown) {
      expect(causes(error).every(cause => cause === closeFailure)).toBe(true)
    } finally { await rm(root, { recursive: true }) }
  }
})
