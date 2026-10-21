/** Reversible native tool contributions consumed by a selected application. */
import { HarnessError, type ContentBlock, type ToolCallId, type ToolSchema, type UserMessage } from '@deepseek-ai/dsh-llm/native'
import { deepFreeze, snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import { type NativeAgent, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import { NativeContributions, type NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type {
  Session, SessionEvent, SessionEventMap, SessionEventType, SurfaceEventType, SurfaceIntent,
} from '@deepseek-ai/dsh-session/native'
import { assertSupportedJsonSchema, type JsonSchemaNode, ToolArgsError, validateJsonSchemaValue } from './json-schema.ts'
import type { ToolSdkSchema } from './ts-types.ts'
import type { NativeToolRestriction } from './types.ts'
import { registerAsyncPolicy, processAsyncWaterfall, type AsyncPolicyRegistration } from './result-processing.ts'
export { createNativePtcDispatch, type NativePtcDispatch } from './ptc-dispatch.ts'

/** Model transport selection; program bindings retain the same scoped business capabilities. */
export type NativeToolMode = 'native' | 'ptc' | 'both'

/** One model-requested tool invocation with its Session and cancellation. */
export interface NativeToolExecution {
  /** Exact live Agent that owns this invocation's scope and initiator attribution. */
  readonly agent: NativeAgent
  readonly callId: ToolCallId
  readonly name: string
  readonly arguments: unknown
  readonly session: Session
  readonly signal: AbortSignal
  /** Exact enclosing admitted invocation for a nested program call. */
  readonly parent?: NativeToolExecution
  /** Unbound application approval authority; the registry binds it to each admitted invocation. */
  readonly approvalAuthority?: NativeToolApprovalAuthority
  /** Append and persist a tool-owned Session event before returning a model-visible result. */
  readonly appendEvent: <T extends SessionEventType>(
    type: T, data: SessionEventMap[T], ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent<T>] : []
  ) => Promise<SessionEvent<T>>
  /** Ask the consuming application's selected policy before a protected tool executes. */
  readonly authorize?: (approval: NativeToolApproval, signal: AbortSignal) => Promise<void>
  /** Obtain the audited decision for a one-call escalation without a second generic approval. */
  readonly requestApproval?: (approval: NativeToolApproval, signal: AbortSignal) => Promise<NativeToolApprovalOutcome>
}

/** Invocation facts supplied by the registry to the application's approval authority. */
export interface NativeToolApprovalRequest {
  readonly agent: NativeAgent
  readonly session: Session
  readonly callId: ToolCallId
  readonly toolName: string
  readonly reason?: string
  readonly signal: AbortSignal
}

/** Application-owned approval policy and durable request/decision recording. */
export interface NativeToolApprovalAuthority {
  /**
   * Obtain a one-call decision for the exact admitted invocation.
   * @param request - invocation attribution, reason and merged cancellation.
   * @returns the audited decision before protected execution.
   */
  request(request: NativeToolApprovalRequest): Promise<NativeToolApprovalOutcome>
  /**
   * Require approval before an ordinary protected invocation.
   * @param request - invocation attribution, reason and merged cancellation.
   * @returns completion after authorization; rejects when execution is forbidden.
   */
  authorize(request: NativeToolApprovalRequest): Promise<void>
}

/** Closed answer returned to a tool that handles its own approval outcome. */
export type NativeToolApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** Optional pre-execution approval requested by one tool contribution. */
export interface NativeToolApproval {
  /** Human-readable explanation for the answerer and durable audit. */
  readonly reason?: string
}

/** Model-visible outcome to append once to the authoritative Session. */
export interface NativeToolResult {
  readonly content: readonly ContentBlock[]
  readonly isError: boolean
  /** Tool-owned JSON presentation facts persisted with the result, outside model content. */
  readonly meta?: JsonValue
  readonly error?: { readonly name: string; readonly code: string }
  /** Detached, validated JSON for program calls; absent for presentation-only contributions. */
  readonly value?: JsonValue
  /** Sourced inputs appended after this tool result and before the next model request, including on failure. */
  readonly additionalContexts?: readonly UserMessage[]
  /** A successful result may finish the turn after the current model batch settles. */
  readonly concludesTurn?: true
}

/** A tool whose canonical JSON result is validated before presentation or program consumption. */
export interface NativeValueToolContribution {
  readonly schema: ToolSchema
  readonly approval?: NativeToolApproval
  /** Optional body overlap policy; undeclared contributions execute exclusively. */
  readonly isConcurrencySafe?: NativeToolConcurrencyClassifier
  /** Await tool-owned decoration after result policies and before Session persistence. */
  readonly finalizeResult?: NativeToolResultFinalizer
  readonly output: {
    readonly schema: JsonSchemaNode
    /**
     * Render the frozen canonical value without supplying a second canonical result.
     * @param call - admitted invocation whose operation has completed.
     * @param value - detached JSON validated against the captured output schema.
     * @returns the model-visible presentation recorded by the application.
     */
    readonly render: (call: NativeToolExecution, value: JsonValue) => Omit<NativeToolResult, 'value'>
  }
  /**
   * Execute the operation; output validation belongs to the registry.
   * @param call - admitted invocation with merged cancellation and application callbacks.
   * @returns the candidate JSON result to validate before rendering or program consumption.
   */
  execute(call: NativeToolExecution): Promise<unknown>
}

/** Composite operation retaining canonical JSON separately from its model-context effects. */
export interface NativeProjectedToolOutcome {
  /** Candidate canonical JSON validated against the contribution's captured output schema. */
  readonly value: unknown
  /** Sourced messages kept outside canonical JSON and retained on rendered failure. */
  readonly additionalContexts?: readonly UserMessage[]
  /** Applied only when the rendered result succeeds. */
  readonly concludesTurn?: true
}

/** Value contribution whose execution also produces sourced contexts or a successful turn conclusion. */
export interface NativeProjectedToolContribution extends Omit<NativeValueToolContribution, 'execute'> {
  /** @param call - admitted invocation. @returns canonical value and its separately owned model-context effects. */
  execute(call: NativeToolExecution): Promise<NativeProjectedToolOutcome>
}

/** Tool schema and execution supplied by one installation. */
export interface NativeToolContribution {
  readonly schema: ToolSchema
  /** Optional body overlap policy; undeclared contributions execute exclusively. */
  readonly isConcurrencySafe?: NativeToolConcurrencyClassifier
  /** Require the consuming application to authorize this exact invocation before execute(). */
  readonly approval?: NativeToolApproval
  /** Await tool-owned decoration after result policies and before Session persistence. */
  readonly finalizeResult?: NativeToolResultFinalizer
  execute(call: NativeToolExecution): Promise<NativeToolResult>
}

/**
 * Classify body overlap after captured parameter validation.
 * @param args - detached, frozen JSON arguments visible to this tool's executing Agent.
 * @returns true when this operation may overlap other parallel operations; false requires exclusive execution.
 */
export type NativeToolConcurrencyClassifier = (args: unknown) => boolean

/**
 * Synchronous policy over an admitted invocation; guards cannot override another guard's denial.
 * @param call - fixed invocation identity and frozen JSON arguments.
 * @returns a denial reason, or undefined when this guard does not deny execution.
 */
export type NativeToolGuard = (call: Readonly<NativeToolExecution>) => string | undefined

/**
 * Observe a final tool result after its Session owner has persisted it.
 * @param call - exact admitted execution; nested calls retain their enclosing execution identity.
 * @param result - detached immutable outcome; observers cannot replace the accepted result.
 */
export type NativeToolResultObserver = (call: NativeToolExecution, result: Readonly<NativeToolResult>) => void

/**
 * Transform a completed result before its Session owner records it.
 * @param call - admitted invocation with cancellation of every captured policy.
 * @param original - immutable operation result before any policy transforms it.
 * @param next - delegate exactly once to the remaining policies.
 * @returns the selected result after downstream processing settles.
 */
export type NativeToolResultPolicy = (
  call: NativeToolExecution, original: Readonly<NativeToolResult>, next: () => Promise<NativeToolResult>,
) => Promise<NativeToolResult>

/**
 * Decorate the policy-selected result while its tool registration still owns the invocation.
 * @param call - admitted invocation; cancellation prevents new decoration.
 * @param original - operation result with its original canonical value and content identities.
 * @param selected - result returned by the complete policy chain.
 * @returns the final result to validate and return to the Session owner.
 */
export type NativeToolResultFinalizer = (
  call: NativeToolExecution, original: Readonly<NativeToolResult>, selected: NativeToolResult,
) => Promise<NativeToolResult>

/** Log-only projection of one nested dispatch; program results remain unchanged. */
export interface NativePtcDispatchLog {
  readonly content: readonly ContentBlock[]
  readonly isError: boolean
}

/**
 * Project nested result text before the parent Session persists its dispatch event.
 * @param call - exact nested invocation; its execution signal may already be aborted by normal program close.
 * @param original - completed program result, preserved for bindings and result observers.
 * @param next - delegate exactly once to remaining log policies.
 * @param signal - log-policy and registry cancellation, independent of program-end cancellation.
 * @returns only the content and error status to record in the dispatch log.
 */
export type NativePtcDispatchLogPolicy = (
  call: NativeToolExecution, original: Readonly<NativeToolResult>, next: () => Promise<NativePtcDispatchLog>, signal: AbortSignal,
) => Promise<NativePtcDispatchLog>

export type { NativeToolRestriction } from './types.ts'

interface CompiledToolRestriction {
  readonly allow?: ReadonlySet<string>
  readonly deny?: ReadonlySet<string>
}

/** One prepared invocation retaining its selected contribution until dispatch or cancellation. */
export interface NativePreparedToolInvocation {
  /** @returns the contribution result; rejects cancellation or a second dispatch. */
  execute(): Promise<NativeToolResult>
  /** Release an invocation that will not be dispatched; repeated abandonment has no effect. */
  abandon(): void
}

interface ToolRegistration {
  readonly tool: NativeToolContribution
  readonly schema: ToolSchema
  readonly outputSchema?: JsonSchemaNode
  readonly isConcurrencySafe?: NativeToolConcurrencyClassifier
  readonly validate: (args: unknown) => void
  readonly controller: AbortController
  readonly pending: Set<Promise<void>>
  readonly dispose: () => Promise<void>
}

type ResultPolicyRegistration = AsyncPolicyRegistration<NativeToolResultPolicy>
type PtcLogPolicyRegistration = AsyncPolicyRegistration<NativePtcDispatchLogPolicy>

/** A registry whose disposer cancels and drains only the contribution it installed. */
export class NativeToolRegistry {
  private readonly tools: NativeContributions<ToolRegistration>
  private readonly guards: NativeContributions<NativeToolGuard>
  private readonly restrictions: NativeContributions<CompiledToolRestriction>
  private readonly resultObservers: NativeContributions<NativeToolResultObserver>
  private readonly resultPolicies: NativeContributions<ResultPolicyRegistration>
  private readonly ptcLogPolicies: NativeContributions<PtcLogPolicyRegistration>
  private readonly ptcLogPolicyRegistrations = new Set<PtcLogPolicyRegistration>()
  private readonly ptcLogPending = new Set<Promise<void>>()
  private readonly ptcLogController = new AbortController()
  private ptcLogSequence = 0
  private readonly policyRegistrations = new Set<ResultPolicyRegistration>()
  private readonly resultInvocations = new WeakMap<NativeToolExecution, { execution: NativeToolExecution; settled: boolean }>()
  private resultObserverSequence = 0
  private resultPolicySequence = 0
  private guardSequence = 0
  private restrictionSequence = 0
  private readonly registrations = new Set<ToolRegistration>()
  private disposal: Promise<void> | undefined

  /**
   * @param agents - live native Agent authority selected by this tool scope.
   * @param scope - Provider scope containing every contribution and executing Agent.
   * @param modelMode - model transport selection, defaulting to both for in-process assemblies.
   */
  constructor(
    private readonly agents: NativeAgentRegistry, private readonly scope: NativeScope, readonly modelMode: NativeToolMode = 'both',
  ) {
    this.tools = new NativeContributions(scope)
    this.guards = new NativeContributions(scope)
    this.resultObservers = new NativeContributions(scope)
    this.resultPolicies = new NativeContributions(scope)
    this.ptcLogPolicies = new NativeContributions(scope)
    this.restrictions = new NativeContributions(scope)
  }

  /**
   * Filter inherited capabilities in a descendant scope; restrictions intersect along the ancestry.
   * @param filter - allow and/or deny names belonging to inherited contributions; empty allow hides every inherited tool.
   * @param scope - descendant installation scope; a Provider-wide restriction is forbidden.
   * @returns an exact idempotent disposer for context.effect().
   */
  restrict(filter: NativeToolRestriction, scope: NativeScope): () => void {
    if (this.disposal !== undefined) throw new Error('native-tools: registry is disposed')
    this.tools.visible(scope)
    if (scope === this.scope) throw new Error('native-tools: restrictions require a descendant scope')
    if (filter.allow === undefined && filter.deny === undefined) throw new Error('native-tools: restriction must declare allow or deny')
    const inherited = this.tools.visible(scope.parent)
    const names = [...filter.allow ?? [], ...filter.deny ?? []]
    if (names.includes('run_code')) throw new Error('native-tools: restrict end capabilities rather than run_code transport')
    const unknown = names.filter(name => !inherited.has(name))
    if (unknown.length > 0) throw new Error(`native-tools: restriction names unknown inherited tools: ${unknown.join(', ')}`)
    return this.restrictions.register(`restriction:${this.restrictionSequence++}`, {
      ...filter.allow === undefined ? {} : { allow: new Set(filter.allow) },
      ...filter.deny === undefined ? {} : { deny: new Set(filter.deny) },
    }, scope)
  }

  private visible(scope = this.scope): Map<string, ToolRegistration> {
    const all = this.tools.visible(scope)
    if (scope === this.scope) return all
    const inherited = this.tools.visible(scope.parent)
    const filters = [...this.restrictions.visible(scope).values()]
    const visible = new Map<string, ToolRegistration>()
    for (const [name, entry] of inherited) {
      if (name === 'run_code' || filters.every(filter =>
        (filter.allow === undefined || filter.allow.has(name)) && !filter.deny?.has(name))) {
        visible.set(name, entry)
      }
    }
    for (const [name, entry] of all) if (entry !== inherited.get(name)) visible.set(name, entry)
    return visible
  }

  private assertVisible(call: NativeToolExecution, entry: ToolRegistration): void {
    if (this.visible(call.agent.scope).get(call.name) !== entry) {
      throw new HarnessError(`native-tools: tool ${call.name} is no longer visible`, 'TOOL_DENIED')
    }
  }

  /**
   * Install a monotonic guard in a Provider or descendant scope, visible to its descendants.
   * @param guard - synchronous denial policy checked before approval and immediately before body entry.
   * @param scope - policy installation scope, defaulting to the Provider scope.
   * @returns the exact idempotent disposer; installation owners register it through context.effect().
   */
  guard(guard: NativeToolGuard, scope?: NativeScope): () => void {
    if (this.disposal !== undefined) throw new Error('native-tools: registry is disposed')
    return this.guards.register(`guard:${this.guardSequence++}`, guard, scope)
  }

  /**
   * Observe immutable settlement in the executing Agent's scope.
   * @param observer - synchronous observer called only after owner acceptance.
   * @param scope - installation scope, defaulting to the Provider scope.
   * @returns an exact idempotent disposer owned by the installing module.
   */
  onResult(observer: NativeToolResultObserver, scope?: NativeScope): () => void {
    if (this.disposal !== undefined) throw new Error('native-tools: registry is disposed')
    return this.resultObservers.register(`result:${this.resultObserverSequence++}`, observer, scope)
  }

  /**
   * Register scoped asynchronous result processing before durable acceptance.
   * @param policy - waterfall delegate; every listener calls next exactly once.
   * @param scope - installation scope, defaulting to the Provider scope.
   * @returns disposer that closes admission, cancels captured calls and awaits settlement.
   */
  postResult(policy: NativeToolResultPolicy, scope?: NativeScope): () => Promise<void> {
    if (this.disposal !== undefined) throw new Error('native-tools: registry is disposed')
    const entry = registerAsyncPolicy(this.resultPolicies, this.policyRegistrations,
      `policy:${this.resultPolicySequence++}`, policy, scope)
    return () => entry.dispose()
  }

  /**
   * Register a scoped log-only waterfall for nested program dispatch settlement.
   * @param policy - projection that delegates exactly once and honors its independent cancellation signal.
   * @param scope - installation scope, defaulting to the Provider scope.
   * @returns disposer that closes admission, cancels captured projections and awaits settlement.
   */
  postPtcDispatchLog(policy: NativePtcDispatchLogPolicy, scope?: NativeScope): () => Promise<void> {
    if (this.disposal !== undefined) throw new Error('native-tools: registry is disposed')
    const entry = registerAsyncPolicy(this.ptcLogPolicies, this.ptcLogPolicyRegistrations,
      `ptc-log:${this.ptcLogSequence++}`, policy, scope)
    return () => entry.dispose()
  }

  /**
   * Own one nested result's asynchronous log projection without changing its program-visible result.
   * @param call - exact registered Agent and nested invocation attribution.
   * @param result - completed tool result delivered unchanged to the program and result observers.
   * @returns detached log content after captured policy settlement; normal program close does not cancel logging.
   */
  async projectPtcDispatchLog(call: NativeToolExecution, result: NativeToolResult): Promise<NativePtcDispatchLog> {
    if (this.disposal !== undefined) throw new Error('native-tools: registry is disposed')
    if (this.agents.get(call.agent.id) !== call.agent) throw new Error(`native-tools: Agent "${call.agent.id}" is not registered`)
    if (call.parent === undefined) throw new Error('native-tools: PTC log projection requires a nested invocation')
    const policies = [...this.ptcLogPolicies.visible(call.agent.scope).values()]
    const signal = AbortSignal.any([this.ptcLogController.signal, ...policies.map(policy => policy.controller.signal)])
    const completion = Promise.withResolvers<void>()
    this.ptcLogPending.add(completion.promise)
    for (const policy of policies) policy.pending.add(completion.promise)
    try {
      const original = deepFreeze(result)
      const selected = await processAsyncWaterfall(policies.length,
        { content: original.content, isError: original.isError }, signal, (index, next) => {
          const policy = policies[index]
          if (policy === undefined) throw new Error('native-tools: captured log policy is missing')
          return policy.policy(call, original, next, signal)
        })
      signal.throwIfAborted()
      const projected = { content: [...selected.content], isError: selected.isError }
      if (snapshotJsonValue(projected) === undefined) throw new HarnessError('native PTC log must be lossless JSON', 'INVALID_TOOL_OUTPUT')
      return deepFreeze(structuredClone(projected))
    } finally {
      this.ptcLogPending.delete(completion.promise)
      for (const policy of policies) policy.pending.delete(completion.promise)
      completion.resolve()
    }
  }

  private async processResult(
    call: NativeToolExecution, entry: ToolRegistration, policies: readonly ResultPolicyRegistration[],
  ): Promise<NativeToolResult> {
    const executed = await entry.tool.execute(call)
    call.signal.throwIfAborted()
    if (policies.length === 0 && entry.tool.finalizeResult === undefined) return executed
    const original = deepFreeze(executed)
    const selected = await processAsyncWaterfall(policies.length, original, call.signal, (index, next) => {
      const policy = policies[index]
      if (policy === undefined) throw new Error('native-tools: captured result policy is missing')
      return policy.policy(call, original, next)
    })
    call.signal.throwIfAborted()
    const finalized = entry.tool.finalizeResult === undefined ? selected : await entry.tool.finalizeResult(call, original, selected)
    call.signal.throwIfAborted()
    const snapshot = snapshotJsonValue(finalized)
    if (snapshot === undefined) throw new HarnessError(`tool "${call.name}" returned non-lossless JSON`, 'INVALID_TOOL_OUTPUT')
    if (entry.outputSchema !== undefined) {
      const violations = validateJsonSchemaValue(entry.outputSchema, finalized.value, 'value')
      if (violations.length > 0) throw new HarnessError(`tool "${call.name}" returned invalid output: ${violations.join('; ')}`, 'INVALID_TOOL_OUTPUT')
    }
    return deepFreeze(snapshot)
  }

  /**
   * Notify settlement after the Session owner persists its final normalized result.
   * @param call - original invocation passed to prepare or execute; unadmitted calls have no observers.
   * @param result - final outcome recorded by the owner, including normalized execution failures.
   */
  acceptResult(call: NativeToolExecution, result: NativeToolResult): void {
    const invocation = this.resultInvocations.get(call)
    if (invocation === undefined) return
    if (!invocation.settled) throw new Error('native-tools: cannot accept a result before execution settles')
    this.resultInvocations.delete(call)
    this.resultInvocations.delete(invocation.execution)
    const accepted = deepFreeze(structuredClone(result))
    for (const observer of this.resultObservers.visible(invocation.execution.agent.scope).values()) {
      observer(invocation.execution, accepted)
    }
  }

  private assertGuards(call: NativeToolExecution): void {
    for (const guard of this.guards.visible(call.agent.scope).values()) {
      const reason = guard(call)
      if (reason !== undefined) throw new HarnessError(reason, 'TOOL_DENIED')
    }
  }

  /**
   * Capture an output schema and renderer using ordinary scoped admission, approval and disposal.
   * @param tool - operation with a canonical JSON result and its presentation.
   * @param scope - installation scope, defaulting to the Provider scope.
   * @returns the registration's cancellation and settlement disposer.
   */
  registerValueTool(tool: NativeValueToolContribution, scope?: NativeScope): () => Promise<void> {
    return this.registerProjectedTool({ ...tool, execute: async call => ({ value: await tool.execute(call) }) }, scope)
  }

  /**
   * Register a composite value operation without inserting contexts into its program-visible JSON.
   * @param tool - canonical operation, renderer and sourced model-context effects.
   * @param scope - installation scope, defaulting to the Provider scope.
   * @returns the registration's cancellation and settlement disposer; failed results cannot conclude a turn.
   */
  registerProjectedTool(tool: NativeProjectedToolContribution, scope?: NativeScope): () => Promise<void> {
    const outputSchema = structuredClone(tool.output.schema)
    assertSupportedJsonSchema(outputSchema)
    const render = tool.output.render
    return this.install({
      schema: tool.schema, ...(tool.approval === undefined ? {} : { approval: tool.approval }),
      ...(tool.finalizeResult === undefined ? {} : { finalizeResult: tool.finalizeResult }),
      ...(tool.isConcurrencySafe === undefined ? {} : { isConcurrencySafe: tool.isConcurrencySafe }),
      async execute(call) {
        const candidate = await tool.execute(call)
        const value = snapshotJsonValue(candidate.value)
        if (value === undefined) throw new HarnessError(`tool "${call.name}" returned non-lossless JSON`, 'INVALID_TOOL_OUTPUT')
        const violations = validateJsonSchemaValue(outputSchema, value, 'value')
        if (violations.length > 0) throw new HarnessError(`tool "${call.name}" returned invalid output: ${violations.join('; ')}`, 'INVALID_TOOL_OUTPUT')
        const canonical = deepFreeze(value as JsonValue)
        const { concludesTurn, ...rendered } = render(call, canonical)
        const contexts = [...candidate.additionalContexts ?? [], ...rendered.additionalContexts ?? []]
        const presentation = snapshotJsonValue({ ...rendered,
          ...contexts.length === 0 ? {} : { additionalContexts: contexts },
          ...!rendered.isError && (candidate.concludesTurn === true || concludesTurn === true) ? { concludesTurn: true as const } : {},
        })
        if (presentation === undefined) throw new HarnessError(`tool "${call.name}" rendered non-lossless JSON`, 'INVALID_TOOL_OUTPUT')
        return deepFreeze({ ...presentation, value: canonical })
      },
    }, scope, outputSchema)
  }

  /**
   * Capture one supported schema; duplicates within a scope fail, descendants may shadow ancestors.
   * @param tool - schema and executor supplied by one installation.
   * @param scope - installation scope, defaulting to the Provider scope.
   * @returns an idempotent disposer that removes the registration, cancels calls and awaits their settlement.
   */
  register(tool: NativeToolContribution, scope?: NativeScope): () => Promise<void> {
    return this.install(tool, scope)
  }

  private install(tool: NativeToolContribution, scope?: NativeScope, outputSchema?: JsonSchemaNode): () => Promise<void> {
    if (this.disposal !== undefined) throw new Error('native-tools: registry is disposed')
    const schema = structuredClone(tool.schema)
    const parameters = schema.parameters
    assertSupportedJsonSchema(parameters)
    let completion: Promise<void> | undefined
    const entry: ToolRegistration = {
      tool, schema, controller: new AbortController(), pending: new Set(),
      ...(outputSchema === undefined ? {} : { outputSchema }),
      ...(tool.isConcurrencySafe === undefined ? {} : { isConcurrencySafe: tool.isConcurrencySafe }),
      validate: (args) => {
        const violations = validateJsonSchemaValue(parameters, args, '')
        if (violations.length > 0) throw new ToolArgsError(violations)
      },
      dispose: () => {
        if (completion !== undefined) return completion
        completion = Promise.resolve().then(async () => {
          await Promise.allSettled(entry.pending)
          this.registrations.delete(entry)
        })
        unregister()
        entry.controller.abort()
        return completion
      },
    }
    const unregister = this.tools.register(schema.name, entry, scope)
    this.registrations.add(entry)
    return entry.dispose
  }

  /**
   * Return detached visible schemas in ancestor registration order with nearest overrides.
   * @param scope - consuming Agent scope, defaulting to the Provider scope.
   * @returns schemas currently visible to the consuming application.
   */
  schemas(scope?: NativeScope): ToolSchema[] {
    return [...this.visible(scope).values()].map(entry => structuredClone(entry.schema))
  }

  private acceptsModelName(name: string): boolean {
    return this.modelMode === 'both' || (this.modelMode === 'ptc' ? name === 'run_code' : name !== 'run_code')
  }

  /**
   * Select model-callable schemas without changing program capability visibility.
   * @param scope - consuming Agent scope, defaulting to the Provider scope.
   * @returns detached schemas for the selected mode; PTC requires a visible run_code transport.
   */
  modelSchemas(scope?: NativeScope): ToolSchema[] {
    const schemas = this.schemas(scope)
    if (this.modelMode === 'ptc' && !schemas.some(schema => schema.name === 'run_code')) {
      throw new Error('native-tools: ptc mode requires a visible run_code transport')
    }
    return schemas.filter(schema => this.acceptsModelName(schema.name))
  }

  /**
   * Reject model calls outside the selected transport before approval or body execution.
   * @param call - model-requested operation and its application-owned Session attribution.
   * @returns the guarded contribution result for the application to record.
   */
  async executeModelCall(call: NativeToolExecution): Promise<NativeToolResult> {
    if (!this.acceptsModelName(call.name)) {
      throw new HarnessError(`native-tools: model tool ${call.name} is unavailable in ${this.modelMode} mode`, 'TOOL_DENIED')
    }
    return this.execute(call)
  }

  /**
   * Project the same visible registrations for program bindings; every tool must declare a canonical output.
   * @param scope - consuming Agent scope, defaulting to the Provider scope.
   * @returns detached argument and output schemas in visible registration order.
   */
  sdkSchemas(scope?: NativeScope): ToolSdkSchema[] {
    return [...this.visible(scope).values()].map((entry) => {
      if (entry.outputSchema === undefined) throw new Error(`native-tools: tool ${entry.schema.name} has no canonical output schema`)
      return { ...structuredClone(entry.schema), output: structuredClone(entry.outputSchema) }
    })
  }

  /**
   * Validate scoped arguments before approval and execution; model callers use executeModelCall for transport admission.
   * @param call - program or host operation, Session, and cancellation signal.
   * @returns the contribution result for the application to record.
   */
  async execute(call: NativeToolExecution): Promise<NativeToolResult> {
    return (await this.prepare(call)).execute()
  }

  /**
   * Classify pending work using the same visible contribution as execution; failures remain exclusive.
   * @param call - pending invocation identity, scope and parsed arguments.
   * @returns parallel only for a valid visible call whose captured classifier permits overlap.
   */
  executionMode(call: Pick<NativeToolExecution, 'agent' | 'name' | 'arguments'>): 'parallel' | 'exclusive' {
    if (this.agents.get(call.agent.id) !== call.agent) return 'exclusive'
    const entry = this.visible(call.agent.scope).get(call.name)
    if (entry?.isConcurrencySafe === undefined) return 'exclusive'
    try {
      const args = snapshotJsonValue(call.arguments)
      if (args === undefined) return 'exclusive'
      entry.validate(args)
      return entry.isConcurrencySafe(deepFreeze(args)) ? 'parallel' : 'exclusive'
    } catch {
      // Invalid arguments or a failed classifier cannot authorize body overlap.
      return 'exclusive'
    }
  }

  /**
   * Select the scoped contribution, validate arguments and complete approval before dispatch.
   * @param call - invocation whose Agent, Session and cancellation remain fixed through dispatch.
   * @returns a single-use body; callers must execute or abandon it, and cancellation releases undispatched work.
   */
  async prepare(call: NativeToolExecution): Promise<NativePreparedToolInvocation> {
    if (this.agents.get(call.agent.id) !== call.agent) throw new Error(`native-tools: Agent "${call.agent.id}" is not registered`)
    const entry = this.visible(call.agent.scope).get(call.name)
    if (entry === undefined) throw new Error(`native-tools: unknown tool ${call.name}`)
    const argumentsValue = snapshotJsonValue(call.arguments)
    if (argumentsValue === undefined) throw new ToolArgsError(['arguments must be lossless JSON'])
    const policies = [...this.resultPolicies.visible(call.agent.scope).values()]
    const signal = AbortSignal.any([call.signal, entry.controller.signal, ...policies.map(policy => policy.controller.signal)])
    const authority = call.approvalAuthority
    const approvalRequest = (approval: NativeToolApproval, requestedSignal: AbortSignal): NativeToolApprovalRequest => ({
      agent: call.agent, session: call.session, callId: call.callId, toolName: call.name,
      ...approval.reason === undefined ? {} : { reason: approval.reason },
      signal: AbortSignal.any([signal, requestedSignal]),
    })
    const admitted: NativeToolExecution = {
      ...call, arguments: deepFreeze(argumentsValue), signal,
      ...authority === undefined ? {} : {
        authorize: (approval, requestedSignal) => authority.authorize(approvalRequest(approval, requestedSignal)),
        requestApproval: (approval, requestedSignal) => authority.request(approvalRequest(approval, requestedSignal)),
      },
    }
    const completion = Promise.withResolvers<void>()
    entry.pending.add(completion.promise)
    for (const policy of policies) policy.pending.add(completion.promise)
    let phase: 'preparing' | 'ready' | 'running' | 'closed' = 'preparing'
    const release = (): void => {
      phase = 'closed'
      signal.removeEventListener('abort', cancelled)
      entry.pending.delete(completion.promise)
      for (const policy of policies) policy.pending.delete(completion.promise)
      completion.resolve()
    }
    const cancelled = (): void => { if (phase === 'ready') release() }
    signal.addEventListener('abort', cancelled, { once: true })
    try {
      signal.throwIfAborted()
      entry.validate(admitted.arguments)
      this.assertGuards(admitted)
      if (entry.tool.approval !== undefined) {
        if (admitted.authorize === undefined) throw new Error(`native-tools: tool ${call.name} requires an approval authority`)
        await admitted.authorize(entry.tool.approval, signal)
        signal.throwIfAborted()
      }
      signal.throwIfAborted()
      this.assertVisible(admitted, entry)
      this.assertGuards(admitted)
      phase = 'ready'
      const invocation = { execution: admitted, settled: false }
      this.resultInvocations.set(call, invocation)
      this.resultInvocations.set(admitted, invocation)
      const agents = this.agents
      const assertGuards = (): void => { this.assertGuards(admitted) }
      const assertVisible = (): void => { this.assertVisible(admitted, entry) }
      const processResult = (): Promise<NativeToolResult> => this.processResult(admitted, entry, policies)
      return {
        async execute() {
          signal.throwIfAborted()
          if (phase !== 'ready') throw new Error('native-tools: prepared invocation is already dispatched or abandoned')
          phase = 'running'
          try {
            if (agents.get(call.agent.id) !== call.agent) throw new Error(`native-tools: Agent "${call.agent.id}" is not registered`)
            assertVisible()
            assertGuards()
            return await processResult()
          }
          finally { invocation.settled = true; release() }
        },
        abandon() { if (phase === 'ready') release() },
      }
    } catch (error: unknown) {
      release()
      throw error
    }
  }

  /**
   * Close all registration admission and cancel pending calls when the Provider leaves its scope.
   * @returns shared completion after every admitted call settles; registration remains closed.
   */
  clear(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    const completion = Promise.withResolvers<void>()
    this.disposal = completion.promise
    this.guards.clear()
    this.resultObservers.clear()
    this.restrictions.clear()
    this.ptcLogController.abort()
    const completions = [
      ...[...this.registrations].map(entry => entry.dispose()),
      ...[...this.policyRegistrations].map(entry => entry.dispose()),
      ...[...this.ptcLogPolicyRegistrations].map(entry => entry.dispose()),
      ...this.ptcLogPending,
    ]
    void Promise.all(completions).then(() => { completion.resolve() }, (error: unknown) => { completion.reject(error) })
    return completion.promise
  }
}

export { plugin } from './native.ts'
