/** Native one-shot Subagent Definition and in-process spawn Provider. */
import { randomUUID } from 'node:crypto'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { NativePlugin, NativeContext } from '@deepseek-ai/dsh-native-runtime'
import { createUserMessage, type ContentBlock, type ReasoningEffortId, type StreamChunk } from '@deepseek-ai/dsh-llm/native'
import { SessionId, type Session, type TurnEndReason } from '@deepseek-ai/dsh-session/native'
import type { NativeSessionConfiguration } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeJobId } from '@deepseek-ai/dsh-native-jobs'
import type { NativeToolRestriction } from '@deepseek-ai/dsh-native-tools/types'
import { AssistantOutputFold, snapshotSubagentDescriptor, SUBAGENT_DELEGATION_CONTEXT } from '@deepseek-ai/dsh-subagent-protocol'
import type {} from '@deepseek-ai/dsh-native-prompt'
import type {} from '@deepseek-ai/dsh-native-tools'

/** Explicit deployment choices for one fresh child. */
export interface NativeSubagentOptions {
  readonly maxDepth: number
  readonly maxSteps?: number
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: ReasoningEffortId
  readonly maxTokens?: number
  readonly persona?: string
  readonly toolFilter?: NativeToolRestriction
}

/** Exact initiating parent and resolved child composition. */
export interface NativeSubagentRequest {
  readonly agent: NativeAgent
  readonly session: Session
  readonly label: string
  readonly prompt: readonly ContentBlock[]
  readonly config: NativeSessionConfiguration
  readonly maxDepth: number
  readonly persona?: string
  readonly toolFilter?: NativeToolRestriction
}

/** Durable child's real result after writer and owned resource release. */
export interface NativeSubagentResult {
  readonly id: SessionId
  readonly provider: string
  readonly output: readonly ContentBlock[]
  readonly stopReason: 'completed' | 'max-tokens' | 'aborted' | 'refusal' | 'error'
}

/** Published Agent-owned child after its first durable turn facts are committed. */
export interface NativeSubagentBackground {
  readonly id: SessionId
  readonly jobId: NativeJobId
  readonly provider: string
}

/** Replaceable one-shot Provider; Programs retain Agent execution and Session writing. */
export interface NativeSubagentOperations {
  /**
   * Resolve the latest logged parent route, budgets and scoped deployment choices.
   * @param request - exact active initiating parent, prompt and deployment policy.
   * @returns explicit detached child request, including disabled builtin tools.
   */
  resolve(request: {
    readonly agent: NativeAgent
    readonly session: Session
    readonly label: string
    readonly prompt: readonly ContentBlock[]
    readonly options: NativeSubagentOptions
  }): NativeSubagentRequest
  /**
   * Spawn one fresh child through the parent's existing executor.
   * @param request - resolved child request.
   * @param signal - caller cancellation, owning execution through final cleanup.
   * @returns actual output and terminal reason after writer and resource release.
   */
  run(request: NativeSubagentRequest, signal: AbortSignal): Promise<NativeSubagentResult>
  /**
   * Start an Agent-owned child under the selected Jobs registry.
   * @param request - resolved child request with the foreground permission restrictions.
   * @param signal - startup cancellation, relinquished only after actual child readiness.
   * @returns real child identity and job handle after its initial durable facts are committed; startup failures reject after cleanup.
   */
  startBackground(request: NativeSubagentRequest, signal: AbortSignal): Promise<NativeSubagentBackground>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { subagents: NativeSubagentOperations }
}

function stopReason(reason: TurnEndReason | undefined): NativeSubagentResult['stopReason'] {
  switch (reason?.kind) {
    case 'completed': return 'completed'
    case 'max-tokens': return 'max-tokens'
    case 'aborted': return 'aborted'
    case 'blocked': return 'refusal'
    case 'interrupted':
    case 'error':
    default: return 'error'
  }
}

/** One in-process Provider without a second Agent loop, result registry or writer. */
export class NativeSpawnSubagents implements NativeSubagentOperations {
  private readonly pending = new Map<Promise<NativeSubagentResult>, AbortSignal>()
  private readonly cancellation = new AbortController()
  private closing = false
  constructor(private readonly context: NativeContext, readonly providerName: string) {}

