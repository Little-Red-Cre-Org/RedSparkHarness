/** JSON-RPC SDK transport over the native Session executor. */
import { resolve } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-json-rpc-line'
import { createNativeHeadlessApplication, type NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm/native'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { NativeRootExecutionOperations, NativeRootRouteId, NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { NativeSubagentFinished } from '@deepseek-ai/dsh-native-subagent'
import { SessionId, SessionSeq, type SessionId as NativeSessionId } from '@deepseek-ai/dsh-session/native'
import type { NativeApplication, NativeContext, NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-fs/native'
import type { AttachmentAdmissionPart } from '@deepseek-ai/dsh-attachment/native'
import type {} from '@deepseek-ai/dsh-session-persistence/native'
import type {} from '@deepseek-ai/dsh-native-agent/native'
import type {} from '@deepseek-ai/dsh-native-model-execution/native'

const SDK_ROOT_ROUTE = brandString<NativeRootRouteId>('root')

/** Fixed profile policy; initialize selects the workspace and model route. */
export interface Config {
  /** Base prompt recorded in every SDK-created Session. */
  readonly systemPrompt: string
  /** Maximum model steps admitted per turn. */
  readonly maxSteps: number
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`native SDK: ${name} must be an object`)
  return value as Record<string, unknown>
}

function nonempty(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`native SDK: ${name} must be a nonempty string`)
  return value
}

function resolveConfig(input: unknown): Config {
  const fields = record(input, 'configuration')
  for (const key of Object.keys(fields)) if (key !== 'systemPrompt' && key !== 'maxSteps') throw new Error(`native SDK: unknown configuration field ${key}`)
  const maxSteps = fields.maxSteps
  if (!Number.isSafeInteger(maxSteps) || typeof maxSteps !== 'number' || maxSteps <= 0) throw new TypeError('native SDK: maxSteps must be a positive integer')
  return { systemPrompt: nonempty(fields.systemPrompt, 'systemPrompt'), maxSteps }
}

interface NativeSdkTurnAdmission {
  controller: AbortController
  received: boolean
  settled: Promise<void>
  failure?: AggregateError
}

interface NativeSdkRootLineage {
  readonly agent: NativeAgent
  readonly owner: NativeActiveSessionOwner
  readonly routeId?: NativeRootRouteId
}

interface NativeSdkChildLineage {
  readonly agent: NativeAgent
  readonly parentAgent: NativeAgent
  readonly parentSessionId: NativeSessionId
  readonly rootSessionId: NativeSessionId
}

interface NativeSdkRootExecutionWaiter {
  readonly wake: () => void
  readonly fail: (cause: unknown) => void
}

/** One native executor and one JSON-RPC connection owned by the profile. */
export class NativeSdkApplication implements NativeApplication {
  /** The SDK Program's root executor, available after initialize selects its route. */
  readonly rootExecution: NativeRootExecutionOperations
  private executor: NativeHeadlessApplication | undefined
  private readonly rootExecutionWaiters = new Set<NativeSdkRootExecutionWaiter>()
  private rootInitializationFailure: { readonly cause: unknown } | undefined
  private readonly abort = new AbortController()
  private readonly sessions = new Map<string, Promise<void>>()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly activeTurns = new Map<string, NativeSdkTurnAdmission>()
  private readonly acceptedRootSessions = new Set<string>()
  private closing = false
  private initializing = false

  constructor(private readonly context: NativeContext, private readonly config: Config,
    private readonly input: Readable = process.stdin, private readonly output: Writable = process.stdout) {
    const rootExecution = {
      ready: async (signal) => {
        this.assertOpen()
        const lifetime = AbortSignal.any([signal, this.abort.signal, this.context.signal])
        const executor = await this.waitForExecutor(lifetime)
        this.assertOpen()
        await executor.rootExecution.ready(lifetime)
      },
      resolve: id => this.rootOperations().resolve(id),
      workspaceRoutes: () => this.rootOperations().workspaceRoutes(),
      selectWorkspace: (request, signal) => this.rootOperations().selectWorkspace(request, signal),
      releaseWorkspace: (id, signal) => this.rootOperations().releaseWorkspace(id, signal),
      capture: owner => this.rootOperations().capture(owner),
      cancel: owner => this.rootOperations().cancel(owner),
      releaseIdle: (request, signal) => this.rootOperations().releaseIdle(request, signal),
      execute: (request, signal) => this.rootOperations().execute(request, signal),
      settle: (request, signal) => this.rootOperations().settle(request, signal),
      maintenance: (request, operation, signal) => this.rootOperations().maintenance(request, operation, signal),
      fork: (request, signal) => this.rootOperations().fork(request, signal),
      selectPreset: (request, signal) => this.rootOperations().selectPreset(request, signal),
    } satisfies Omit<NativeRootExecutionOperations, 'deletions'>
    this.rootExecution = rootExecution
  }

