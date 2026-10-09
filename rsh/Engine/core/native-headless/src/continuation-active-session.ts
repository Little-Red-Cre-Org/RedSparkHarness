/** Active Session access and admission hooks backed by the Program's exclusive resident writer. */
import type { NativeAgent, InboxTarget } from '@deepseek-ai/dsh-native-agent'
import type { MessageId, UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session/native'
import { NativeStepAdmission, type NativeActiveSessionOwner, type NativeStepAdmissionHook, type NativeRootSessionOperations } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeContinuationSession } from './continuation-session.ts'

interface IdleListener {
  readonly observer: (reason: TurnEndReason) => Promise<void>
  readonly pending: Set<Promise<void>>
}

/** Selected Program callbacks preserve its existing activation and admission ownership. */
export interface NativeActiveSessionDriver {
  /** Exact Agent and Program lifetimes; ordinary turn cancellation does not end retained ownership. */
  readonly signal: AbortSignal
  /** Captured exact live-root idle access; delegated drivers omit it. */
  readonly rootOperations?: NativeRootSessionOperations | undefined
  /** Retain the existing root or child epoch. @returns exact idempotent retention release. */
  retain(): () => void
  /** Retain background work without delaying a root's foreground result. @returns exact release. */
  retainBackground(): () => void
  /**
   * Admit through the Program's sole inbox and optionally wake its existing driver.
   * @param message - identified input.
   * @param target - pending destination.
   * @param wake - whether input should wake the selected driver.
   * @param signal - admission cancellation.
   * @returns durable accepted identity.
   */
  enqueue(message: UserMessage, target: InboxTarget, wake: boolean, signal: AbortSignal): Promise<MessageId>
}

/** One active registry owner with drained hooks and no independent queue, writer or model loop. */
export class NativeProgramActiveSession implements NativeActiveSessionOwner {
  readonly admission = new NativeStepAdmission()
  private readonly idle = new Set<IdleListener>()
  private admissionOpen = true
  private closing: Promise<void> | undefined

  /**
   * @param agent - exact registered Agent.
   * @param owner - Program's exclusive Session writer.
   * @param invocation - explicit root or delegated Program entry.
   * @param rootOrigin - durable Program classification for a scheduled root.
   * @param driver - selected residency and admission callbacks.
   */
  constructor(readonly agent: NativeAgent, private readonly owner: NativeContinuationSession,
    readonly invocation: 'root' | 'delegated', readonly rootOrigin: 'scheduled' | undefined,
    private readonly driver: NativeActiveSessionDriver) {}

  /** @inheritdoc */
  get rootOperations(): NativeRootSessionOperations | undefined { return this.driver.rootOperations }
  /** @inheritdoc */
  get session() { return this.owner.session }
  /** @inheritdoc */
  get inheritedEventCount() { return this.owner.writer.inheritedEventCount }
  /** @inheritdoc */
  get writerAvailable(): boolean { return this.closing === undefined && !this.owner.isClosing }
  /** @inheritdoc */
  beginDetach(): void { this.admissionOpen = false }
  /** @inheritdoc */
  readonly append: NativeActiveSessionOwner['append'] = (type, data, ...options) => {
    this.assertAvailable()
    const event = this.session.append(type, data, ...options)
    this.owner.track(event as SessionEvent)
    return event
  }
  /** @inheritdoc */
  flush(): Promise<void> { this.assertAvailable(); return this.owner.persist() }
  /** @inheritdoc */
  readonly appendBatch: NativeActiveSessionOwner['appendBatch'] = (inputs) => {
    this.assertAvailable()
    const events = this.session.appendBatch(inputs)
    for (const event of events) this.owner.track(event)
    return events
  }
  /** @inheritdoc */
  async readEvents(options?: { readonly maxEvents?: number; readonly signal?: AbortSignal }): Promise<readonly SessionEvent[]> {
    this.assertAvailable()
    const signal = options?.signal === undefined ? this.driver.signal : AbortSignal.any([options.signal, this.driver.signal])
    signal.throwIfAborted()
    const history = await this.owner.read(signal, options?.maxEvents)
    signal.throwIfAborted()
    this.assertAvailable()
    return history.events
  }
  /** @inheritdoc */
  messages(target: InboxTarget): readonly UserMessage[] { this.assertAvailable(); return this.owner.messages(target) }
  /** @inheritdoc */
  enqueue(message: UserMessage, target: InboxTarget, wake: boolean, signal: AbortSignal): Promise<MessageId> {
    this.assertAdmitting()
    return this.driver.enqueue(message, target, wake, signal)
  }
  /** @inheritdoc */
  remove(ids: readonly MessageId[], target: InboxTarget, signal: AbortSignal): Promise<void> {
    this.assertAvailable()
    const selected = new Set(ids)
    return this.owner.remove(this.owner.messages(target).filter(message => selected.has(message.id)).map(message => message.id), 'canceled', signal)
  }
  /** @inheritdoc */
  retain(): () => void { this.assertAdmitting(); return this.driver.retain() }
  /** @inheritdoc */
  retainBackground(): () => void {
    this.assertAdmitting()
    if (this.invocation !== 'root') throw new Error('native-active-session: background retention requires a root owner')
    return this.driver.retainBackground()
  }
  /** @inheritdoc */
  onEvent(observer: (event: SessionEvent) => void): () => void { this.assertAdmitting(); return this.owner.onEvent(observer) }
  /** @inheritdoc */
  onIdle(observer: (reason: TurnEndReason) => Promise<void>): () => Promise<void> {
    this.assertAdmitting()
    const entry: IdleListener = { observer, pending: new Set() }
    this.idle.add(entry)
    let disposal: Promise<void> | undefined
    return () => {
      this.idle.delete(entry)
      return disposal ??= Promise.allSettled([...entry.pending]).then(() => undefined)
    }
  }
  /** @inheritdoc */
  beforeStep(hook: NativeStepAdmissionHook, order: number): () => Promise<void> {
    this.assertAdmitting()
    return this.admission.register(hook, order)
  }

  /**
   * Notify idle Consumers after the turn's terminal checkpoint and before natural release.
   * @param reason - persisted terminal reason.
   * @returns completion of all admitted idle callbacks, including independent failures.
   */
  async settled(reason: TurnEndReason): Promise<void> {
    const pending = [...this.idle].map((entry) => {
      const operation = Promise.resolve().then(() => entry.observer(reason))
      entry.pending.add(operation)
      void operation.then(() => { entry.pending.delete(operation) }, () => { entry.pending.delete(operation) })
      return operation
    })
    const outcomes = await Promise.allSettled(pending)
    const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : [])
    if (failures.length !== 0) throw new AggregateError(failures, 'native-active-session: idle callbacks failed')
  }

  /** Close hook admission and await accepted callbacks. @returns the memoized quiescent hook release. */
  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.beginDetach()
    const pending = [...this.idle].flatMap(entry => [...entry.pending])
    this.idle.clear()
    const completion = Promise.withResolvers<void>()
    this.closing = completion.promise
    void Promise.allSettled([this.admission.dispose(), ...pending]).then((outcomes) => {
      const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : [])
      if (failures.length === 0) completion.resolve()
      else completion.reject(new AggregateError(failures, 'native-active-session: hook cleanup failed'))
    }, completion.reject)
    return completion.promise
  }

  private assertAvailable(): void { if (!this.writerAvailable) throw new Error('native-active-session: writer admission is closed') }
  private assertAdmitting(): void {
    this.assertAvailable()
    if (!this.admissionOpen) throw new Error('native-active-session: owner is detaching')
  }
}
