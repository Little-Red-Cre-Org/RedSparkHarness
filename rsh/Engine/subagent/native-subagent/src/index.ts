/** Native Subagent Definition and in-process spawn Provider. */
import { randomUUID } from 'node:crypto'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { NativePlugin, NativeContext } from '@deepseek-ai/dsh-native-runtime'
import { createUserMessage, type ContentBlock, type ReasoningEffortId, type StreamChunk, type MessageId } from '@deepseek-ai/dsh-llm/native'
import { SessionId, type Session, type TurnEndReason } from '@deepseek-ai/dsh-session/native'
import { NativeSubagentContinuations } from './continuation.ts'
import type { NativeActiveSessionOwner, NativeDelegationSetup,
  NativeSessionConfiguration } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeJobId, NativeJobRegistry } from '@deepseek-ai/dsh-native-jobs'
import type { NativeToolRestriction } from '@deepseek-ai/dsh-native-tools/types'
import { assertObjectJsonSchema, type ObjectJsonSchema } from '@deepseek-ai/dsh-native-tools/json-schema'
import { AssistantOutputFold, snapshotSubagentDescriptor, SUBAGENT_DELEGATION_CONTEXT } from '@deepseek-ai/dsh-subagent-protocol'
import { attachNativeStructuredOutput, type NativeStructuredAttachment } from './structured.ts'
import type {} from '@deepseek-ai/dsh-native-prompt'
import type {} from '@deepseek-ai/dsh-native-tools'
import type { NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import type { NativeExternalSubagentDriver, NativeExternalSubagentFinishedEvent, NativeExternalSubagentId,
  NativeExternalSubagentApprovalOutcome, NativeExternalSubagentApprovalRelay, NativeExternalSubagentApprovalRequest,
  NativeExternalSubagentApprovalRequester, NativeExternalSubagentOutcome, NativeExternalSubagentRequest, NativeExternalSubagentResult,
  NativeExternalSubagentRouteOverrides, NativeExternalSubagentStartedEvent, NativeExternalSubagentRouteField,
  NativeSubagentStopReason } from './external-driver.ts'

export type * from './external-driver.ts'

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
  /**
   * A successful run needs one schema-valid structured_output commit. Failed attempts may retry; normal completion without one is an error.
   */
  readonly outputSchema?: ObjectJsonSchema
}

/** Exact initiating parent and resolved child composition. */
export interface NativeSubagentRequest {
  readonly agent: NativeAgent
  readonly session: Session
  readonly label: string
  readonly prompt: readonly ContentBlock[]
  readonly config: NativeSessionConfiguration
  readonly maxDepth: number
  /** Explicit product route overrides; an external Provider never receives its parent route or identity objects. */
  readonly routeOverrides: NativeExternalSubagentRouteOverrides
  readonly persona?: string
  readonly toolFilter?: NativeToolRestriction
  readonly outputSchema?: ObjectJsonSchema
}

/** Durable child's real result after writer and owned resource release. */
export interface NativeSubagentResult {
  readonly id: SessionId
  readonly provider: string
  readonly output: readonly ContentBlock[]
  /** Accepted schema-valid structured_output value when requested and committed. */
  readonly structured?: unknown
  readonly stopReason: NativeSubagentStopReason
}

/** One admitted one-shot child whose real Session identity is published after initial facts persist. */
export interface NativeSubagentRun {
  readonly id: SessionId
  readonly result: Promise<NativeSubagentResult>
  /** Abort this child and await its writer and owned-resource release. @returns quiescent completion. */
  dispose(): Promise<void>
}

/** One completed one-shot run or settled continuable residency epoch associated with its exact caller. */
export interface NativeSubagentFinished {
  readonly parentAgent: NativeAgent
  readonly parentSession: Session
  readonly result: NativeSubagentResult
}

/** One external child after its real provider handshake and durable parent lineage commit. */
export interface NativeExternalSubagentStarted {
  readonly parentAgent: NativeAgent
  readonly parentSession: Session
  readonly event: NativeExternalSubagentStartedEvent
}

/** Exact parent and durable terminal fact after external range cleanup. */
export interface NativeExternalSubagentFinished {
  readonly parentAgent: NativeAgent
  readonly parentSession: Session
  readonly event: NativeExternalSubagentFinishedEvent
  readonly result?: NativeExternalSubagentResult
}