  /**
   * Serve the existing SDK methods until shutdown, EOF, or Host cancellation.
   * @param args - unsupported application arguments.
   * @param signal - Host cancellation, including process signals.
   * @returns zero after accepted work settles and stdio closes.
   */
  async run(args: readonly string[], signal: AbortSignal): Promise<number> {
    if (args.length > 0) throw new Error('native SDK: task arguments are unsupported')
    const transport = new JsonRpcLineTransport(this.input, this.output)
    const releaseDescendants = this.observeDescendants(transport)
    let finish!: () => void
    const done = new Promise<void>((resolveDone) => { finish = resolveDone })
    const onEnd = (): void => { finish() }
    const onAbort = (): void => { finish() }
    this.input.once('end', onEnd)
    signal.addEventListener('abort', onAbort, { once: true })
    transport.onRequest(async (method, params) => {
      switch (method) {
        case 'initialize': return this.track(this.initialize(params, signal))
        case 'session/prompt': return this.prompt(params, transport, signal)
        case 'session/cancel': return this.cancel(params)
        case 'session/steer': return this.track(this.steer(params, signal))
        case 'session/fork': return this.track(this.fork(params, signal))
        case 'shutdown':
          this.closing = true
          setImmediate(finish)
          return {}
        default: throw new Error(`native SDK: unknown method ${method}`)
      }
    })
    transport.start()
    if (signal.aborted) finish()
    try {
      await done
      this.closing = true
      this.abort.abort(new Error('native SDK: closing'))
      await Promise.allSettled([...this.pending])
      const failures: unknown[] = []
      try { await this.executor?.dispose() } catch (error: unknown) { failures.push(error) }
      try { await transport.flush() } catch (error: unknown) { failures.push(error) }
      if (failures.length > 0) throw new AggregateError(failures, 'native SDK: shutdown cleanup failed')
      return 0
    } finally {
      this.input.off('end', onEnd)
      signal.removeEventListener('abort', onAbort)
      try { await releaseDescendants() }
      finally { transport.close(); this.input.pause() }
    }
  }

  private assertOpen(): void {
    if (this.closing) throw new Error('native SDK: closing')
  }

