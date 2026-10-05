/** JSON-RPC SDK transport over the native Session executor. */
import { resolve } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-json-rpc-line'
import { createNativeHeadlessApplication, type NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm/native'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import type { NativeApplication, NativeContext, NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-fs/native'
import type {} from '@deepseek-ai/dsh-session-persistence/native'
import type {} from '@deepseek-ai/dsh-native-agent/native'
import type {} from '@deepseek-ai/dsh-native-model-execution/native'

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

/** One native executor and one JSON-RPC connection owned by the profile. */
export class NativeSdkApplication implements NativeApplication {
  private executor: NativeHeadlessApplication | undefined
  private readonly abort = new AbortController()
  private readonly sessions = new Map<string, Promise<void>>()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly activeTurns = new Map<string, { controller: AbortController; received: boolean; settled: Promise<void> }>()
  private closing = false
  private initializing = false

  constructor(private readonly context: NativeContext, private readonly config: Config,
    private readonly input: Readable = process.stdin, private readonly output: Writable = process.stdout) {}

  /**
   * Serve the existing SDK methods until shutdown, EOF, or Host cancellation.
   * @param args - unsupported application arguments.
   * @param signal - Host cancellation, including process signals.
   * @returns zero after accepted work settles and stdio closes.
   */
  async run(args: readonly string[], signal: AbortSignal): Promise<number> {
    if (args.length > 0) throw new Error('native SDK: task arguments are unsupported')
    const transport = new JsonRpcLineTransport(this.input, this.output)
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
      await transport.flush()
      return 0
    } finally {
      this.input.off('end', onEnd)
      signal.removeEventListener('abort', onAbort)
      transport.close()
      this.input.pause()
    }
  }

  private assertOpen(): void {
    if (this.closing) throw new Error('native SDK: closing')
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
        cwd, provider, model, systemPrompt: this.config.systemPrompt, maxSteps: this.config.maxSteps,
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
        ...maxTokens === undefined ? {} : { maxTokens },
      })
      return { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } }
    } finally { this.initializing = false }
  }

  private async cancel(raw: Record<string, unknown>): Promise<{ cancelled: boolean }> {
    this.assertOpen()
    if (this.executor === undefined) throw new Error('native SDK: initialize first')
    const active = this.activeTurns.get(nonempty(raw.sessionId, 'sessionId'))
    if (active === undefined || !active.received) return { cancelled: false }
    active.controller.abort({ kind: 'user' })
    await active.settled
    return { cancelled: true }
  }

  private async prompt(raw: Record<string, unknown>, transport: JsonRpcLineTransport,
    lifetime: AbortSignal): Promise<{ messageId: string }> {
    this.assertOpen()
    const executor = this.executor
    if (executor === undefined) throw new Error('native SDK: initialize first')
    const sessionId = nonempty(raw.sessionId, 'sessionId')
    if (!Array.isArray(raw.contentBlocks) || raw.contentBlocks.length === 0
      || raw.contentBlocks.some((block: unknown) => {
        if (typeof block !== 'object' || block === null) return true
        const fields = block as Record<string, unknown>
        return fields.type !== 'text' || typeof fields.text !== 'string'
      })) {
      throw new TypeError('native SDK: this profile accepts nonempty text contentBlocks only')
    }
    const content = (raw.contentBlocks as Array<{ type: 'text'; text: string }>).map(block => ({ type: 'text' as const, text: block.text }))
    const message = createUserMessage({ content, source: { kind: 'user' } })
    const previous = this.sessions.get(sessionId)
    const accepted = Promise.withResolvers<void>()
    const admission = { received: false, controller: new AbortController(), settled: Promise.resolve() }
    const task = (async () => {
      try {
        if (previous !== undefined) await previous
        this.activeTurns.set(sessionId, admission)
        const signal = AbortSignal.any([lifetime, this.abort.signal, admission.controller.signal])
        const id = SessionId(sessionId)
        const resume = await this.context.require('sessionPersistence').stat(id, { signal }) !== undefined
        await executor.executeRootTurn({ id, resume, message,
          onChunk: (chunk): void => { transport.notify('session.chunk', { sessionId, chunk }) }, onEvent: (event) => {
            transport.notify('session.event', { sessionId, event })
            if (!admission.received && event.type === 'agent/inbox/spliced'
            && event.data.inserted.some(input => input.id === message.id)) {
              admission.received = true
              accepted.resolve()
              transport.notify('session.status', { sessionId, status: 'running' })
            }
          } }, signal)
        if (!admission.received) throw new Error('native SDK: Session prompt ended without a durable inbox receipt')
      } catch (error: unknown) {
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
    await accepted.promise
    return { messageId: String(message.id) }
  }
}

/** Host installation selected by the shipped native-sdk profile. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-sdk-server', targets: ['host'],
  requires: ['fs', 'sessionPersistence', 'model', 'modelExecution', 'agents'],
  optional: ['tools', 'promptSections', 'sandboxPolicy', 'approval', 'codeRuntime', 'timeContext', 'agentInstructions',
    'sessionExecution', 'activeSessions', 'agentPresets', 'workspaceRegistry'],
  provides: ['application'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => { context.provide('application', new NativeSdkApplication(context, config)) }
  },
}
