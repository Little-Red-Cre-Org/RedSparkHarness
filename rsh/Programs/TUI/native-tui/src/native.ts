/** Interactive terminal Consumer over the selected native Agent and Session executor. */
import { randomUUID } from 'node:crypto'
import React from 'react'
import { render, type Instance } from 'ink'
import type { NativeApplication, NativeContext, NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-native-session-execution/native'
import type {} from '@deepseek-ai/dsh-native-model-execution/native'
import { createNativeHeadlessApplication, resolveNativeHeadlessConfig, type Config as TurnConfig,
  type NativeHeadlessApplication } from '@deepseek-ai/dsh-native-headless/native'
import { readNativeSessionHistory } from '@deepseek-ai/dsh-native-session-execution/read-history'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import type { UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { TerminalView, type TerminalInteraction, type TerminalState } from './presentation.ts'
import { terminalCopy } from './locale.ts'

/** Explicit terminal limits and appearance in addition to shared turn settings. */
export interface Config extends TurnConfig {
  readonly locale: 'en' | 'zh'
  readonly background: string
  readonly maxQueuedInputs: number
  readonly maxHistoryEvents: number
  readonly maxTranscriptEvents: number
  readonly maxStreamChunks: number
}

function positive(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(`native-tui: ${key} must be a positive safe integer`)
  return value
}

/** Validate terminal settings before any Ink or execution resource is acquired.
 * @param input - explicit native profile configuration.
 * @returns resolved terminal and turn settings.
 */
export function resolveNativeTuiConfig(input: unknown): Config {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('native-tui: configuration must be an object')
  }
  const { locale, background, maxQueuedInputs, maxHistoryEvents, maxTranscriptEvents, maxStreamChunks, ...turn }
    = input as Record<string, unknown>
  if (locale !== 'en' && locale !== 'zh') throw new TypeError('native-tui: locale must be en or zh')
  if (typeof background !== 'string' || !/^#[0-9a-f]{6}$/i.test(background)) throw new TypeError('native-tui: background must be #rrggbb')
  return { ...resolveNativeHeadlessConfig(turn), locale, background,
    maxQueuedInputs: positive(maxQueuedInputs, 'maxQueuedInputs'), maxHistoryEvents: positive(maxHistoryEvents, 'maxHistoryEvents'),
    maxTranscriptEvents: positive(maxTranscriptEvents, 'maxTranscriptEvents'), maxStreamChunks: positive(maxStreamChunks, 'maxStreamChunks') }
}

/** One terminal owns input admission and presentation; the shared executor owns all durable writes. */
export class NativeTuiApplication implements NativeApplication, TerminalInteraction {
  private readonly shutdown = new AbortController()
  private readonly queue: UserMessage[] = []
  private readonly listeners = new Set<() => void>()
  private readonly id = SessionId(`session-${randomUUID()}`)
  private selectedId = this.id
  private state: TerminalState = { events: [], chunks: [], busy: false, queued: 0 }
  private active: AbortController | undefined
  private draining: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private closed = false
  private failure: unknown
  private ink: Instance | undefined
  private finish!: () => void
  private readonly done = new Promise<void>((resolve) => { this.finish = resolve })

  /**
   * @param context - terminal installation and selected persistence authorities.
   * @param executor - shared native executor with sole writer ownership.
   * @param config - resolved terminal settings.
   */
  constructor(private readonly context: NativeContext, private readonly executor: NativeHeadlessApplication,
    private readonly config: Config) {}

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
    if (this.closed || this.context.signal.aborted) throw new Error(terminalCopy(this.config.locale).closed)
    if (this.queue.length >= this.config.maxQueuedInputs) throw new Error(terminalCopy(this.config.locale).queueFull)
    this.queue.push(message)
    this.publish({})
    if (this.draining === undefined) {
      const pending = Promise.resolve().then(() => this.drain())
      this.draining = pending
      void pending.then(() => { if (this.draining === pending) this.draining = undefined }, () => {
        if (this.draining === pending) this.draining = undefined
      })
    }
  }

  private async drain(): Promise<void> {
    while (!this.closed) {
      const message = this.queue.shift()
      if (message === undefined) return
      const controller = new AbortController()
      this.active = controller
      this.publish({ busy: true, chunks: [], error: undefined })
      const signal = AbortSignal.any([controller.signal, this.shutdown.signal, this.context.signal])
      try {
        const result = await this.executor.executeRootTurn({ id: this.selectedId, resume: true, message,
          onEvent: (event) => { this.record(event) }, onChunk: (chunk) => { this.publish({
            chunks: [...this.state.chunks, chunk].slice(-this.config.maxStreamChunks),
          }) },
        }, signal)
        if (result.exitCode !== 0) this.publish({
          error: signal.aborted ? terminalCopy(this.config.locale).cancelled : terminalCopy(this.config.locale).failed,
        })
      } catch (error: unknown) {
        if (!signal.aborted || error !== signal.reason) this.failure = error
        this.publish({ error: signal.aborted && error === signal.reason ? terminalCopy(this.config.locale).cancelled
          : error instanceof Error ? error.message : String(error) })
      } finally {
        this.active = undefined
        this.publish({ busy: false, chunks: [] })
      }
    }
  }

  private record(event: SessionEvent): void {
    this.publish({ events: [...this.state.events, event].slice(-this.config.maxTranscriptEvents),
      ...event.type === 'assistant/message' || event.type === 'assistant/attempt' ? { chunks: [] } : {} })
  }

  /** Cancel the active turn and discard queued input; writer drain completes before the next admission runs. */
  cancel(): void {
    this.queue.length = 0
    this.active?.abort(new Error(terminalCopy(this.config.locale).cancelled))
    this.publish({})
  }

  /** Request ordinary exit; application completion follows asynchronous cleanup. */
  exit(): void { this.finish() }

  /** Run the terminal through the supported native profile launcher.
   * @param args - optional explicit --resume Session identity.
   * @param signal - launcher shutdown cancellation.
   * @returns process status after Ink and accepted execution drain.
   */
  async run(args: readonly string[], signal: AbortSignal): Promise<number> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error(terminalCopy(this.config.locale).requiresTerminal)
    const [mode, id] = args
    if (args.length !== 0 && (args.length !== 2 || mode !== '--resume' || id === undefined || id.trim() === '')) {
      throw new Error('native-tui: usage --resume <session-id>')
    }
    const lifetime = AbortSignal.any([signal, this.context.signal, this.shutdown.signal])
    const stop = (): void => { this.finish() }
    lifetime.addEventListener('abort', stop, { once: true })
    try {
      lifetime.throwIfAborted()
      if (id !== undefined) this.selectedId = SessionId(id)
      await this.executor.executeSessionOperation(
        { id: this.selectedId, resume: args.length === 2 }, () => Promise.resolve(undefined), lifetime,
      )
      const stored = await readNativeSessionHistory(this.selectedId, {
        active: this.context.require('activeSessions'), persistence: this.context.require('sessionPersistence'),
        maxHistoryEvents: this.config.maxHistoryEvents, label: 'native-tui', onCleanupFailure: (error) => { this.failure = error },
      }, lifetime)
      this.state = { ...this.state, events: stored.events.slice(-this.config.maxTranscriptEvents) }
      this.ink = render(React.createElement(TerminalView, { interaction: this, locale: this.config.locale,
        model: `${this.config.provider}/${this.config.model}`, background: this.config.background }), { exitOnCtrlC: false })
      await this.done
    } finally {
      lifetime.removeEventListener('abort', stop)
      await this.close()
    }
    if (this.failure !== undefined) {
      throw this.failure instanceof Error ? this.failure : new Error('native-tui: execution failed', { cause: this.failure })
    }
    return signal.aborted || this.context.signal.aborted ? 130 : 0
  }

  /** Close input admission, cancel work and await the sole executor before withdrawing Ink.
   * @returns idempotent completion after accepted work drains.
   */
  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.closed = true
    this.listeners.clear()
    this.queue.length = 0
    this.shutdown.abort(new Error('native-tui: disposed'))
    this.finish()
    return this.closing = (async () => {
      await this.draining
      const exited = this.ink?.waitUntilExit()
      this.ink?.unmount()
      await exited
    })()
  }
}

/** Native terminal application installer; legacy RSH defaults remain separate. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-tui', targets: ['host'],
  requires: ['fs', 'sessionPersistence', 'modelExecution', 'agents', 'sessionExecution', 'activeSessions'],
  optional: ['tools', 'promptSections', 'sandboxPolicy', 'approval', 'codeRuntime', 'timeContext', 'agentPresets', 'workspaceRegistry', 'agentInstructions'],
  provides: ['application', 'rootExecution'],
  resolve(input) {
    const config = resolveNativeTuiConfig(input)
    return (context) => {
      const { locale: _locale, background: _background, maxQueuedInputs: _queue, maxHistoryEvents: _history,
        maxTranscriptEvents: _transcript, maxStreamChunks: _stream, ...turn } = config
      const executor = createNativeHeadlessApplication(context, turn, context.scope, {
        execution: context.require('sessionExecution'), active: context.require('activeSessions'),
      })
      const application = new NativeTuiApplication(context, executor, config)
      context.own(() => application.close())
      context.provide('application', application)
      context.provide('rootExecution', executor.rootExecution)
    }
  },
}