  private observeDescendants(transport: JsonRpcLineTransport): () => Promise<void> {
    const active = this.context.require('activeSessions')
    const observed = new Map<NativeActiveSessionOwner, () => void>()
    const roots = new Map<NativeSessionId, NativeSdkRootLineage>()
    const descendants = new Map<NativeSessionId, NativeSdkChildLineage>()
    const releaseFinished = this.context.optional('subagents')?.onFinished((finished: NativeSubagentFinished) => {
      const childSessionId = finished.result.id
      const lineage = descendants.get(childSessionId)
      if (lineage === undefined || lineage.parentAgent !== finished.parentAgent
        || lineage.parentSessionId !== finished.parentSession.id) return
      const root = roots.get(lineage.rootSessionId)
      if (root?.routeId !== SDK_ROOT_ROUTE || !this.acceptedRootSessions.has(String(lineage.rootSessionId))) return
      transport.notify('subagent.finished', {
        provider: finished.result.provider,
        agentId: String(childSessionId),
        parentSessionId: String(lineage.parentSessionId),
        childSessionId: String(childSessionId),
        status: finished.result.stopReason === 'completed' ? 'ok' : 'error',
        stopReason: finished.result.stopReason,
        ...(finished.result.output.length === 0 ? {} : { lastAssistantMessage: [...finished.result.output] }),
      })
    }) ?? (() => {})
    const releaseAttached = active.onAttached((owner) => {
      if (this.closing) return Promise.resolve()
      const executor = this.executor
      if (executor === undefined) return Promise.resolve()
      const interaction = executor.interactionOwner(owner.agent)
      if (owner.invocation === 'root') {
        if (interaction?.displayRootAgent !== owner.agent || interaction.displayRootSessionId !== owner.session.id) return Promise.resolve()
        const previous = roots.get(owner.session.id)
        roots.set(owner.session.id, previous?.agent === owner.agent ? { ...previous, owner } : { agent: owner.agent, owner })
        return Promise.resolve()
      }
      if (interaction === undefined) return Promise.resolve()
      const rootSessionId = interaction.displayRootSessionId
      const root = roots.get(rootSessionId)
      if (root?.agent !== interaction.displayRootAgent || !this.acceptedRootSessions.has(String(rootSessionId))) return Promise.resolve()
      const routeId = root.routeId ?? executor.rootExecution.capture(root.owner).id
      if (root.routeId === undefined) roots.set(rootSessionId, { ...root, routeId })
      if (routeId !== SDK_ROOT_ROUTE) return Promise.resolve()
      const parentSession = owner.session.header.parentSession
      if (parentSession === undefined) return Promise.resolve()
      const parentSessionId = parentSession
      const parentAgent = parentSessionId === rootSessionId ? root.agent : descendants.get(parentSessionId)?.agent
      if (parentAgent === undefined) return Promise.resolve()
      const childSessionId = owner.session.id
      const previous = descendants.get(childSessionId)
      if (previous !== undefined && previous.agent !== owner.agent && executor.interactionOwner(previous.agent) !== undefined) {
        return Promise.resolve()
      }
      descendants.set(childSessionId, { agent: owner.agent, parentAgent, parentSessionId, rootSessionId })
      observed.set(owner, owner.onEvent((event) => {
        transport.notify('session.event', { sessionId: String(childSessionId), event })
      }))
      transport.notify('subagent.started', { parentSessionId: String(parentSession), childSessionId: String(childSessionId) })
      return Promise.resolve()
    })
    const releaseDetached = active.onDetached((owner) => {
      observed.get(owner)?.()
      observed.delete(owner)
      return Promise.resolve()
    })
    return async () => {
      try { await Promise.all([releaseAttached(), releaseDetached()]) }
      finally {
        releaseFinished()
        for (const release of observed.values()) release()
        observed.clear()
        roots.clear()
        descendants.clear()
      }
    }
  }

  private track<T>(task: Promise<T>): Promise<T> {
    this.pending.add(task)
    void task.then(() => { this.pending.delete(task) }, () => { this.pending.delete(task) })
    return task
  }

  private async initialize(raw: Record<string, unknown>, lifetime: AbortSignal):
  Promise<{ serverInfo: { name: string; version: string } }> {
    this.assertOpen()
    if (this.executor !== undefined || this.initializing) throw new Error('native SDK: already initialized')
    this.initializing = true
    this.rootInitializationFailure = undefined
    try {
      const cwd = resolve(nonempty(raw.cwd, 'cwd'))
      const provider = nonempty(raw.provider, 'provider')
      const model = nonempty(raw.model, 'model')
      const reasoningEffort = raw.reasoningEffort === undefined ? undefined : ReasoningEffortId(nonempty(raw.reasoningEffort, 'reasoningEffort'))
      const maxTokens = raw.maxTokens
      if (maxTokens !== undefined && (typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
        throw new TypeError('native SDK: maxTokens must be a positive integer')
      }
      const signal = AbortSignal.any([lifetime, this.context.signal, this.abort.signal])
      await this.context.require('model').resolveModel?.(provider, model, signal)
      signal.throwIfAborted()
      this.assertOpen()
      this.executor = createNativeHeadlessApplication(this.context, {
        rootRouteId: SDK_ROOT_ROUTE, cwd, provider, model, systemPrompt: this.config.systemPrompt, maxSteps: this.config.maxSteps,
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
        ...maxTokens === undefined ? {} : { maxTokens },
      }, this.context.scope, { execution: this.context.require('sessionExecution'), active: this.context.require('activeSessions') })
      const deletions = this.executor.rootExecution.deletions
      if (deletions !== undefined) Object.defineProperty(this.rootExecution, 'deletions', { enumerable: true, value: deletions })
      Object.freeze(this.rootExecution)
      for (const waiter of [...this.rootExecutionWaiters]) waiter.wake()
      return { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } }
    } catch (failure: unknown) {
      this.rootInitializationFailure = { cause: failure }
      this.rejectRootExecutionWaiters(failure)
      throw failure
    } finally { this.initializing = false }
  }

