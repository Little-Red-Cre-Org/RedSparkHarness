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
  private readonly pending = new Set<Promise<void>>()
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
        case 'initialize': return this.initialize(params)
        case 'session/prompt': return this.prompt(params, transport, signal)
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

  private async initialize(raw: Record<string, unknown>): Promise<{ serverInfo: { name: string; version: string } }> {
    if (this.closing) throw new Error('native SDK: closing')
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
      await this.context.require('model').resolveModel?.(provider, model, this.context.signal)
      if (this.closing) throw new Error('native SDK: closing')
      this.executor = createNativeHeadlessApplication(this.context, {
        cwd, provider, model, systemPrompt: this.config.systemPrompt, maxSteps: this.config.maxSteps,
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
        ...maxTokens === undefined ? {} : { maxTokens },
      })
      return { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } }
    } finally { this.initializing = false }
  }

  private prompt(raw: Record<string, unknown>, transport: JsonRpcLineTransport, lifetime: AbortSignal): { messageId: string } {
    if (this.closing) throw new Error('native SDK: closing')
    const executor = this.executor
    if (executor === undefined) throw new Error('native SDK: initialize first')
    const sessionId = nonempty(raw.sessionId, 'sessionId')
    if (!Array.isArray(raw.contentBlocks) || raw.contentBlocks.length === 0
      || raw.contentBlocks.some(block => typeof block !== 'object' || block === null || block.type !== 'text' || typeof block.text !== 'string')) {
      throw new TypeError('native SDK: this profile accepts nonempty text contentBlocks only')
    }
    const content = (raw.contentBlocks as Array<{ type: 'text'; text: string }>).map(block => ({ type: 'text' as const, text: block.text }))
    const message = createUserMessage({ content, source: { kind: 'user' } })
    const previous = this.sessions.get(sessionId)
    const task = (async () => {
      if (previous !== undefined) await previous
      transport.notify('session.status', { sessionId, status: 'running' })
      try {
        await executor.executeRootTurn({ id: SessionId(sessionId), resume: previous !== undefined, message,
          onEvent: (event) => { transport.notify('session.event', { sessionId, event }) },
        }, AbortSignal.any([lifetime, this.abort.signal]))
      } catch (error: unknown) {
        process.stderr.write(`native SDK: Session ${sessionId} failed: ${String(error)}\n`)
      } finally {
        transport.notify('session.status', { sessionId, status: 'idle' })
      }
    })().catch((error: unknown) => { process.stderr.write(`native SDK: Session ${sessionId} failed: ${String(error)}\n`) })
    this.sessions.set(sessionId, task)
    this.pending.add(task)
    void task.then(() => { this.pending.delete(task) })
    return { messageId: String(message.id) }
  }
}

/** Host installation selected by the shipped native-sdk profile. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-sdk-server', targets: ['host'],
  requires: ['fs', 'sessionPersistence', 'model', 'modelExecution', 'agents'],
  optional: ['tools', 'promptSections', 'sandboxPolicy', 'approval', 'codeRuntime', 'timeContext',
    'sessionExecution', 'activeSessions', 'agentPresets', 'workspaceRegistry'],
  provides: ['application'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => { context.provide('application', new NativeSdkApplication(context, config)) }
  },
}