  /** @inheritdoc */
  resolve(request: Parameters<NativeSubagentOperations['resolve']>[0]): NativeSubagentRequest {
    const { agent, session, options } = request
    const parent = this.context.require('sessionExecution').configuration(agent, session)
    const latest = session.requestHeader()?.config
    const provider = options.provider ?? latest?.provider ?? parent.provider
    const model = options.model ?? latest?.model ?? parent.model
    const changedRoute = provider !== (latest?.provider ?? parent.provider) || model !== (latest?.model ?? parent.model)
    const reasoningEffort = options.reasoningEffort ?? (changedRoute ? undefined
      : latest === undefined ? parent.reasoningEffort : latest.reasoningEffort)
    const maxTokens = options.maxTokens ?? (latest === undefined ? parent.maxTokens : latest.maxTokens)
    if (options.toolFilter !== undefined && this.context.optional('tools') === undefined) {
      throw new Error('native-subagent: toolFilter requires tools')
    }
    return { agent, session, label: request.label, prompt: [...request.prompt], maxDepth: options.maxDepth,
      config: { cwd: parent.cwd, provider, model, systemPrompt: parent.systemPrompt,
        maxSteps: options.maxSteps ?? parent.maxSteps, builtinTools: false,
        ...reasoningEffort === undefined ? {} : { reasoningEffort }, ...maxTokens === undefined ? {} : { maxTokens } },
      ...options.persona === undefined ? {} : { persona: options.persona },
      ...options.toolFilter === undefined ? {} : { toolFilter: options.toolFilter } }
  }

  /** @inheritdoc */
  run(request: NativeSubagentRequest, signal: AbortSignal): Promise<NativeSubagentResult> {
    if (this.closing) throw new Error('native-subagent: Provider is closing')
    const effective = AbortSignal.any([signal, this.context.signal, this.cancellation.signal])
    const task = this.execute(request, effective)
    return this.track(task, effective)
  }

  /** @inheritdoc */
  async startBackground(request: NativeSubagentRequest, signal: AbortSignal): Promise<NativeSubagentBackground> {
    if (this.closing) throw new Error('native-subagent: Provider is closing')
    const jobs = this.context.optional('jobs')
    if (jobs === undefined) throw new Error('native-subagent: background execution requires jobs')
    signal.throwIfAborted()
    const id = SessionId(randomUUID())
    const ready = Promise.withResolvers<void>()
    const startup = new AbortController()
    const cancelStartup = (): void => { startup.abort(signal.reason) }
    signal.addEventListener('abort', cancelStartup, { once: true })
    const publication = { ready: false }
    let task: Promise<NativeSubagentResult> | undefined
    try {
      const jobId = jobs.start({ agent: request.agent, kind: 'subagent', label: request.label,
        run: async (jobSignal, publishOutput) => {
          const effective = AbortSignal.any([jobSignal, startup.signal, this.context.signal, this.cancellation.signal])
          task = this.track(this.execute(request, effective, { id, onReady: () => {
            if (publication.ready) return
            effective.throwIfAborted()
            publication.ready = true
            signal.removeEventListener('abort', cancelStartup)
            ready.resolve()
          }, isPublished: () => publication.ready, publishOutput }), effective)
          try {
            const result = await task
            return { status: result.stopReason === 'completed' ? 'completed'
              : result.stopReason === 'aborted' ? 'cancelled' : 'failed', detail: result.stopReason,
            output: result.output.filter(block => block.type === 'text').map(block => block.text).join('\n') }
          } finally {
            if (!publication.ready) ready.resolve()
          }
        },
      })
      await ready.promise
      // Readiness failures settle only after delegation has drained its owned resources.
      if (!publication.ready) {
        await task
        throw new Error('native-subagent: child ended before readiness')
      }
      return { id, jobId, provider: this.providerName }
    } finally {
      signal.removeEventListener('abort', cancelStartup)
    }
  }

