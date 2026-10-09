/** Native routing from active Session ownership to the selected shared turn executor. */
import { NativeAgentId, type NativeAgent, type NativeAgentRegistry } from '@deepseek-ai/dsh-native-agent'
import type { Disposer, NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { ReasoningEffortId, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session/native'
import type { NativeSessionContinuations } from './continuation.ts'
import { NativeActiveSessionRegistry } from './active-session-registry.ts'

export type * from './continuation.ts'
export type * from './root-execution.ts'
export * from './active-session.ts'
export { NativeActiveSessionRegistry } from './active-session-registry.ts'

/** Explicit workspace, model route, prompt and turn budgets resolved by a Program. */
export interface NativeSessionConfiguration {
  readonly cwd: string
  readonly provider: string
  readonly model: string
  readonly systemPrompt: string
  readonly maxSteps: number
  /** Explicit Program-owned builtin capability selection; omission retains that Program's resolved selection. */
  readonly builtinTools?: boolean
  readonly reasoningEffort?: ReasoningEffortId
  readonly maxTokens?: number
}

/** Detached capabilities granted by the exact parent Session to an external child. */
export interface NativeSessionDelegationAuthority {
  /** Tools the parent model can actually invoke in its active scope. */
  readonly toolNames: readonly string[]
  /** Names supplied by Native Headless itself, kept separate from same-named Plugin tools. */
  readonly builtinToolNames: readonly string[]
  /** Resolved filesystem policy, when this parent composition has one. */
  readonly sandboxPolicy?: {
    readonly mode: 'read-only' | 'workspace-write' | 'danger-full-access'
    readonly workspaceRoot: string
    readonly sessionId?: SessionId
  }
  /** Whether the parent composition owns tool approvals that this child cannot currently request. */
  readonly approvalRequired: boolean
}

/** Bound resource ownership for child contributions before model input selection. */
export interface NativeDelegationSetup {
  readonly agent: NativeAgent
  /**
   * Own a child contribution through startup rollback and execution settlement.
   * @param dispose - release operation acquired during preparation.
   * @returns exact idempotent, awaitable release.
   */
  readonly own: (dispose: Disposer) => () => Promise<void>
}

/** Fresh child turn requested through the active parent's execution owner. */
export interface NativeSessionDelegation {
  readonly id: SessionId
  readonly config: NativeSessionConfiguration
  readonly maxDepth: number
  /** Turn-owned by default; agent-owned work survives ordinary parent turn closure. */
  readonly lifetime?: 'turn' | 'agent'
  readonly message?: UserMessage
  /** Install child contributions before prompt rendering and tool-schema selection; the executor awaits rollback on failure. */
  readonly prepare?: (setup: NativeDelegationSetup) => void | Promise<void>
  /** Append child-owned initial facts inside the first turn, before its first model request. */
  readonly initialize?: (append: Session['append']) => void
  /** Observe the registered child only after its initial turn facts have been persisted. */
  readonly onReady?: (agent: NativeAgent) => void
  /** Observe accepted model chunks. */
  readonly onChunk?: (chunk: StreamChunk) => void
  /** Observe events only after their backend append succeeds. */
  readonly onEvent?: (event: SessionEvent) => void
}

/** Turn outcome after the execution owner has closed its Session writer. */
export interface NativeSessionTurnResult {
  readonly exitCode: number
  readonly answer?: string
}

/** The active Program supplies execution without transferring Agent or Session ownership. */
export interface NativeSessionExecutionOwner {
  readonly agent: NativeAgent
  readonly session: Session
  readonly config: NativeSessionConfiguration
  /** Exact tool and sandbox authority captured from this live parent Agent. */
  readonly delegationAuthority?: NativeSessionDelegationAuthority
  readonly continuations?: NativeSessionContinuations
  /**
   * Execute the resolved child with the existing turn driver.
   * @param request - fresh child identity and explicit composition.
   * @param signal - combined caller and contribution cancellation.
   * @returns a result after child execution, writer closure and Agent release.
   */
  delegate(request: NativeSessionDelegation, signal: AbortSignal): Promise<NativeSessionTurnResult>
}

/** Definition consumed by active Programs and delegation modules. */
export interface NativeSessionExecutionOperations {
  /**
   * Publish the exact active Agent and Session until the returned release completes.
   * @param owner - Program-owned identity, configuration and existing execution operation.
   * @returns an idempotent release that closes turn admission and drains turn-owned children; Agent-owned work remains registered.
   */
  register(owner: NativeSessionExecutionOwner): () => Promise<void>
  /**
   * Read the resolved configuration of the exact active initiating parent.
   * @param agent - original registered parent Agent.
   * @param session - original active parent Session.
   * @returns an immutable detached configuration snapshot.
   */
  configuration(agent: NativeAgent, session: Session): NativeSessionConfiguration
  /** Read detached capabilities from the exact active initiating parent. */
  delegationAuthority(agent: NativeAgent, session: Session): NativeSessionDelegationAuthority | undefined
  /**
   * Select continuation operations from the exact active execution owner.
   * @param agent - original registered parent Agent.
   * @param session - original active parent Session.
   * @returns the selected owner's continuation service; throws when unsupported.
   */
  continuations?(agent: NativeAgent, session: Session): NativeSessionContinuations
  /**
   * Delegate through the exact active initiating parent's selected executor.
   * @param agent - original registered parent Agent.
   * @param session - original active parent Session.
   * @param request - fully resolved child composition and identity.
   * @param signal - caller-owned cancellation; Agent-owned work should use its background owner signal.
   * @returns the executor's settled result after child resource release.
   */
  delegate(agent: NativeAgent, session: Session, request: NativeSessionDelegation, signal: AbortSignal): Promise<NativeSessionTurnResult>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    sessionExecution: NativeSessionExecutionOperations
  }
}

interface Entry {
  readonly owner: NativeSessionExecutionOwner
  readonly config: NativeSessionConfiguration
  readonly delegationAuthority?: NativeSessionDelegationAuthority
  readonly pending: Map<AbortController, Promise<undefined>>
  releaseAgent: () => void
  release: Promise<void> | undefined
}

interface BackgroundOwner {
  readonly agent: NativeAgent
  readonly pending: Map<AbortController, Promise<undefined>>
  releaseAgent: () => void
  release: Promise<void> | undefined
}

/** Routes delegation and drains its contributions without owning a second turn loop or writer. */
export class NativeSessionExecutionRegistry implements NativeSessionExecutionOperations {
  private readonly entries = new Map<NativeAgent, Entry>()
  private readonly background = new Map<NativeAgent, BackgroundOwner>()
  private closing = false
  private disposal: Promise<void> | undefined

  /** @param agents - selected authority for exact live Agent identities and initiator attribution. */
  constructor(private readonly agents: NativeAgentRegistry) {}

  /** @inheritdoc */
  register(owner: NativeSessionExecutionOwner): () => Promise<void> {
    if (this.closing) throw new Error('native-session-execution: registry is disposed')
    if (this.agents.get(owner.agent.id) !== owner.agent || owner.agent.id !== NativeAgentId(owner.session.id)) {
      throw new Error('native-session-execution: owner requires the exact registered Session Agent')
    }
    if (this.entries.has(owner.agent)) throw new Error('native-session-execution: Agent already has an active Session owner')
    const delegationAuthority = owner.delegationAuthority === undefined ? undefined : Object.freeze({
      toolNames: Object.freeze([...owner.delegationAuthority.toolNames]),
      builtinToolNames: Object.freeze([...owner.delegationAuthority.builtinToolNames]),
      ...(owner.delegationAuthority.sandboxPolicy === undefined ? {} : {
        sandboxPolicy: Object.freeze({ ...owner.delegationAuthority.sandboxPolicy }),
      }),
      approvalRequired: owner.delegationAuthority.approvalRequired,
    })
    const entry: Entry = { owner, config: Object.freeze({ ...owner.config }),
      ...(delegationAuthority === undefined ? {} : { delegationAuthority }), pending: new Map(),
      releaseAgent: () => {}, release: undefined }
    entry.releaseAgent = this.agents.onDispose(owner.agent, () => this.release(entry))
    this.entries.set(owner.agent, entry)
    return () => this.release(entry)
  }

  /** @inheritdoc */
  configuration(agent: NativeAgent, session: Session): NativeSessionConfiguration {
    return this.requireOwner(agent, session).config
  }

  /** @inheritdoc */
  delegationAuthority(agent: NativeAgent, session: Session): NativeSessionDelegationAuthority | undefined {
    return this.requireOwner(agent, session).delegationAuthority
  }

  /** @inheritdoc */
  continuations(agent: NativeAgent, session: Session): NativeSessionContinuations {
    const service = this.requireOwner(agent, session).owner.continuations
    if (service === undefined) throw new Error('native-session-execution: selected owner does not support continuations')
    return service
  }

  /** @inheritdoc */
  async delegate(
    agent: NativeAgent, session: Session, request: NativeSessionDelegation, signal: AbortSignal,
  ): Promise<NativeSessionTurnResult> {
    signal.throwIfAborted()
    const entry = this.requireOwner(agent, session)
    const lifetime = request.lifetime ?? 'turn'
    const background = lifetime === 'agent' ? this.backgroundOwner(agent) : undefined
    const pending = background?.pending ?? entry.pending
    const cancellation = new AbortController()
    const completed = Promise.withResolvers<undefined>()
    pending.set(cancellation, completed.promise)
    try {
      return await entry.owner.delegate(
        { ...request, lifetime, config: { ...request.config } }, AbortSignal.any([signal, cancellation.signal]),
      )
    } finally {
      pending.delete(cancellation)
      completed.resolve(undefined)
      if (background !== undefined && background.pending.size === 0 && background.release === undefined) {
        background.releaseAgent()
        this.background.delete(agent)
      }
    }
  }

  /**
   * Close admission, cancel all active child contributions and wait for executor settlement.
   * @returns the same quiescent disposal promise on repeated calls.
   */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.closing = true
    this.disposal = Promise.all([
      ...[...this.entries.values()].map(entry => this.release(entry)),
      ...[...this.background.values()].map(owner => this.releaseBackground(owner)),
    ]).then(() => {})
    return this.disposal
  }

  private backgroundOwner(agent: NativeAgent): BackgroundOwner {
    const existing = this.background.get(agent)
    if (existing !== undefined) {
      if (existing.release !== undefined) throw new Error('native-session-execution: parent Agent is releasing background work')
      return existing
    }
    const owner: BackgroundOwner = { agent, pending: new Map(), releaseAgent: () => {}, release: undefined }
    owner.releaseAgent = this.agents.onDispose(agent, () => this.releaseBackground(owner))
    this.background.set(agent, owner)
    return owner
  }

  private releaseBackground(owner: BackgroundOwner): Promise<void> {
    if (owner.release !== undefined) return owner.release
    const completed = Promise.withResolvers<void>()
    owner.release = completed.promise
    owner.releaseAgent()
    for (const cancellation of owner.pending.keys()) cancellation.abort({ kind: 'parent' })
    void Promise.all([...owner.pending.values()]).then(() => {
      if (this.background.get(owner.agent) === owner) this.background.delete(owner.agent)
      completed.resolve()
    })
    return owner.release
  }

  private requireOwner(agent: NativeAgent, session: Session): Entry {
    const entry = this.entries.get(agent)
    if (this.closing || entry === undefined || entry.release !== undefined || entry.owner.session !== session
      || this.agents.get(agent.id) !== agent || this.agents.currentInitiator() !== agent) {
      throw new Error('native-session-execution: exact active Session owner and initiating Agent are required')
    }
    return entry
  }

  private release(entry: Entry): Promise<void> {
    if (entry.release !== undefined) return entry.release
    const completed = Promise.withResolvers<undefined>()
    entry.release = completed.promise
    entry.releaseAgent()
    for (const cancellation of entry.pending.keys()) cancellation.abort({ kind: 'parent' })
    void Promise.all([...entry.pending.values()]).then(() => {
      this.entries.delete(entry.owner.agent)
      completed.resolve(undefined)
    })
    return entry.release
  }
}

/** Native Session execution Provider; Programs contribute their existing active executors. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-session-execution', targets: ['host'],
  requires: ['agents'], provides: ['sessionExecution', 'activeSessions'],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
      throw new Error('native-session-execution: configuration must be empty')
    }
    return (context) => {
      const registry = new NativeSessionExecutionRegistry(context.require('agents'))
      const active = new NativeActiveSessionRegistry(context.require('agents'))
      context.own(async () => {
        const results = await Promise.allSettled([registry.dispose(), active.dispose()])
        const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
        if (failures.length > 0) throw new AggregateError(failures, 'native-session-execution: registry disposal failed')
      })
      context.provide('sessionExecution', registry)
      context.provide('activeSessions', active)
    }
  },
}
