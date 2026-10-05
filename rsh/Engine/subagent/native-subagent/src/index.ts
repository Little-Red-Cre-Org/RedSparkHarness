/** Native Subagent Definition and in-process spawn Provider. */
import { randomUUID } from 'node:crypto'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { NativePlugin, NativeContext } from '@deepseek-ai/dsh-native-runtime'
import { createUserMessage, type ContentBlock, type ReasoningEffortId, type StreamChunk, type MessageId } from '@deepseek-ai/dsh-llm/native'
import { SessionId, type Session, type TurnEndReason } from '@deepseek-ai/dsh-session/native'
import { NativeSubagentContinuations } from './continuation.ts'
import type { NativeDelegationSetup, NativeSessionConfiguration } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeJobId, NativeJobRegistry } from '@deepseek-ai/dsh-native-jobs'
import type { NativeToolRestriction } from '@deepseek-ai/dsh-native-tools/types'
import { AssistantOutputFold, snapshotSubagentDescriptor, SUBAGENT_DELEGATION_CONTEXT } from '@deepseek-ai/dsh-subagent-protocol'
import type {} from '@deepseek-ai/dsh-native-prompt'
import type {} from '@deepseek-ai/dsh-native-tools'
import type { NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'

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

/** Durable continuation and initial inbox acceptance. */
export interface NativeSubagentContinuation {
  readonly id: SessionId
  readonly provider: string
  readonly messageId: MessageId
}

/** Exact active caller addressing one existing child or its direct parent. */
export interface NativeSubagentControlRequest {
  readonly agent: NativeAgent
  readonly session: Session
  readonly target: SessionId
}

/** Continuable catalog row or a per-item durable inspection diagnostic. */
export type NativeSubagentCatalogEntry =
  | { readonly kind: 'child'; readonly id: SessionId; readonly label: string; readonly status: 'running' | 'idle' | 'ready'; readonly parent?: SessionId; readonly depth?: number }
  | { readonly kind: 'diagnostic'; readonly id: SessionId; readonly reason: 'corrupt' | 'unsupported' | 'unavailable'; readonly parent?: SessionId; readonly depth?: number }

/** Actual control tools bound to the selected Provider and registry. */
export interface NativeSubagentControlTools {
  readonly subagents: NativeSubagentOperations
  readonly tools: NativeToolRegistry
}

/** Replaceable Subagent Provider; Programs retain Agent execution and Session writing. */
export interface NativeSubagentOperations {
  /** Jobs registry selected by this Provider for background starts; absent in foreground-only assemblies. */
  readonly backgroundJobs: NativeJobRegistry | undefined
  /** Tools registry selected for child permissions and continuation controls; absent in tool-free assemblies. */
  readonly continuationTools: NativeToolRegistry | undefined
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
  /** Create a durable continuable child and accept its first message without waiting for model output.
   * @param request - resolved child permissions and startup composition.
   * @param signal - cancellation before durable message acceptance.
   * @returns actual child and accepted input identities.
   */
  startContinuable(request: NativeSubagentRequest, signal: AbortSignal): Promise<NativeSubagentContinuation>
  /** Send to an adjacent live child or cold-resume a durable continuable child.
   * @param request - exact caller, recipient and authored content.
   * @param signal - cancellation before durable acceptance.
   * @returns the accepted message id, independently of its eventual answer.
   */
  sendMessage(request: NativeSubagentControlRequest & { readonly content: readonly ContentBlock[] },
    signal: AbortSignal): Promise<MessageId>
  /** List continuable children without loading Agents or granting control permissions.
   * @param request - exact initiating Agent, active Session and resolved listing scope.
   * @param signal - corpus and per-item read cancellation.
   * @returns stable direct-child or pre-order descendant rows and per-item diagnostics.
   */
  list(request: { readonly agent: NativeAgent; readonly session: Session; readonly scope: 'children' | 'descendants' },
    signal: AbortSignal): Promise<readonly NativeSubagentCatalogEntry[]>
  /** Interrupt a live descendant's current turn while retaining pending input.
   * @param request - exact active ancestor and addressed child; absent targets are a no-op.
   */
  interrupt(request: NativeSubagentControlRequest): void
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    subagents: NativeSubagentOperations
    subagentControls: NativeSubagentControlTools
  }
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
  private readonly pending = new Map<Promise<unknown>, AbortSignal>()
  private readonly continuations: NativeSubagentContinuations
  private readonly cancellation = new AbortController()
  private closing = false
  constructor(private readonly context: NativeContext, readonly providerName: string) {
    this.continuations = new NativeSubagentContinuations(context, providerName, (request, setup) => { this.prepare(request, setup) })
  }

  /** @inheritdoc */
  get backgroundJobs(): NativeJobRegistry | undefined { return this.context.optional('jobs') }

  /** @inheritdoc */
  get continuationTools(): NativeToolRegistry | undefined { return this.context.optional('tools') }

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
    const jobs = this.backgroundJobs
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

  /** @inheritdoc */
  startContinuable(request: NativeSubagentRequest, signal: AbortSignal): Promise<NativeSubagentContinuation> {
    if (this.closing) throw new Error('native-subagent: Provider is closing')
    const effective = AbortSignal.any([signal, this.context.signal, this.cancellation.signal])
    return this.track(this.continuations.start(request, effective), effective)
  }

  /** @inheritdoc */
  sendMessage(request: NativeSubagentControlRequest & { readonly content: readonly ContentBlock[] },
    signal: AbortSignal): Promise<MessageId> {
    if (this.closing) throw new Error('native-subagent: Provider is closing')
    const effective = AbortSignal.any([signal, this.context.signal, this.cancellation.signal])
    return this.track(this.continuations.send(request.agent, request.session, request.target, request.content, effective), effective)
  }

  /** @inheritdoc */
  list(request: Parameters<NativeSubagentOperations['list']>[0], signal: AbortSignal): Promise<readonly NativeSubagentCatalogEntry[]> {
    if (this.closing) throw new Error('native-subagent: Provider is closing')
    const effective = AbortSignal.any([signal, this.context.signal, this.cancellation.signal])
    return this.track(this.continuations.list(request.agent, request.session, request.scope, effective), effective)
  }

  /** @inheritdoc */
  interrupt(request: NativeSubagentControlRequest): void {
    this.continuations.interrupt(request.agent, request.session, request.target)
  }

  private track<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
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
    const results = await Promise.allSettled([...pending.map(([task]) => task), this.continuations.dispose()])
    const errors = results.flatMap((result, index) => result.status === 'rejected'
      && result.reason !== pending[index]?.[1].reason ? [result.reason as unknown] : [])
    if (errors.length > 0) throw new AggregateError(errors, 'native-subagent: accepted run cleanup failed')
  }

  private prepare(request: NativeSubagentRequest, { agent, own }: NativeDelegationSetup): void {
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
        prepare: (setup) => { this.prepare(request, setup) },
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