  private track(task: Promise<NativeSubagentResult>, signal: AbortSignal): Promise<NativeSubagentResult> {
    this.pending.set(task, signal)
    const settled = (): void => { this.pending.delete(task) }
    void task.then(settled, settled)
    return task
  }

  /** Close new starts, cancel accepted execution and await its owned cleanup.
   * @returns settlement after every accepted run releases its resources; cleanup failures reject.
   */
  async dispose(): Promise<void> {
    this.closing = true
    this.cancellation.abort(new Error('native-subagent: Provider is closing'))
    const pending = [...this.pending]
    const results = await Promise.allSettled(pending.map(([task]) => task))
    const errors = results.flatMap((result, index) => result.status === 'rejected'
      && result.reason !== pending[index]?.[1].reason ? [result.reason as unknown] : [])
    if (errors.length > 0) throw new AggregateError(errors, 'native-subagent: accepted run cleanup failed')
  }

  private async execute(request: NativeSubagentRequest, signal: AbortSignal, background?: {
    readonly id: SessionId
    readonly onReady: () => void
    readonly isPublished: () => boolean
    readonly publishOutput: (text: string) => void
  }): Promise<NativeSubagentResult> {
    const id = background?.id ?? SessionId(randomUUID())
    const output = new AssistantOutputFold()
    let end: TurnEndReason | undefined
    const descriptor = snapshotSubagentDescriptor({ mode: 'one-shot', provider: this.providerName, label: request.label })
    try {
      await this.context.require('sessionExecution').delegate(request.agent, request.session, {
        id, config: request.config, maxDepth: request.maxDepth,
        ...background === undefined ? {} : { lifetime: 'agent' as const,
          onReady: background.onReady, onChunk: (chunk: StreamChunk) => {
            if (chunk.type === 'text-delta') background.publishOutput(chunk.text)
          } },
        message: createUserMessage({ source: { kind: 'user' }, content: [...request.prompt] }),
        prepare: ({ agent, own }) => {
          const prompt = this.context.require('promptSections')
          own(prompt.register({ name: 'subagent:delegation', order: 100, text: () => SUBAGENT_DELEGATION_CONTEXT }, agent.scope))
          if (request.toolFilter !== undefined) {
            const tools = this.context.optional('tools')
            if (tools === undefined) throw new Error('native-subagent: toolFilter requires tools')
            own(tools.restrict(request.toolFilter, agent.scope))
          }
          const persona = request.persona
          if (persona !== undefined) {
            own(prompt.register({ name: 'deployment:persona-prefix', order: 0, text: () => persona }, agent.scope))
          }
        },
        initialize: (append) => { append('subagent/descriptor', descriptor) },
        onEvent: (event) => {
          output.push(event)
          if (event.type === 'turn/end') end = event.data.reason
        },
      }, signal)
    } catch (error: unknown) {
      // Node cancellation adapters retain the original signal reason as AbortError.cause.
      const cancelled = background?.isPublished() === true && signal.aborted && end?.kind === 'aborted'
        && (error === signal.reason || error instanceof Error && error.name === 'AbortError' && error.cause === signal.reason)
      if (!cancelled && (signal.aborted || error instanceof AggregateError || end?.kind !== 'error')) throw error
    }
    return { id, provider: this.providerName, output: output.collect() ?? [], stopReason: stopReason(end) }
  }
}

/** Native in-process spawn Provider; deployment selects its advertised name. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-subagent', targets: ['host'],
  requires: ['sessionExecution', 'promptSections'], optional: ['tools', 'jobs'], provides: ['subagents'],
  resolve(input) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('native-subagent: configuration must be an object')
    const fields = input as Record<string, unknown>
    if (Object.keys(fields).some(key => key !== 'providerName') || typeof fields.providerName !== 'string' || fields.providerName.length === 0) {
      throw new Error('native-subagent: providerName must be a nonempty string and the only configuration field')
    }
    const providerName = fields.providerName
    return (context) => {
      const provider = new NativeSpawnSubagents(context, providerName)
      context.own(() => provider.dispose())
      context.provide('subagents', provider)
    }
  },
}
