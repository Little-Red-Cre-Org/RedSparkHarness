/** Read-only tmux location queries for Native Headless requests. */
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session/native'
import type { NativeTmuxContext, NativeTmuxContextRequest } from '@deepseek-ai/dsh-tmux-context-definition'
import type { ShellOperations, ShellRunResult } from '@deepseek-ai/dsh-shell/native'

/** Optional refresh floor for changed tmux readings. */
export interface Config {
  /** Minimum milliseconds between durable readings in one Session; omission and `0` disable the floor. */
  refreshIntervalMs?: number
}

/** Validated configuration selected before the Native Provider is admitted. */
export interface ResolvedConfig {
  readonly refreshIntervalMs: number
}

/**
 * Resolve static Native tmux-context configuration before the Provider is admitted.
 * @param input - optional installation configuration.
 * @returns validated refresh settings.
 */
export function resolveNativeTmuxContextConfig(input: unknown): ResolvedConfig {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    throw new TypeError('native-tmux-context: config must be an object')
  }
  const fields = input as Record<string, unknown> | undefined
  if (fields !== undefined && Object.keys(fields).some(key => key !== 'refreshIntervalMs')) {
    throw new TypeError('native-tmux-context: unknown configuration field')
  }
  const refreshIntervalMs = fields?.refreshIntervalMs ?? 0
  if (typeof refreshIntervalMs !== 'number' || !Number.isSafeInteger(refreshIntervalMs) || refreshIntervalMs < 0) {
    throw new TypeError('native-tmux-context: refreshIntervalMs must be a non-negative safe integer')
  }
  return { refreshIntervalMs }
}

interface TmuxLocation {
  readonly sessionName: string
  readonly windowIndex: string
  readonly windowName: string
  readonly paneIndex: string
  readonly paneId: string
  readonly windowActive: string
  readonly paneActive: string
  readonly windowLayout: string
}

interface Facts {
  activeTurn: number | undefined
  latest: { state: string; time: number } | undefined
}

const FIELD_SEPARATOR = '\\t'
const FIELDS = [
  '#{session_name}', '#{window_index}', '#{window_name}', '#{pane_index}',
  '#{pane_id}', '#{window_active}', '#{pane_active}', '#{window_layout}',
] as const

function appendEvent(state: Facts, event: SessionEvent): void {
  if (event.type === 'turn/start') state.activeTurn = event.data.turn
  if (event.type === 'turn/end') state.activeTurn = undefined
  if (event.type !== 'user/message' || event.data.source.kind !== 'plugin'
    || event.data.source.plugin !== 'native-tmux-context') return
  const [block] = event.data.content
  if (block?.type !== 'text') return
  const newline = block.text.indexOf('\n')
  state.latest = { state: newline === -1 ? '' : block.text.slice(newline + 1), time: event.time }
}

function renderState(location: TmuxLocation): string {
  return `session ${location.sessionName}, `
    + `window ${location.windowIndex} ${JSON.stringify(location.windowName)}, `
    + `pane ${location.paneIndex} ${location.paneId}\n`
    + `window active=${location.windowActive}, pane active=${location.paneActive}, layout ${location.windowLayout}`
}

function parseLocation(result: ShellRunResult): TmuxLocation | undefined {
  if (result.exitCode !== 0 || result.timedOut || result.aborted) return undefined
  const line = result.stdout.text.split('\n', 1)[0] ?? ''
  const parts = line.split(FIELD_SEPARATOR)
  if (parts.length !== FIELDS.length) return undefined
  const [sessionName, windowIndex, windowName, paneIndex, paneId, windowActive, paneActive, windowLayout] = parts
  if (sessionName === undefined || windowIndex === undefined || windowName === undefined || paneIndex === undefined
    || paneId === undefined || windowActive === undefined || paneActive === undefined || windowLayout === undefined
    || paneId.length === 0) return undefined
  return { sessionName, windowIndex, windowName, paneIndex, paneId, windowActive, paneActive, windowLayout }
}

async function queryLocation(shell: Pick<ShellOperations, 'resolve' | 'run'>, processId: number,
  signal: AbortSignal): Promise<TmuxLocation | undefined> {
  const format = FIELDS.join(FIELD_SEPARATOR)
  const command = [
    '[ -n "$TMUX_PANE" ] || exit 1',
    `self_tty=$(ps -o tty= -p ${processId} | tr -d ' ')`,
    '[ -n "$self_tty" ] || exit 1',
    'pane_tty=$(tmux display-message -t "$TMUX_PANE" -p \'#{pane_tty}\') || exit 1',
    '[ "$pane_tty" = "/dev/$self_tty" ] || exit 1',
    `exec tmux display-message -t "$TMUX_PANE" -p '${format}'`,
  ].join('\n')
  const result = await shell.run(shell.resolve({ command, signal }))
  return parseLocation(result)
}

/** Native tmux context backed by the configured shell service and committed Session events. */
export class NativeTmuxContextProvider implements NativeTmuxContext {
  private readonly states = new WeakMap<Session, Facts>()

  /** @param config - validated refresh floor. @param shell - selected shell Provider. @param lifetime - Provider installation lifetime. */
  constructor(
    private readonly config: ResolvedConfig,
    private readonly shell: Pick<ShellOperations, 'resolve' | 'run'> | undefined,
    private readonly lifetime: AbortSignal,
    private readonly processId = process.pid,
    private readonly now: () => number = Date.now,
  ) {}

  /** @inheritdoc */
  seed(session: Session, events: readonly SessionEvent[]): void {
    if (this.states.has(session)) throw new Error('native-tmux-context: Session was already seeded')
    const state: Facts = { activeTurn: undefined, latest: undefined }
    for (const event of events) appendEvent(state, event)
    this.states.set(session, state)
  }

  /** @inheritdoc */
  record(session: Session, event: SessionEvent): void {
    const state = this.states.get(session)
    if (state === undefined) throw new Error('native-tmux-context: Session is not seeded')
    appendEvent(state, event)
  }

  /** @inheritdoc */
  async prepare(request: NativeTmuxContextRequest): Promise<UserMessage | undefined> {
    if (request.step !== 1) return undefined
    if (this.shell === undefined) return undefined
    const state = this.states.get(request.session)
    if (state === undefined || state.activeTurn !== request.turn) {
      throw new Error('native-tmux-context: request turn is not active in the seeded Session')
    }
    const signal = AbortSignal.any([request.signal, this.lifetime])
    signal.throwIfAborted()
    const previous = state.latest
    const now = this.now()
    if (previous !== undefined && this.config.refreshIntervalMs > 0 && now >= previous.time
      && now - previous.time < this.config.refreshIntervalMs) return undefined
    let location: TmuxLocation | undefined
    try {
      location = await queryLocation(this.shell, this.processId, signal)
    } catch (error: unknown) {
      if (signal.aborted) signal.throwIfAborted()
      const message = error instanceof Error ? error.message : String(error)
      process.emitWarning(`native-tmux-context: tmux location query failed: ${message}; injecting no location this turn`)
      return undefined
    }
    signal.throwIfAborted()
    if (location === undefined) return undefined
    const stableState = renderState(location)
    if (previous?.state === stableState) return undefined
    const text = `tmux location (turn ${request.turn}):\n${stableState}`
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'native-tmux-context', form: 'snapshot', sections: [{ name: 'native-tmux-context', text }] },
    })
  }
}

export { plugin } from './native.ts'
