/** Program-owned resident Session storage and durable pending-message projection. */
import { interruptedTurnClosers, Session, type SessionEvent, type SessionHeader, type TurnEndReason } from '@deepseek-ai/dsh-session/native'
import type { MessageId, UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { InboxTarget } from '@deepseek-ai/dsh-native-agent'
import type { NativeSessionPersistenceOperations } from '@deepseek-ai/dsh-session-persistence/native'

type Writer = Awaited<ReturnType<NativeSessionPersistenceOperations['open']>>
type AppendObserver = (event: SessionEvent) => void

/** One exclusive writer retained across a resident Agent's turns and inbox admissions. */
export class NativeContinuationSession {
  readonly pending: SessionEvent[] = []
  private readonly inbox: Record<InboxTarget, readonly UserMessage[]> = { 'next-turn': [], 'next-step': [] }
  private readonly tracked = new Set<AppendObserver>()
  private readonly accepted = new Set<AppendObserver>()
  private persistence: Promise<void> = Promise.resolve()
  private failure: { readonly error: unknown } | undefined
  private closing: Promise<void> | undefined

  private constructor(readonly session: Session, readonly writer: Writer, readonly initialEvents: readonly SessionEvent[]) {
    for (const event of initialEvents) this.foldInbox(event)
  }

  /**
   * Adopt a Program-owned Session and writer without acquiring another handle.
   * @param session - restored or freshly created Session already owned by the Program.
   * @param writer - its exact exclusive writer.
   * @param events - complete current prefix, including events awaiting initial persistence.
   * @param pending - exact unpersisted tail already present in that prefix.
   * @returns an owner using the same Session, writer and contiguous pending batch.
   */
  static adopt(session: Session, writer: Writer, events: readonly SessionEvent[],
    pending: readonly SessionEvent[]): NativeContinuationSession {
    const owner = new NativeContinuationSession(session, writer, events)
    owner.pending.push(...pending)
    return owner
  }

  /**
   * Create one fresh resident Session without starting a model loop.
   * @param storage - selected single-writer backend.
   * @param header - validated child identity and lineage.
   * @param signal - cancellation before write ownership is acquired.
   * @returns the Program-owned resident writer and pending-message projection.
   */
  static async create(storage: NativeSessionPersistenceOperations, header: SessionHeader,
    signal: AbortSignal): Promise<NativeContinuationSession> {
    signal.throwIfAborted()
    const writer = await storage.create(header, { signal })
    try {
      return new NativeContinuationSession(Session.create(header.id, undefined, header), writer, [])
    } catch (error) { return closeAfterFailure(writer, error) }
  }

  /**
   * Restore pending input and repair an interrupted turn under exclusive write ownership.
   * @param storage - selected single-writer backend.
   * @param id - existing durable Session identity.
   * @param signal - creation-only cancellation, detached after restoration.
   * @returns the same durable Session's resident writer and reconstructed pending messages.
   */
  static async restore(storage: NativeSessionPersistenceOperations, id: SessionHeader['id'], signal: AbortSignal): Promise<NativeContinuationSession> {
    signal.throwIfAborted()
    const writer = await storage.open(id, 'write', { signal })
    try {
      const stored = await writer.read(0, Number.MAX_SAFE_INTEGER, { signal })
      const closers = interruptedTurnClosers(stored.events)
      const events = [...stored.events, ...closers]
      const restored: SessionEvent[] = []
      const session = Session.fromRestore(id, events, writer.header, writer.inheritedEventCount, stored.eventState,
        (event) => { restored.push(event) })
      const owner = new NativeContinuationSession(session, writer, [...events, ...restored])
      owner.pending.push(...closers, ...restored)
      await owner.persist()
      return owner
    } catch (error) { return closeAfterFailure(writer, error) }
  }

  /** Whether either durable inbox destination has unclaimed input. */
  get hasPending(): boolean { return this.inbox['next-turn'].length > 0 || this.inbox['next-step'].length > 0 }

  /** Whether this writer owner has closed admission and started draining. */
  get isClosing(): boolean { return this.closing !== undefined }

  /**
   * Read one detached pending-message list.
   * @param target - destination to inspect.
   * @returns pending messages in durable insertion order.
   */
  messages(target: InboxTarget): readonly UserMessage[] { return structuredClone(this.inbox[target]) }

  /**
   * Observe tracked appends for the selected policy projections.
   * @param observer - synchronous policy recorder; it must not append or await persistence.
   * @returns exact listener removal.
   */
  onTrack(observer: AppendObserver): () => void { this.tracked.add(observer); return () => { this.tracked.delete(observer) } }

  /**
   * Observe only backend-accepted events.
   * @param observer - selected Program event observer.
   * @returns exact listener removal.
   */
  onEvent(observer: AppendObserver): () => void { this.accepted.add(observer); return () => { this.accepted.delete(observer) } }

  /**
   * Track a Session-owner append in the single shared contiguous batch.
   * @param event - exact event already appended by this Session owner.
   */
  track(event: SessionEvent): void {
    this.assertOpen()
    this.foldInbox(event)
    this.pending.push(event)
    for (const observer of this.tracked) observer(event)
  }

  /**
   * Accept one identified input and resolve only after its durability barrier.
   * @param message - validated identified message.
   * @param target - pending destination selected by the caller.
   * @param signal - cancellation checked before committing admission; later cancellation does not retract accepted input.
   * @returns the durable accepted message identity.
   */
  async enqueue(message: UserMessage, target: InboxTarget, signal: AbortSignal): Promise<MessageId> {
    this.assertOpen()
    signal.throwIfAborted()
    if (Object.values(this.inbox).some(messages => messages.some(pending => pending.id === message.id))) {
      throw new Error('native-continuation: message is already pending')
    }
    this.track(this.session.append('agent/inbox/spliced', { target, start: this.inbox[target].length, inserted: [message] }))
    await this.persist()
    return message.id
  }

  /**
   * Claim steering and optionally one queued turn before model-visible projection.
   * @param target - next-turn also consumes one queued turn; next-step consumes only steering.
   * @returns claimed inputs after durable removal, steering before queued input.
   */
  async claim(target: InboxTarget): Promise<readonly UserMessage[]> {
    this.assertOpen()
    const messages = [...this.inbox['next-step'], ...target === 'next-turn' ? this.inbox['next-turn'].slice(0, 1) : []]
    for (const [destination, count] of [['next-step', this.inbox['next-step'].length],
      ['next-turn', target === 'next-turn' ? Math.min(1, this.inbox['next-turn'].length) : 0]] as const) {
      if (count > 0) this.track(this.session.append('agent/inbox/spliced',
        { target: destination, start: 0, removedCount: count, inserted: [] }))
    }
    await this.persist()
    return messages
  }

  /**
   * Claim or cancel exact captured input identities without removing concurrent admissions.
   * @param ids - captured pending identities to remove.
   * @param outcome - canceled attributes discarded inputs; omitted means claimed.
   * @param signal - cancellation before committing removal.
   * @returns completion of the selected writer's removal checkpoint.
   */
  async remove(ids: readonly MessageId[], outcome: 'canceled' | undefined, signal: AbortSignal): Promise<void> {
    this.assertOpen()
    signal.throwIfAborted()
    const selected = new Set(ids)
    for (const target of ['next-step', 'next-turn'] as const) {
      const messages = this.inbox[target]
      for (const [index, message] of [...messages.entries()].reverse()) {
        if (!selected.has(message.id)) continue
        this.track(this.session.append('agent/inbox/spliced', { target, start: index, removedCount: 1, inserted: [],
          ...outcome === undefined ? {} : { outcome } }))
      }
    }
    await this.persist()
  }

  /** Cancel all unclaimed accepted input with durable cancellation attribution. @returns completion of the cancellation checkpoint. */
  async discard(): Promise<void> {
    this.assertOpen()
    for (const target of ['next-step', 'next-turn'] as const) {
      const removedCount = this.inbox[target].length
      if (removedCount > 0) this.track(this.session.append('agent/inbox/spliced',
        { target, start: 0, removedCount, inserted: [], outcome: 'canceled' }))
    }
    await this.persist()
  }

  /**
   * Close an interrupted turn in both the retained Session and its writer.
   * @param reason - selected driver's terminal cancellation or error.
   * @returns completion of repair persistence before another resident turn may start.
   */
  async repair(reason: TurnEndReason): Promise<void> {
    this.assertOpen()
    const stored = await this.read()
    for (const event of interruptedTurnClosers(stored.events)) {
      switch (event.type) {
        case 'tool/result':
          this.track(this.session.append('tool/result', event.data,
            { surfaceOp: 'append', ...event.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: event.sourceEventSeqs } }))
          break
        case 'step/end': this.track(this.session.append('step/end', event.data)); break
        case 'turn/end': this.track(this.session.append('turn/end', { ...event.data, reason })); break
        default: throw new Error(`native-continuation: unsupported interrupted closer ${event.type}`)
      }
    }
    await this.persist()
  }

  /** Persist all tracked events in sequence and flush. @returns completion of the selected writer's durability barrier. */
  persist(): Promise<void> {
    const operation = this.persistence.then(async () => {
      if (this.failure !== undefined) throw this.failure.error
      const events = [...this.pending]
      if (events.length > 0) {
        await this.writer.append(events)
        this.pending.splice(0, events.length)
      }
      await this.writer.flush()
      for (const event of events) for (const observer of this.accepted) observer(event)
    })
    this.persistence = operation.catch((error: unknown) => { this.failure = { error } })
    return operation
  }

  /**
   * Read a durable prefix without racing this writer's next append or close.
   * @param signal - optional caller cancellation; omitted cleanup reads drain without turn cancellation.
   * @param maxEvents - optional exact prefix bound; omitted reads the complete current history.
   * @returns the selected writer's validated current prefix.
   */
  read(signal?: AbortSignal, maxEvents?: number): Promise<Awaited<ReturnType<Writer['read']>>> {
    this.assertOpen()
    const operation = this.persist().then(() => this.writer.read(0, maxEvents ?? Number.MAX_SAFE_INTEGER,
      signal === undefined ? {} : { signal }))
    // Read failures belong to their caller; future writes retain the persistence failure latch independently.
    this.persistence = operation.then(() => {}, () => {})
    return operation
  }

  /** Close admission, drain accepted writes and release the only writer. @returns the memoized quiescent close transaction. */
  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    const completed = Promise.withResolvers<void>()
    this.closing = completed.promise
    void this.closeInternal().then(completed.resolve, completed.reject)
    return completed.promise
  }

  private async closeInternal(): Promise<void> {
    const outcomes: unknown[] = []
    try { await this.persist() } catch (error: unknown) { outcomes.push(error) }
    try { await this.writer.close() } catch (error: unknown) { outcomes.push(error) }
    if (outcomes.length === 1) throw outcomes[0]
    if (outcomes.length > 1) throw new AggregateError(outcomes, 'native-continuation: persistence and writer close failed')
  }

  private assertOpen(): void {
    if (this.closing !== undefined) throw new Error('native-continuation: Session admission is closed')
    if (this.failure !== undefined) throw this.failure.error
  }

  private foldInbox(event: SessionEvent): void {
    if (event.type !== 'agent/inbox/spliced') return
    const splice = event.data
    const list = this.inbox[splice.target]
    const removed = splice.removedCount ?? 0
    if (!Number.isSafeInteger(splice.start) || splice.start < 0 || splice.start > list.length
      || !Number.isSafeInteger(removed) || removed < 0 || splice.start + removed > list.length) {
      throw new Error('native-continuation: invalid persisted inbox splice')
    }
    const next = list.toSpliced(splice.start, removed, ...structuredClone(splice.inserted))
    const both = splice.target === 'next-turn' ? [...next, ...this.inbox['next-step']] : [...this.inbox['next-turn'], ...next]
    if (new Set(both.map(message => message.id)).size !== both.length) throw new Error('native-continuation: duplicate pending identity')
    this.inbox[splice.target] = next
  }
}

async function closeAfterFailure(writer: Writer, error: unknown): Promise<never> {
  try { await writer.close() } catch (cleanup: unknown) {
    throw new AggregateError([error, cleanup], 'native-continuation: restoration and writer close failed')
  }
  throw error
}