/** Observer of settled in-process child results; returned promises are observed without delaying settlement.
 * @param finished - exact parent and child result.
 * @returns optional asynchronous observer work; the Provider does not await it.
 */
export type NativeSubagentFinishedListener = (finished: NativeSubagentFinished) => void | Promise<void>

/** Observer of durably published external child identities. */
export type NativeExternalSubagentStartedListener = (started: NativeExternalSubagentStarted) => void | Promise<void>

/** Observer of external terminal facts after the parent writer flushed the cleanup fact. */
export type NativeExternalSubagentFinishedListener = (finished: NativeExternalSubagentFinished) => void | Promise<void>

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
  /** Selected native child transport name. */
  readonly providerName: string
  /** Jobs registry selected by this Provider for background starts; absent in foreground-only assemblies. */
  readonly backgroundJobs: NativeJobRegistry | undefined
  /** Tools registry selected for child permissions and continuation controls; absent in tool-free assemblies. */
  readonly continuationTools: NativeToolRegistry | undefined
  /**
   * Observe in-process results after cleanup; an interrupted turn does not finish a still-resident continuation.
   * @param listener - exact parent and completed result observer.
   * @returns idempotent observer removal; synchronous throws and rejected observer promises are reported without changing child settlement.
   */
  onFinished(listener: NativeSubagentFinishedListener): () => void
  /** Observe external children after the selected writer flushed their Native lineage fact. */
  onExternalStarted(listener: NativeExternalSubagentStartedListener): () => void
  /** Observe external terminal facts after the owned process range is quiescent and the parent writer flushed. */
  onExternalFinished(listener: NativeExternalSubagentFinishedListener): () => void
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
    readonly approvalRequester?: NativeExternalSubagentApprovalRequester
  }): NativeSubagentRequest
  /**
   * Spawn one fresh child through the parent's existing executor.
   * @param request - resolved child request.
   * @param signal - caller cancellation, owning execution through final cleanup.
   * @returns actual output and terminal reason after writer and resource release.
   */
  run(request: NativeSubagentRequest, signal: AbortSignal): Promise<NativeSubagentResult | NativeExternalSubagentResult>
  /**
   * Publish one child handle only after the selected executor reports durable initial readiness.
   * @param request - resolved child composition.
   * @param signal - caller cancellation, retained through child settlement.
   * @returns the actual Session identity and result owned by the existing executor.
   */
  start(request: NativeSubagentRequest, signal: AbortSignal): Promise<NativeSubagentRun>
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

interface ExternalAdmission {
  readonly request: NativeSubagentRequest
  readonly driver: NativeExternalSubagentDriver
  readonly parent: NativeActiveSessionOwner
  readonly root: NativeActiveSessionOwner
  readonly parentEpoch: string
  readonly rootEpoch: string
  readonly approvalRequester?: NativeExternalSubagentApprovalRequester
  state: 'issued' | 'consumed'
}

interface ExternalOperation {
  readonly parent: NativeActiveSessionOwner
  readonly root: NativeActiveSessionOwner
  readonly controller: AbortController
  readonly settled: PromiseWithResolvers<void>
  readonly approvalRequests: Set<Promise<void>>
  readonly drainFailures: unknown[]
}

