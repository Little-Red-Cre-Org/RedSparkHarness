/** Public access to one selected Program's active Session and step admission. */
import { isDeepStrictEqual } from 'node:util'
import type { InboxTarget, NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { MessageId, UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { Session, SessionEvent, SessionId, TurnEndReason } from '@deepseek-ai/dsh-session/native'

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
}

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
  /** Captured live-root maintenance handle; delegated invocations never provide one. */
  readonly rootOperations?: NativeRootSessionOperations | undefined
  readonly inheritedEventCount: number
  /** False after admission closes; closed appends and flushes fail loudly. */
  readonly writerAvailable: boolean
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
   * @returns exact idempotent release; Program cancellation overrides retention and still drains work.
   */
  retain(): () => void
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
   * @returns removal after accepted observer callbacks drain.
   */
  onDetached(observer: (owner: NativeActiveSessionOwner) => Promise<void>): () => Promise<void>
}

interface HookEntry {
  readonly hook: NativeStepAdmissionHook
  readonly order: number
  readonly sequence: number
  readonly pending: Set<Promise<NativeStepAdmissionDecision>>
}

/** Per-owner ordered hooks; the selected Program alone persists claims and discarded inputs. */
export class NativeStepAdmission {
  private readonly hooks = new Set<HookEntry>()
  private readonly pending = new Set<Promise<NativeStepAdmissionDecision>>()
  private sequence = 0
  private closing = false
  private disposal: Promise<void> | undefined

  /**
   * Register one contribution and retain each accepted invocation until it settles.
   * @param hook - waterfall operation; returning without next() intentionally short-circuits.
   * @param order - finite ascending priority.
   * @returns exact removal and drain of accepted hook invocations.
   */
  register(hook: NativeStepAdmissionHook, order: number): () => Promise<void> {
    if (this.closing) throw new Error('native-step-admission: owner is closing')
    if (!Number.isFinite(order)) throw new Error('native-step-admission: order must be finite')
    const entry: HookEntry = { hook, order, sequence: this.sequence++, pending: new Set() }
    this.hooks.add(entry)
    let release: Promise<void> | undefined
    return () => {
      this.hooks.delete(entry)
      return release ??= this.drain([...entry.pending])
    }
  }

  /**
   * Resolve an unchanged candidate subset without claiming or writing any input.
   * @param context - captured input and exact owner supplied by the Program.
   * @returns validated decision after cancellation and owner-liveness checks.
   */
  async decide(context: NativeStepAdmissionContext): Promise<NativeStepAdmissionDecision> {
    this.assertAvailable(context.owner)
    context.signal.throwIfAborted()
    const captured = structuredClone(context.candidates)
    const entries = [...this.hooks].sort((left, right) => left.order - right.order || left.sequence - right.sequence)
    const invoke = (index: number): Promise<NativeStepAdmissionDecision> => {
      const entry = entries[index]
      if (entry === undefined) return Promise.resolve({ kind: 'enter', messages: structuredClone(captured) })
      if (!this.hooks.has(entry)) return invoke(index + 1)
      let delegated = false
      const operation = Promise.resolve().then(() => entry.hook({ ...context, candidates: structuredClone(captured) }, () => {
        if (delegated) throw new Error('native-step-admission: next called more than once')
        delegated = true
        return invoke(index + 1)
      }))
      entry.pending.add(operation)
      this.pending.add(operation)
      const settled = (): void => { entry.pending.delete(operation); this.pending.delete(operation) }
      void operation.then(settled, settled)
      return operation
    }
    const decision = await invoke(0)
    context.signal.throwIfAborted()
    this.assertAvailable(context.owner)
    const selected = decision.kind === 'enter' ? decision.messages.map(message => message.id) : decision.discard
    if (new Set(selected).size !== selected.length || selected.some(id => !captured.some(message => message.id === id))) {
      throw new Error('native-step-admission: decision must select unique captured input ids')
    }
    if (decision.kind === 'enter' && decision.messages.some(message => !isDeepStrictEqual(
      captured.find(candidate => candidate.id === message.id), message))) {
      throw new Error('native-step-admission: admitted messages must preserve durable input')
    }
    return structuredClone(decision)
  }

  /**
 * Close admission and await all accepted hooks.
 * @returns the memoized drain promise.
 */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.closing = true
    const pending = [...this.pending]
    this.hooks.clear()
    return this.disposal = this.drain(pending)
  }

  private assertAvailable(owner: NativeActiveSessionOwner): void {
    if (this.closing || !owner.writerAvailable) throw new Error('native-step-admission: owner is closing')
  }

  private async drain(pending: readonly Promise<NativeStepAdmissionDecision>[]): Promise<void> {
    await Promise.allSettled(pending)
  }
}
