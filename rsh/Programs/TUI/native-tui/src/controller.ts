/** Terminal conversation admission, cancellation and durable observation without Ink resources. */
import type { NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import type { UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { TerminalInteraction, TerminalState } from './presentation.ts'
import { resolveNativeTuiArgs, type Config } from './config.ts'
import { terminalCopy } from './locale.ts'

/** Internal operations backed by one selected native executor and persistence authority. */
export interface TerminalExecution {
  readonly turn: NativeHeadlessApplication['executeRootTurn']
  /**
   * @param id - exact Session identity.
   * @param resume - open existing history instead of creating a Session.
   * @param signal - accepted operation cancellation.
   * @returns completion after the executor releases maintenance ownership.
   */
  open(id: SessionId, resume: boolean, signal: AbortSignal): Promise<void>
  /**
   * @param id - exact existing Session identity.
   * @param signal - accepted read cancellation.
   * @returns detached durable events from the selected authority.
   */
  history(id: SessionId, signal: AbortSignal): Promise<readonly SessionEvent[]>
}

const completedAssistantEvents = new Set(['assistant/message', 'assistant/attempt'])

/** The terminal owns input admission and observations; the selected executor owns every durable write. */
export class TerminalController implements TerminalInteraction {
  private readonly shutdown = new AbortController()
  private readonly queue: UserMessage[] = []
  private readonly listeners = new Set<() => void>()
  private selectedId: SessionId
  private state: TerminalState = { events: [], chunks: [], busy: false, queued: 0 }
  private active: AbortController | undefined
  private draining: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private closed = false
  private failure: Error | undefined
  private finish!: () => void
  private readonly done = new Promise<void>((resolve) => { this.finish = resolve })

  /**
   * @param execution - selected executor operations and history observation.
   * @param ownerSignal - native installation cancellation.
   * @param config - resolved terminal settings.
   * @param id - explicit fresh Session identity.
   */
  constructor(private readonly execution: TerminalExecution, private readonly ownerSignal: AbortSignal,
    protected readonly config: Config, id: SessionId) { this.selectedId = id }

  /** @returns the current immutable renderer observation. */
  snapshot(): TerminalState { return this.state }

  /**
   * @param listener - renderer state notification.
   * @returns disposal withdrawing only this renderer.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(update: Partial<TerminalState>): void {
    this.state = { ...this.state, ...update, queued: this.queue.length }
    for (const listener of this.listeners) {
      try { listener() } catch (error: unknown) { console.error('native-tui: renderer notification failed', error) }
    }
  }

  /** Admit one input to this terminal's bounded queue.
   * @param message - identified user input produced by the composer.
   */
  submit(message: UserMessage): void {
    if (this.closed || this.ownerSignal.aborted) throw new Error(terminalCopy(this.config.locale).closed)
    if (this.queue.length >= this.config.maxQueuedInputs) throw new Error(terminalCopy(this.config.locale).queueFull)
    this.queue.push(message)
    this.publish({})
    if (this.draining === undefined) {
      const pending = Promise.resolve().then(() => this.drain())
      this.draining = pending
      void pending.then(() => { this.draining = undefined })
    }
  }

  private async drain(): Promise<void> {
    while (!this.closed) {
      const message = this.queue.shift()
      if (message === undefined) return
      const controller = new AbortController()
      this.active = controller
      this.publish({ busy: true, chunks: [], error: undefined })
      const signal = AbortSignal.any([controller.signal, this.shutdown.signal, this.ownerSignal])
      try {
        const result = await this.execution.turn({ id: this.selectedId, resume: true, message,
          onEvent: (event) => { this.record(event) }, onChunk: (chunk) => { this.publish({
            chunks: [...this.state.chunks, chunk].slice(-this.config.maxStreamChunks),
          }) },
        }, signal)
        if (result.exitCode !== 0) this.publish({
          error: signal.aborted ? terminalCopy(this.config.locale).cancelled : terminalCopy(this.config.locale).failed,
        })
      } catch (error: unknown) {
        if (error !== signal.reason) this.failure = new Error(terminalCopy(this.config.locale).failed, { cause: error })
        this.publish({ error: error === signal.reason ? terminalCopy(this.config.locale).cancelled : String(error) })
      } finally {
        this.active = undefined
        this.publish({ busy: false, chunks: [] })
      }
    }
  }

  private record(event: SessionEvent): void {
    this.publish({ events: [...this.state.events, event].slice(-this.config.maxTranscriptEvents),
      ...completedAssistantEvents.has(event.type) ? { chunks: [] } : {} })
  }

  /** Cancel the active turn and discard queued input; writer drain completes before the next admission runs. */
  cancel(): void {
    this.queue.length = 0
    this.active?.abort(new Error(terminalCopy(this.config.locale).cancelled))
    this.publish({})
  }

  /** Request ordinary exit; application completion follows asynchronous cleanup. */
  exit(): void { this.finish() }

  /** Open or restore the selected Session before admitting terminal input.
   * @param args - optional explicit --resume Session identity.
   * @param signal - launcher shutdown cancellation.
   * @returns completion after durable Session history is ready.
   */
  async initialize(args: readonly string[], signal: AbortSignal): Promise<void> {
    const [mode, id] = resolveNativeTuiArgs(args)
    this.withdrawLaunch?.()
    const lifetime = AbortSignal.any([signal, this.ownerSignal, this.shutdown.signal])
    const stop = (): void => { this.finish() }
    lifetime.addEventListener('abort', stop, { once: true })
    try {
      lifetime.throwIfAborted()
      if (id !== undefined) this.selectedId = SessionId(id)
      await this.execution.open(this.selectedId, mode === '--resume', lifetime)
      const events = await this.execution.history(this.selectedId, lifetime)
      this.state = { ...this.state, events: events.slice(-this.config.maxTranscriptEvents) }
    } catch (error: unknown) {
      lifetime.removeEventListener('abort', stop)
      throw error
    }
    this.withdrawLaunch = () => { lifetime.removeEventListener('abort', stop) }
  }

  private withdrawLaunch: (() => void) | undefined

  /** @returns the terminal's exit request; accepted execution still drains in close(). */
  waitForExit(): Promise<void> { return this.done }

  /** Return status only after accepted execution drains.
   * @param signal - launcher cancellation.
   * @returns ordinary or interrupted process status.
   */
  status(signal: AbortSignal): number {
    if (this.failure !== undefined) {
      throw this.failure
    }
    return signal.aborted || this.ownerSignal.aborted ? 130 : 0
  }

  /** @returns completion after all currently admitted inputs settle. */
  async settle(): Promise<void> { await this.draining }

  /** Close input admission and await the selected executor before resource withdrawal.
   * @returns idempotent completion after accepted work drains.
   */
  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.closed = true
    this.listeners.clear()
    this.withdrawLaunch?.()
    this.queue.length = 0
    this.shutdown.abort(new Error('native-tui: disposed'))
    this.finish()
    return this.closing = (async () => {
      await this.settle()
    })()
  }
}