type ExternalCleanup = { readonly kind: 'quiescent' } | { readonly kind: 'failed'; readonly error: unknown }
interface ExternalDrainFailure { readonly error: unknown }

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
  private readonly finished = new Set<NativeSubagentFinishedListener>()
  private readonly externalStarted = new Set<NativeExternalSubagentStartedListener>()
  private readonly externalFinished = new Set<NativeExternalSubagentFinishedListener>()
  private readonly externalOperations = new Set<ExternalOperation>()
  private externalDrainFailure: ExternalDrainFailure | undefined
  private readonly ownerDrains = new WeakMap<NativeActiveSessionOwner, Promise<void>>()
  private readonly ownerDrainFailures = new WeakMap<NativeActiveSessionOwner, ExternalDrainFailure>()
  private readonly epochs = new WeakMap<NativeActiveSessionOwner, string>()
  private readonly externalAdmissions = new WeakMap<NativeSubagentRequest, ExternalAdmission>()
  private readonly externalDriver: NativeExternalSubagentDriver | undefined
  private readonly continuations: NativeSubagentContinuations
  private readonly cancellation = new AbortController()
  private readonly removeDetached: () => Promise<void>
  private closing = false
  private disposal: Promise<void> | undefined
  constructor(private readonly context: NativeContext, readonly providerName: string) {
    const driver = context.optional('externalSubagentDriver')
    if (providerName === 'spawn' ? driver !== undefined : driver === undefined || driver.name !== providerName) {
      throw new Error(`native-subagent: providerName "${providerName}" does not select the installed external driver`)
    }
    this.externalDriver = driver
    this.removeDetached = context.require('activeSessions').onDetached(owner => this.closeExternalForOwner(owner))
    this.continuations = new NativeSubagentContinuations(context, providerName, (request, setup) => { this.prepare(request, setup) },
      (event) => { this.publishFinished(event) })
  }

  /** @inheritdoc */
  get backgroundJobs(): NativeJobRegistry | undefined { return this.context.optional('jobs') }

  /** @inheritdoc */
  get continuationTools(): NativeToolRegistry | undefined { return this.context.optional('tools') }

  /** @inheritdoc */
  onFinished(listener: NativeSubagentFinishedListener): () => void {
    if (this.closing) throw new Error('native-subagent: Provider is closing')
    this.finished.add(listener)
    return () => { this.finished.delete(listener) }
  }

  /** @inheritdoc */
  onExternalStarted(listener: NativeExternalSubagentStartedListener): () => void {
    if (this.closing) throw new Error('native-subagent: Provider is closing')
    this.externalStarted.add(listener)
    return () => { this.externalStarted.delete(listener) }
  }

  /** @inheritdoc */
  onExternalFinished(listener: NativeExternalSubagentFinishedListener): () => void {
    if (this.closing) throw new Error('native-subagent: Provider is closing')
    this.externalFinished.add(listener)
    return () => { this.externalFinished.delete(listener) }
  }

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
    if (options.outputSchema !== undefined) {
      assertObjectJsonSchema(options.outputSchema)
      if (this.context.optional('tools') === undefined) throw new Error('native-subagent: outputSchema requires tools')
    }
    const routeOverrides: NativeExternalSubagentRouteOverrides = {
      ...options.provider === undefined ? {} : { provider: options.provider },
      ...options.model === undefined ? {} : { model: options.model },
      ...options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort },
    }
    const canonical: NativeSubagentRequest = Object.freeze({ agent, session, label: request.label,
      prompt: structuredClone(request.prompt), maxDepth: options.maxDepth,
      config: Object.freeze({ cwd: parent.cwd, provider, model, systemPrompt: parent.systemPrompt,
        maxSteps: options.maxSteps ?? parent.maxSteps, builtinTools: false,
        ...reasoningEffort === undefined ? {} : { reasoningEffort }, ...maxTokens === undefined ? {} : { maxTokens } }),
      routeOverrides: Object.freeze(routeOverrides),
      ...options.persona === undefined ? {} : { persona: options.persona },
      ...options.toolFilter === undefined ? {} : { toolFilter: structuredClone(options.toolFilter) },
      ...options.outputSchema === undefined ? {} : { outputSchema: structuredClone(options.outputSchema) } })
    const resolved: NativeSubagentRequest = Object.freeze({ ...canonical, prompt: structuredClone(canonical.prompt),
      config: Object.freeze({ ...canonical.config }), routeOverrides: Object.freeze({ ...canonical.routeOverrides }),
      ...canonical.toolFilter === undefined ? {} : { toolFilter: structuredClone(canonical.toolFilter) },
      ...canonical.outputSchema === undefined ? {} : { outputSchema: structuredClone(canonical.outputSchema) } })
    if (this.externalDriver !== undefined) {
      const owners = this.captureExternalOwners(agent, session)
      const admission: ExternalAdmission = { request: canonical, driver: this.externalDriver,
        parent: owners.parent, root: owners.root, parentEpoch: this.epoch(owners.parent), rootEpoch: this.epoch(owners.root),
        ...request.approvalRequester === undefined ? {} : { approvalRequester: request.approvalRequester }, state: 'issued' }
      this.assertExternalAdmission(admission)
      this.externalAdmissions.set(resolved, admission)
    }
    return resolved
  }

  /** @inheritdoc */
  run(request: NativeSubagentRequest, signal: AbortSignal): Promise<NativeSubagentResult | NativeExternalSubagentResult> {
    if (this.closing) throw new Error('native-subagent: Provider is closing')
    const effective = AbortSignal.any([signal, this.context.signal, this.cancellation.signal])
    const driver = this.externalDriver
    if (driver !== undefined) {
      const admission = this.externalAdmissions.get(request)
      if (admission === undefined || admission.state !== 'issued' || admission.driver !== driver) {
        throw new Error('native-subagent: external child requires an unused request issued by this Provider')
      }
      this.assertExternalAdmission(admission)
      admission.state = 'consumed'
      return this.track(this.executeExternal(admission, effective), effective)
    }
    return this.track(this.execute(request, effective), effective)
  }

  /** @inheritdoc */
  async start(request: NativeSubagentRequest, signal: AbortSignal): Promise<NativeSubagentRun> {
    if (this.closing) throw new Error('native-subagent: Provider is closing')
    this.assertSessionBackedProvider()
    signal.throwIfAborted()
    const cancellation = new AbortController()
    const effective = AbortSignal.any([signal, this.context.signal, cancellation.signal, this.cancellation.signal])
    const id = SessionId(randomUUID())
    const ready = Promise.withResolvers<void>()
    let published = false
    const task = this.track(this.execute(request, effective, { id, onReady: () => {
      effective.throwIfAborted()
      published = true
      ready.resolve()
    } }), effective)
    void task.then(() => {
      if (!published) ready.reject(new Error('native-subagent: child settled before readiness'))
    }, ready.reject)
    await ready.promise
    let disposal: Promise<void> | undefined
    return { id, result: task, dispose: () => {
      if (disposal !== undefined) return disposal
      if (!effective.aborted) cancellation.abort({ kind: 'native-subagent-run-disposed' })
      disposal = task.then(() => {}, (error: unknown) => {
        if (effective.aborted && isCancellation(error, effective.reason)) return
        throw error
      })
      return disposal
    } }
  }

  /** @inheritdoc */
  async startBackground(request: NativeSubagentRequest, signal: AbortSignal): Promise<NativeSubagentBackground> {
    if (this.closing) throw new Error('native-subagent: Provider is closing')
    this.assertSessionBackedProvider()
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
          task = this.track(this.execute(request, effective, { id, agentLifetime: true, onReady: () => {
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
    this.assertSessionBackedProvider()
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

  private assertSessionBackedProvider(): void {
    if (this.externalDriver !== undefined) {
      throw new Error(`native-subagent: "${this.providerName}" provides external one-shot runs, not local Session children`)
    }
  }

  private captureExternalOwners(agent: NativeAgent, session: Session): {
    readonly parent: NativeActiveSessionOwner
    readonly root: NativeActiveSessionOwner
  } {
    const active = this.context.require('activeSessions')
    const parent = active.owner(agent, session)
    if (parent === undefined) throw new Error('native-subagent: external child requires the exact active parent owner')
    const bySession = new Map(active.owners().map(owner => [owner.session.id, owner]))
    const visited = new Set<SessionId>([parent.session.id])
    let root = parent
    while (root.invocation !== 'root') {
      const parentId = root.session.header.parentSession
      if (parentId === undefined || visited.has(parentId)) {
        throw new Error('native-subagent: active delegated parent has no valid invocation-root lineage')
      }
      visited.add(parentId)
      const ancestor = bySession.get(parentId)
      if (ancestor === undefined) throw new Error('native-subagent: invocation root is not an active owner')
      root = ancestor
    }
    if (active.owner(parent.agent, parent.session) !== parent || active.owner(root.agent, root.session) !== root) {
      throw new Error('native-subagent: parent or invocation-root owner was released during admission')
    }
    return { parent, root }
  }

  private assertExternalAdmission(admission: ExternalAdmission): void {
    const active = this.context.require('activeSessions')
    if (active.owner(admission.parent.agent, admission.parent.session) !== admission.parent
      || active.owner(admission.root.agent, admission.root.session) !== admission.root
      || this.epoch(admission.parent) !== admission.parentEpoch || this.epoch(admission.root) !== admission.rootEpoch) {
      throw new Error('native-subagent: resolved external child belongs to a released or replaced parent/root owner')
    }
  }

  private epoch(owner: NativeActiveSessionOwner): string {
    let epoch = this.epochs.get(owner)
    if (epoch === undefined) {
      epoch = randomUUID()
      this.epochs.set(owner, epoch)
    }
    return epoch
  }

  private closeExternalForOwner(owner: NativeActiveSessionOwner): Promise<void> {
    const prior = this.ownerDrains.get(owner)
    if (prior !== undefined) return prior
    const drain = this.drainExternalForOwner(owner)
    this.ownerDrains.set(owner, drain)
    return drain
  }

  private async drainExternalForOwner(owner: NativeActiveSessionOwner): Promise<void> {
    const affected = [...this.externalOperations].filter(operation => operation.parent === owner || operation.root === owner)
    for (const operation of affected) operation.controller.abort({ kind: 'native-subagent-owner-released' })
    await Promise.all(affected.map(operation => operation.settled.promise))
    const failure = this.ownerDrainFailures.get(owner)
    if (failure !== undefined) throw new AggregateError([failure.error], 'native-subagent: external child owner drain failed')
  }

  private recordExternalDrainFailure(operation: ExternalOperation, error: unknown): void {
    operation.drainFailures.push(error)
  }

  private async executeExternal(admission: ExternalAdmission, signal: AbortSignal): Promise<NativeExternalSubagentResult> {
    const { request, driver, parent: parentOwner, root: rootOwner, parentEpoch, rootEpoch } = admission
    const routeFields = Object.keys(request.routeOverrides) as NativeExternalSubagentRouteField[]
    const unsupported = routeFields.find(field => !driver.routeFields.includes(field))
    if (unsupported !== undefined) throw new Error(`native-subagent: external driver "${driver.name}" does not support route field "${unsupported}"`)
    for (const field of ['persona', 'toolFilter', 'outputSchema'] as const) {
      if (request[field] !== undefined && !driver.capabilities[field]) {
        throw new Error(`native-subagent: external driver "${driver.name}" does not support "${field}"`)
      }
    }
    const owners = { parent: parentOwner, root: rootOwner }
    const parentDepth = owners.parent.session.header.delegationDepth ?? 0
    if (!Number.isSafeInteger(request.maxDepth) || request.maxDepth < 0 || parentDepth + 1 > request.maxDepth) {
      throw new RangeError('native-subagent: child depth exceeds maxDepth')
    }
    const parentConfig = this.context.require('sessionExecution').configuration(request.agent, request.session)
    if (request.config.cwd !== parentConfig.cwd || request.config.maxSteps > parentConfig.maxSteps
      || parentConfig.maxTokens !== undefined && request.config.maxTokens !== undefined
        && request.config.maxTokens > parentConfig.maxTokens
      || request.routeOverrides.provider !== undefined && request.routeOverrides.provider !== request.config.provider
      || request.routeOverrides.model !== undefined && request.routeOverrides.model !== request.config.model
      || request.routeOverrides.reasoningEffort !== undefined
        && request.routeOverrides.reasoningEffort !== request.config.reasoningEffort) {
      throw new Error('native-subagent: external child route, workspace, or budget exceeds its parent authority')
    }
    if (!Number.isSafeInteger(request.config.maxSteps) || request.config.maxSteps < 1
      || request.config.maxTokens !== undefined && (!Number.isSafeInteger(request.config.maxTokens) || request.config.maxTokens < 1)) {
      throw new Error('native-subagent: external child limits must be positive safe integers')
    }
    const maxTokens = request.config.maxTokens ?? parentConfig.maxTokens
    const id = randomUUID() as NativeExternalSubagentId
    this.assertExternalAdmission(admission)
    const operation: ExternalOperation = { ...owners, controller: new AbortController(),
      settled: Promise.withResolvers<void>(), approvalRequests: new Set(), drainFailures: [] }
    this.externalOperations.add(operation)
    const effective = AbortSignal.any([signal, this.context.signal, this.cancellation.signal, operation.controller.signal])
    let child: Awaited<ReturnType<NativeExternalSubagentDriver['start']>> | undefined
    let dispose: Promise<ExternalCleanup> | undefined
    const cleanupFailed = Promise.withResolvers<unknown>()
    let started: NativeExternalSubagentStartedEvent | undefined
    let startedPersisted = false
    let outcome: NativeExternalSubagentOutcome | undefined
    let failure: { readonly error: unknown } | undefined
    let cleanupConfirmed = child === undefined
    let cancelInstalled = false
    const disposeChild = (): Promise<ExternalCleanup> => dispose ??= Promise.resolve().then(() => child?.dispose()).then(
      () => ({ kind: 'quiescent' as const }),
      (error: unknown) => {
        this.recordExternalDrainFailure(operation, error)
        cleanupFailed.resolve(error)
        return { kind: 'failed', error }
      })
    const cancelChild = (): void => { void disposeChild() }
    try {
      effective.throwIfAborted()
      const route = Object.freeze({ provider: request.config.provider, model: request.config.model,
        ...request.config.reasoningEffort === undefined ? {} : { reasoningEffort: request.config.reasoningEffort },
        overrides: Object.freeze({ ...request.routeOverrides }) })
      const authority = this.context.require('sessionExecution').delegationAuthority(request.agent, request.session)
      if (authority === undefined) {
        throw new Error('native-subagent: external children require a parent delegation-authority snapshot')
      }
      const builtinWriteGrant = authority.builtinToolNames.includes('write_file')
      const approvalRequester = admission.approvalRequester
      const canRelayApproval = driver.name === 'dsh-sdk' && driver.capabilities.approvalRelay
        && approvalRequester !== undefined && authority.approvalRequired && builtinWriteGrant
        && authority.sandboxPolicy?.mode === 'workspace-write'
      const childAuthority = Object.freeze({ ...authority,
        builtinToolNames: Object.freeze(authority.builtinToolNames.filter(name =>
          name === 'read_file' || name === 'write_file' && canRelayApproval)) })
      const approvalIds = new Set<string>()
      const approval: NativeExternalSubagentApprovalRelay | undefined = canRelayApproval && approvalRequester !== undefined
        ? Object.freeze({
          operationId: id,
          request: async (approvalRequest: NativeExternalSubagentApprovalRequest) => {
            const approvalSignal = AbortSignal.any([effective, approvalRequest.signal])
            this.assertExternalAdmission(admission)
            approvalSignal.throwIfAborted()
            if (approvalRequest.operationId !== id || approvalRequest.toolName !== 'write_file'
              || approvalRequest.requestId.length === 0 || approvalIds.has(approvalRequest.requestId)) {
              return 'unavailable' satisfies NativeExternalSubagentApprovalOutcome
            }
            approvalIds.add(approvalRequest.requestId)
            const work = approvalRequester({ ...approvalRequest, signal: approvalSignal })
            const settled = work.then(() => undefined, () => undefined)
            operation.approvalRequests.add(settled)
            try {
              const outcome = await work
              approvalSignal.throwIfAborted()
              this.assertExternalAdmission(admission)
              return outcome
            } finally {
              operation.approvalRequests.delete(settled)
            }
          },
        })
        : undefined
      const externalRequest: NativeExternalSubagentRequest = Object.freeze({
        id, parentSessionId: owners.parent.session.id, rootSessionId: owners.root.session.id, parentEpoch, rootEpoch,
        parentDepth, maxDepth: request.maxDepth,
        limits: Object.freeze({ maxSteps: request.config.maxSteps,
          ...maxTokens === undefined ? {} : { maxTokens } }),
        authority: childAuthority,
        label: request.label, cwd: request.config.cwd, prompt: Object.freeze(structuredClone(request.prompt)), route,
        ...approval === undefined ? {} : { approval },
        ...request.persona === undefined ? {} : { persona: request.persona },
        ...request.toolFilter === undefined ? {} : { toolFilter: structuredClone(request.toolFilter) },
        ...request.outputSchema === undefined ? {} : { outputSchema: structuredClone(request.outputSchema) },
      })
      child = await driver.start(externalRequest, effective)
      effective.throwIfAborted()
      if (child.remoteId.length === 0) throw new Error('native-subagent: external driver returned an empty remote identity')
      effective.addEventListener('abort', cancelChild, { once: true })
      cancelInstalled = true
      if (effective.aborted) cancelChild()
      this.assertExternalAdmission(admission)
      started = { version: 0, id, provider: driver.name, remoteId: child.remoteId, label: request.label,
        parentSessionId: owners.parent.session.id, parentEpoch, rootSessionId: owners.root.session.id, rootEpoch,
        startedAt: Date.now() }
      try {
        owners.parent.append('subagent/external-start', started)
        await owners.parent.flush()
      } catch (error: unknown) {
        this.recordExternalDrainFailure(operation, error)
        throw error
      }
      startedPersisted = true
      this.publishExternalStarted({ parentAgent: owners.parent.agent, parentSession: owners.parent.session, event: started })
      const terminal = child.result.then(
        result => ({ kind: 'result' as const, result }),
        (error: unknown) => ({ kind: 'failure' as const, error }))
      const cleanupFailure = cleanupFailed.promise.then((error: unknown) => ({ kind: 'cleanup-failure' as const, error }))
      const settled = await Promise.race([terminal, cleanupFailure])
      if (settled.kind === 'result') outcome = settled.result
      else if (settled.kind === 'failure') failure = { error: settled.error }
    } catch (error: unknown) {
      failure = { error }
    }
    if (cancelInstalled) effective.removeEventListener('abort', cancelChild)
    if (child !== undefined) {
      const cleanup = await disposeChild()
      await Promise.allSettled([...operation.approvalRequests])
      if (cleanup.kind === 'quiescent') cleanupConfirmed = true
      else {
        cleanupConfirmed = false
        failure = failure === undefined || failure.error === cleanup.error ? { error: cleanup.error } : {
          error: new AggregateError([failure.error, cleanup.error], 'native-subagent: external result and range cleanup failed') }
      }
    }
    try {
      if (startedPersisted && started !== undefined && child !== undefined && cleanupConfirmed) {
        const event: NativeExternalSubagentFinishedEvent = { version: 0, id, provider: driver.name, remoteId: child.remoteId,
          stopReason: outcome?.stopReason ?? (effective.aborted ? 'aborted' : 'error'), finishedAt: Date.now() }
        try {
          owners.parent.append('subagent/external-end', event)
          await owners.parent.flush()
          this.publishExternalFinished({ parentAgent: owners.parent.agent, parentSession: owners.parent.session, event,
            ...outcome === undefined ? {} : { result: { id, provider: driver.name, remoteId: child.remoteId, ...outcome } } })
        } catch (error: unknown) {
          this.recordExternalDrainFailure(operation, error)
          failure = failure === undefined ? { error } : {
            error: new AggregateError([failure.error, error], 'native-subagent: external result and parent persistence failed') }
        }
      }
    } finally {
      if (operation.drainFailures.length > 0) {
        const failure = { error: operation.drainFailures.length === 1 ? operation.drainFailures[0]
          : new AggregateError(operation.drainFailures, 'native-subagent: external cleanup and persistence failed') }
        this.externalDrainFailure ??= failure
        for (const owner of new Set([operation.parent, operation.root])) {
          this.ownerDrainFailures.set(owner, this.ownerDrainFailures.get(owner) ?? failure)
        }
      }
      this.externalOperations.delete(operation)
      operation.settled.resolve()
    }
    if (failure !== undefined) throw failure.error
    if (outcome === undefined || child === undefined) throw new Error('native-subagent: external child settled without a result')
    return { id, provider: driver.name, remoteId: child.remoteId, ...outcome }
  }

  private track<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
    this.pending.set(task, signal)
    const settled = (): void => { this.pending.delete(task) }
    void task.then(settled, settled)
    return task
  }

  private publishFinished(finished: NativeSubagentFinished): void {
    const reportFailure = (error: unknown): void => {
      console.warn('native-subagent: finished observer failed', error)
    }
    for (const listener of this.finished) {
      try {
        const result = listener(finished)
        if (result !== undefined) void result.catch(reportFailure)
      }
      catch (error: unknown) { reportFailure(error) }
    }
  }

  private publishExternalStarted(started: NativeExternalSubagentStarted): void {
    const reportFailure = (error: unknown): void => { console.warn('native-subagent: external-start observer failed', error) }
    for (const listener of this.externalStarted) {
      try {
        const result = listener(started)
        if (result !== undefined) void result.catch(reportFailure)
      } catch (error: unknown) { reportFailure(error) }
    }
  }

  private publishExternalFinished(finished: NativeExternalSubagentFinished): void {
    const reportFailure = (error: unknown): void => { console.warn('native-subagent: external-finish observer failed', error) }
    for (const listener of this.externalFinished) {
      try {
        const result = listener(finished)
        if (result !== undefined) void result.catch(reportFailure)
      } catch (error: unknown) { reportFailure(error) }
    }
  }

  /** Close new starts, cancel accepted execution and await its owned cleanup.
   * @returns settlement after every accepted run releases its resources; cleanup failures reject.
   */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.closing = true
    this.cancellation.abort(new Error('native-subagent: Provider is closing'))
    const pending = [...this.pending]
    this.disposal = this.finishDispose(pending)
    return this.disposal
  }

  private async finishDispose(pending: readonly (readonly [Promise<unknown>, AbortSignal])[]): Promise<void> {
    const results = await Promise.allSettled([...pending.map(([task]) => task), this.continuations.dispose(), this.removeDetached()])
    this.externalStarted.clear()
    this.externalFinished.clear()
    this.finished.clear()
    const errors = results.flatMap((result, index) => {
      if (result.status !== 'rejected') return []
      const run = pending[index]
      if (run !== undefined && (this.externalDriver !== undefined || isCancellation(result.reason, run[1].reason))) return []
      return [result.reason as unknown]
    })
    const contains = (value: unknown, target: unknown): boolean => value === target
      || value instanceof AggregateError && value.errors.some(nested => contains(nested, target))
    const failure = this.externalDrainFailure
    if (failure !== undefined && !errors.some(error => contains(error, failure.error))) {
      errors.push(failure.error)
    }
    if (errors.length > 0) throw new AggregateError(errors, 'native-subagent: accepted run cleanup failed')
  }

  private prepare(request: NativeSubagentRequest, setup: NativeDelegationSetup): NativeStructuredAttachment | undefined {
    const { agent, own } = setup
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
    const schema = request.outputSchema
    if (schema === undefined) return undefined
    const tools = this.context.optional('tools')
    if (tools === undefined) throw new Error('native-subagent: outputSchema requires tools')
    return attachNativeStructuredOutput(setup, tools, prompt, schema)
  }

  private async execute(request: NativeSubagentRequest, signal: AbortSignal, background?: {
    readonly id: SessionId
    readonly onReady?: () => void
    readonly isPublished?: () => boolean
    readonly publishOutput?: (text: string) => void
    readonly agentLifetime?: boolean
  }): Promise<NativeSubagentResult> {
    const id = background?.id ?? SessionId(randomUUID())
    const output = new AssistantOutputFold()
    let end: TurnEndReason | undefined
    const descriptor = snapshotSubagentDescriptor({ mode: 'one-shot', provider: this.providerName, label: request.label })
    let structured: NativeStructuredAttachment | undefined
    try {
      await this.context.require('sessionExecution').delegate(request.agent, request.session, {
        id, config: request.config, maxDepth: request.maxDepth,
        ...background?.agentLifetime === true ? { lifetime: 'agent' as const } : {},
        ...background?.onReady === undefined ? {} : { onReady: background.onReady },
        ...background?.publishOutput === undefined ? {} : { onChunk: (chunk: StreamChunk) => {
          if (chunk.type === 'text-delta') background.publishOutput?.(chunk.text)
        } },
        message: createUserMessage({ source: { kind: 'user' }, content: [...request.prompt] }),
        prepare: (setup) => { structured = this.prepare(request, setup) },
        initialize: (append) => { append('subagent/descriptor', descriptor) },
        onEvent: (event) => {
          output.push(event)
          if (event.type === 'turn/end') end = event.data.reason
        },
      }, signal)
    } catch (error: unknown) {
      // Node cancellation adapters retain the original signal reason as AbortError.cause.
      const cancelled = background?.isPublished?.() === true && signal.aborted && end?.kind === 'aborted'
        && (error === signal.reason || error instanceof Error && error.name === 'AbortError' && error.cause === signal.reason)
      const failed = !cancelled && (signal.aborted || error instanceof AggregateError || end?.kind !== 'error')
      if (failed && end !== undefined) {
        this.publishFinished({ parentAgent: request.agent, parentSession: request.session,
          result: { id, provider: this.providerName, output: error instanceof AggregateError ? [] : output.collect() ?? [],
            stopReason: error instanceof AggregateError ? 'error' : stopReason(end) } })
      }
      if (failed) throw error
    }
    const captured = structured?.captured()
    const terminal = stopReason(end)
    const result: NativeSubagentResult = { id, provider: this.providerName, output: output.collect() ?? [],
      ...captured === undefined ? {} : { structured: captured.value },
      stopReason: request.outputSchema !== undefined && terminal === 'completed' && captured === undefined ? 'error' : terminal }
    this.publishFinished({ parentAgent: request.agent, parentSession: request.session, result })
    return result
  }

}

function isCancellation(error: unknown, reason: unknown): boolean {
  return error === reason || error instanceof Error && error.name === 'AbortError' && error.cause === reason
}

/** Native in-process spawn Provider; deployment selects its advertised name. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-subagent', targets: ['host'],
  requires: ['sessionExecution', 'activeSessions', 'promptSections'], optional: ['tools', 'jobs', 'externalSubagentDriver'], provides: ['subagents'],
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