  private rootOperations(): NativeRootExecutionOperations {
    const executor = this.executor
    if (executor === undefined) throw new Error('native SDK: initialize first')
    return executor.rootExecution
  }

  private async waitForExecutor(signal: AbortSignal): Promise<NativeHeadlessApplication> {
    const executor = this.executor
    if (executor !== undefined) return executor
    if (this.closing || this.abort.signal.aborted || this.context.signal.aborted) {
      return Promise.reject(new Error('native SDK: closing before initialize'))
    }
    if (this.rootInitializationFailure !== undefined) throw this.rootInitializationFailure.cause
    signal.throwIfAborted()
    return new Promise((resolveExecutor, rejectExecutor) => {
      const remove = (): void => {
        signal.removeEventListener('abort', abort)
        this.rootExecutionWaiters.delete(waiter)
      }
      const wake = (): void => {
        const ready = this.executor
        if (ready === undefined) return
        remove()
        resolveExecutor(ready)
      }
      const fail = (cause: unknown): void => {
        remove()
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- preserve AbortSignal's exact cancellation reason.
        rejectExecutor(cause)
      }
      const abort = (): void => {
        fail(signal.reason)
      }
      const waiter = { wake, fail }
      this.rootExecutionWaiters.add(waiter)
      signal.addEventListener('abort', abort, { once: true })
      wake()
    })
  }

  private rejectRootExecutionWaiters(cause: unknown): void {
    for (const waiter of [...this.rootExecutionWaiters]) waiter.fail(cause)
  }

  private async fork(raw: Record<string, unknown>, lifetime: AbortSignal): Promise<{ sessionId: string }> {
    this.assertOpen()
    const executor = this.executor
    if (executor === undefined) throw new Error('native SDK: initialize first')
    const atSeq = raw.atSeq
    if (atSeq !== undefined && typeof atSeq !== 'number') throw new TypeError('native SDK: atSeq must be a non-negative safe integer')
    const id = await executor.rootExecution.fork({ route: SDK_ROOT_ROUTE,
      source: SessionId(nonempty(raw.sessionId, 'sessionId')),
      id: SessionId(nonempty(raw.destinationSessionId, 'destinationSessionId')),
      ...atSeq === undefined ? {} : { atSeq: SessionSeq(atSeq) },
    }, AbortSignal.any([lifetime, this.abort.signal]))
    return { sessionId: id }
  }

  private async cancel(raw: Record<string, unknown>): Promise<{ cancelled: boolean }> {
    this.assertOpen()
    if (this.executor === undefined) throw new Error('native SDK: initialize first')
    const active = this.activeTurns.get(nonempty(raw.sessionId, 'sessionId'))
    if (active === undefined || !active.received) return { cancelled: false }
    active.controller.abort({ kind: 'user' })
    await active.settled
    if (active.failure !== undefined) throw active.failure
    return { cancelled: true }
  }

  private promptParts(raw: Record<string, unknown>): AttachmentAdmissionPart[] {
    if (!Array.isArray(raw.contentBlocks) || raw.contentBlocks.length === 0) {
      throw new TypeError('native SDK: contentBlocks must be a nonempty array')
    }
    const attachments = this.context.require('attachments')
    return raw.contentBlocks.map((block: unknown): AttachmentAdmissionPart => {
      const fields = record(block, 'content block')
      if (fields.type === 'text' && typeof fields.text === 'string') return { type: 'text', text: fields.text }
      if (fields.type === 'image' && typeof fields.data === 'string') {
        const mediaType = attachments.imageLimits.mediaTypes.find(type => type === fields.mimeType)
        if (mediaType !== undefined) return { type: 'image', data: fields.data, mediaType }
      }
      throw new TypeError('native SDK: content blocks must be text or encoded raster images')
    })
  }

