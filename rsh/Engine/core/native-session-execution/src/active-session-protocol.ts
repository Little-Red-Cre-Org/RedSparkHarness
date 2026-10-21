/** Active Session owner and lifecycle Consumer types, without execution Providers. */
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent/definition'
import type { InboxTarget } from '@deepseek-ai/dsh-native-agent/inbox'
import type { MessageId, UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { Session, SessionEvent, SessionId, TurnEndCancelCause, TurnEndReason } from '@deepseek-ai/dsh-session/native'

/** Live Program-owned interaction recipient and the root Session displaying its requests. */
export interface NativeProgramInteractionOwner {
  readonly agent: NativeAgent
  readonly session: Session
  readonly displayRootAgent: NativeAgent
  readonly displayRootSessionId: SessionId
}

/** Candidate input and exact Program ownership retained across asynchronous admission hooks. */
export interface NativeStepAdmissionContext {
  readonly owner: NativeActiveSessionOwner
  readonly turn: number
  readonly step: number
  readonly candidates: readonly UserMessage[]
  readonly signal: AbortSignal
  /** Register a synchronous final check after preparation; it returns admitted inputs to cancel before commit. */
  readonly registerCommitCheck: (check: NativeStepAdmissionCommitCheck) => void
}

/**
 * Synchronously identify admitted inputs invalidated during asynchronous step preparation.
 * @returns Captured admitted input ids that the Program must cancel before committing the step.
 */
export type NativeStepAdmissionCommitCheck = () => readonly MessageId[]

/** Inputs selected from the unchanged captured candidates, or ids rejected without a model request. */
export type NativeStepAdmissionDecision =
  | { readonly kind: 'enter'; readonly messages: readonly UserMessage[] }
  | { readonly kind: 'reject'; readonly discard: readonly MessageId[] }

/** Ordered admission hook; delegate with next() and recheck owned state after it settles. */
export type NativeStepAdmissionHook = (
  context: NativeStepAdmissionContext,
  next: () => Promise<NativeStepAdmissionDecision>,
) => Promise<NativeStepAdmissionDecision>

/** Program-owned idle access for the exact live root Agent, independent of a retained writer. */
export interface NativeRootSessionOperations {
  readonly agent: NativeAgent
  readonly sessionId: SessionId
  /** Agent and Program lifetime; cancellation invalidates future idle admission. */
  readonly signal: AbortSignal
  /**
   * Interrupt the exact retained root's current turn and await its durable settlement; accepted inbox messages remain queued.
   * @param reason - recorded cancellation cause for the interrupted turn.
   * @returns completion after the active turn's cleanup and durable closer.
   * @throws when the captured root Agent is no longer live.
   */
  interruptTurn(reason: TurnEndCancelCause): Promise<void>
  /**
   * Claim idle maintenance and temporarily restore the Program's sole Session writer.
   * The callback must not await disposal of its own Agent or Program execution.
   * @param operation - complete idle transaction using the exact active owner.
   * @param signal - caller cancellation, combined with the captured root lifetime.
   * @returns transaction result after the writer and maintenance claim have released.
   * @throws Synchronously when busy, disposed, or no longer the exact registered root.
   */
  runIdle<T>(operation: (owner: NativeActiveSessionOwner, signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T>
}

/** Exact live Session access backed by the Program's sole retained writer and durable inbox. */
export interface NativeActiveSessionOwner {
  readonly agent: NativeAgent
  readonly session: Session
  /** Current Program invocation; a historical child resumed through a root entry remains root. */
  readonly invocation: 'root' | 'delegated'
  /** Persisted Program admission origin for a scheduled root, including after restore; absent for other owners. */
  readonly rootOrigin?: 'scheduled' | undefined
  /** Captured live-root turn interruption and maintenance handle; delegated invocations never provide one. */
  readonly rootOperations?: NativeRootSessionOperations | undefined
  readonly inheritedEventCount: number
  /** False after admission closes; closed appends and flushes fail loudly. */
  readonly writerAvailable: boolean
  /** Close new input and lifecycle admission before detach observers drain; terminal writes remain available. */
  beginDetach?(): void
  readonly append: Session['append']
  /** Admit related facts together through the same retained writer; flush supplies durability. */
  readonly appendBatch: Session['appendBatch']
  /**
   * Persist tracked appends and flush the selected writer.
   * @returns completion of the durability barrier.
   */
  flush(): Promise<void>
  /**
   * Read validated durable history through the same writer after flushing tracked appends.
   * @param options - bounded prefix length and caller cancellation; omitted reads complete history.
   * @returns accepted Session events through the requested prefix bound.
   */
  readEvents(options?: { readonly maxEvents?: number; readonly signal?: AbortSignal }): Promise<readonly SessionEvent[]>
  /**
   * Read one detached durable pending list.
   * @param target - inbox destination.
   * @returns captured pending messages.
   */
  messages(target: InboxTarget): readonly UserMessage[]
  /**
   * Durably enqueue and optionally wake the existing Program driver.
   * @param message - identified validated input.
   * @param target - pending destination.
   * @param wake - request ordinary turn driving after durable admission.
   * @param signal - cancellation before the append; accepted input is not retracted later.
   * @returns the durably accepted input id.
   */
  enqueue(message: UserMessage, target: InboxTarget, wake: boolean, signal: AbortSignal): Promise<MessageId>
  /**
   * Cancel exact pending inputs, preserving concurrent admissions.
   * @param ids - captured pending message identities.
   * @param target - pending destination.
   * @param signal - cancellation before committing the removal.
   * @returns completion after cancellation splices have been persisted.
   */
  remove(ids: readonly MessageId[], target: InboxTarget, signal: AbortSignal): Promise<void>
  /**
   * Retain this root or child residency without acquiring another writer or execution owner.
   * The enclosing main turn waits for this retention to release.
   * @returns exact idempotent release; Program cancellation overrides retention and still drains work.
   */
  retain(): () => void
  /**
   * Retain this exact writer for an owned background task without extending main-turn settlement.
   * Owner cancellation still closes admission and drains its Consumers before the writer closes.
   * @returns exact idempotent release.
   */
  retainBackground(): () => void
  /**
   * Observe only backend-accepted events; observers must not synchronously await new persistence.
   * @param observer - synchronous durable-event observer.
   * @returns exact listener removal.
   */
  onEvent(observer: (event: SessionEvent) => void): () => void
  /**
   * Observe durable turn settlement before natural residency release.
   * @param observer - asynchronous idle work; inspect writerAvailable before writes.
   * @returns listener removal after accepted callbacks have drained.
   */
  onIdle(observer: (reason: TurnEndReason) => Promise<void>): () => Promise<void>
  /**
   * Contribute step admission while the exact owner is live.
   * @param hook - ordered waterfall hook over detached durable candidates.
   * @param order - finite ascending priority; equal priorities preserve registration order.
   * @returns removal after accepted hook invocations have drained.
   */
  beforeStep(hook: NativeStepAdmissionHook, order: number): () => Promise<void>
}

/** Definition used by lifecycle Consumers outside model-call initiator attribution. */
export interface NativeActiveSessionOperations {
  /**
   * Publish the Program's exact active owner.
   * @param owner - sole writer and inbox authority for the registered Agent.
   * @returns release after attach observers settle; release closes lookup and drains detach observers.
   */
  register(owner: NativeActiveSessionOwner): Promise<() => Promise<void>>
  /**
   * Read ownership only for the exact registered Agent and Session instances.
   * @param agent - original live Agent.
   * @param session - original live Session.
   * @returns active owner, or undefined after release; replaced identities are rejected.
   */
  owner(agent: NativeAgent, session: Session): NativeActiveSessionOwner | undefined
  /**
   * Enumerate exact current writable owners without adopting their Sessions.
   * @returns detached owner references filtered by the same live Agent, release and writer checks as `owner`.
   */
  owners(): readonly NativeActiveSessionOwner[]
  /**
   * Observe future active-owner registrations without adopting existing ownership.
   * @param observer - lifecycle Consumer called before initial model admission.
   * @returns removal after accepted observer callbacks drain.
   */
  onAttached(observer: (owner: NativeActiveSessionOwner) => Promise<void>): () => Promise<void>
  /**
   * Observe release after lookup admission closes, before writer teardown.
   * @param observer - exact-owner lifecycle cleanup.
   * The observer must not await release of its own owner or disposal of this registry; that cleanup is waiting for the observer.
   * @returns removal after accepted observer callbacks drain.
   */
  onDetached(observer: (owner: NativeActiveSessionOwner) => Promise<void>): () => Promise<void>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    activeSessions: NativeActiveSessionOperations
  }
}