  private async steer(raw: Record<string, unknown>, lifetime: AbortSignal): Promise<{ messageId: string }> {
    this.assertOpen()
    const executor = this.executor
    if (executor === undefined) throw new Error('native SDK: initialize first')
    const sessionId = nonempty(raw.sessionId, 'sessionId')
    const admission = this.activeTurns.get(sessionId)
    if (admission === undefined || !admission.received) throw new Error('native SDK: steering requires an admitted turn')
    const active = this.context.require('activeSessions')
    const owner = active.owners().find(candidate => candidate.session.id === sessionId)
    if (owner === undefined || executor.rootExecution.capture(owner).id !== SDK_ROOT_ROUTE) {
      throw new Error("native SDK: steering requires this application's live root owner")
    }
    const signal = AbortSignal.any([lifetime, this.abort.signal, admission.controller.signal])
    signal.throwIfAborted()
    const content = await this.context.require('attachments').admitPromptContent(this.promptParts(raw))
    signal.throwIfAborted()
    this.assertOpen()
    if (this.activeTurns.get(sessionId) !== admission || active.owner(owner.agent, owner.session) !== owner) {
      throw new Error('native SDK: steering owner settled during attachment admission')
    }
    const message = createUserMessage({ content, source: { kind: 'user' } })
    const messageId = await owner.enqueue(message, 'next-step', true, signal)
    return { messageId: String(messageId) }
  }

  private async prompt(raw: Record<string, unknown>, transport: JsonRpcLineTransport,
    lifetime: AbortSignal): Promise<{ messageId: string }> {
    this.assertOpen()
    const executor = this.executor
    if (executor === undefined) throw new Error('native SDK: initialize first')
    const sessionId = nonempty(raw.sessionId, 'sessionId')
    const parts = this.promptParts(raw)
    const attachments = this.context.require('attachments')
    const previous = this.sessions.get(sessionId)
    const accepted = Promise.withResolvers<string>()
    const admission: NativeSdkTurnAdmission = { received: false, controller: new AbortController(), settled: Promise.resolve() }
    const task = (async () => {
      try {
        if (previous !== undefined) await previous
        this.activeTurns.set(sessionId, admission)
        const signal = AbortSignal.any([lifetime, this.abort.signal, admission.controller.signal])
        signal.throwIfAborted()
        const content = await attachments.admitPromptContent(parts)
        signal.throwIfAborted()
        const message = createUserMessage({ content, source: { kind: 'user' } })
        const id = SessionId(sessionId)
        const resume = await this.context.require('sessionPersistence').stat(id, { signal }) !== undefined
        await executor.executeRootTurn({ id, resume, message,
          onChunk: (chunk): void => { transport.notify('session.chunk', { sessionId, chunk }) }, onEvent: (event) => {
            transport.notify('session.event', { sessionId, event })
            if (!admission.received && event.type === 'agent/inbox/spliced'
            && event.data.inserted.some(input => input.id === message.id)) {
              admission.received = true
              this.acceptedRootSessions.add(sessionId)
              accepted.resolve(String(message.id))
              transport.notify('session.status', { sessionId, status: 'running' })
            }
          } }, signal)
        if (!admission.received) throw new Error('native SDK: Session prompt ended without a durable inbox receipt')
      } catch (error: unknown) {
        if (error instanceof AggregateError) admission.failure = error
        if (admission.received) process.stderr.write(`native SDK: Session ${sessionId} failed: ${String(error)}\n`)
        else accepted.reject(error)
      } finally {
        if (this.activeTurns.get(sessionId) === admission) this.activeTurns.delete(sessionId)
        if (admission.received) transport.notify('session.status', { sessionId, status: 'idle' })
      }
    })()
    admission.settled = task
    this.sessions.set(sessionId, task)
    void this.track(task)
    return { messageId: await accepted.promise }
  }
}

/** Host installation selected by the shipped native-sdk profile. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-sdk-server', targets: ['host'],
  requires: ['fs', 'sessionPersistence', 'model', 'modelExecution', 'agents', 'sessionExecution', 'activeSessions', 'attachments'],
  optional: ['subagents', 'tools', 'promptSections', 'sandboxPolicy', 'approval', 'codeRuntime', 'timeContext', 'agentInstructions', 'modelSelection',
    'agentPresets', 'workspaceRegistry'],
  provides: ['application', 'rootExecution'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const application = new NativeSdkApplication(context, config)
      context.provide('application', application)
      context.provide('rootExecution', application.rootExecution)
    }
  },
}
