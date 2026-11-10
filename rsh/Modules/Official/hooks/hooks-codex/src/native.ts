/**
 * Native bridge for unmodified Codex command hooks.
 *
 * It supports the five points the Cordis bridge owns — SessionStart,
 * UserPromptSubmit, PreToolUse, PostToolUse and Stop — with Codex's snake_case
 * payloads, its model and permission_mode fields, no trailing stdin newline, its
 * regex-only matchers, and its block-only decision vocabulary. Shared execution,
 * matching, merging and the durable hook invocation pair live in the shared hook
 * protocol.
 *
 * @module @redspark/rsh-hooks-codex/native
 */

import { readFileSync } from 'node:fs'
import type { NativeContext, NativePlugin } from '@redspark/rsh-native-runtime'
import type {} from '@redspark/rsh-native-runtime'
import { createUserMessage, type ContentBlock, type MessageSource, type UserMessage } from '@redspark/rsh-llm/native'
import type { Session } from '@redspark/rsh-session/native'
import type {} from '@redspark/rsh-session/types'
import type {
  NativeToolPostCall, NativeToolPostDecision, NativeToolPreCall, NativeToolPreDecision,
} from '@redspark/rsh-native-tools'
import type {} from '@redspark/rsh-native-tools/native'
import {
  NativeRequestContextProviderId, type PreparedNativeRequestContext,
} from '@redspark/rsh-request-context-definition'
import type { NativeStepAdmissionContext, NativeStepAdmissionDecision } from '@redspark/rsh-native-session-execution'
import type { NativeSessionStartNotice } from '@redspark/rsh-native-headless/lifecycle-events'
import {
  appendHookInvoked,
  appendHookResult,
  createDetachedRuns,
  DEFAULT_HOOK_TIMEOUT_MS,
  DEFAULT_STDERR_SUMMARY_MAX_CHARS,
  matchesMatcher,
  mergeHookOutputs,
  runHook,
  type HookOutput,
  type MatcherGroup,
  type MergedHookOutcome,
} from '@redspark/rsh-hook-protocol/native'
import { parseCodexConfig, type CodexHookConfig, type CodexSupportedEvent } from './config.ts'

/** The plugin source every context this bridge injects is stamped with. */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'hooks-codex' }

/** Request-context provider identity this bridge registers for SessionStart context. */
const REQUEST_CONTEXT_ID = NativeRequestContextProviderId('hooks-codex:SessionStart')

/** Admission order for the prompt hook: after program-owned gates, before the model request. */
const ADMISSION_ORDER = 100

/** Execution settings one Native installation accepts. */
export interface NativeConfig {
  /** Path to a Codex hooks.json. */
  readonly configPath: string
  /** The model name stamped on every payload (Codex includes model on each event). */
  readonly model?: string
  /** Per-hook timeout in milliseconds when a hook declares none (Codex default: 600000). */
  readonly defaultTimeoutMs?: number
  /** Character cap for the hook result event's persisted stderr summary. */
  readonly stderrSummaryMaxChars?: number
}

/** Resolved settings after validation; no callback supplies a default again. */
interface Settings {
  readonly parsed: CodexHookConfig
  readonly model: string
  readonly defaultTimeoutMs: number
  readonly stderrSummaryMaxChars: number
}

let handlerCounter = 0

/**
 * A stable per-handler id so an invoked/result pair correlates in the log.
 * @param point - hook point the handler runs for.
 * @returns the next id for this point.
 */
function nextHandlerId(point: string): string {
  return `codex:${point}:${++handlerCounter}`
}

/**
 * Reject a persisted summary cap a slice would misbehave on.
 * @param name - configuration field being validated.
 * @param value - declared cap.
 */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`hooks-codex: ${name} must be a positive integer`)
}

/**
 * Read and validate one installation's settings.
 * @param input - the profile row's configuration value.
 * @param warn - report a skipped or unreadable configuration without failing activation.
 * @returns resolved settings, or undefined when the config file cannot be read.
 */
function readSettings(input: unknown, warn: (message: string) => void): Settings | undefined {
  if (input === undefined || typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('hooks-codex: native configuration must be an object')
  }
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (!['configPath', 'model', 'defaultTimeoutMs', 'stderrSummaryMaxChars'].includes(key)) {
      throw new Error(`hooks-codex: unknown configuration field ${key}`)
    }
  }
  if (typeof fields.configPath !== 'string' || fields.configPath.length === 0) {
    throw new Error('hooks-codex: configPath must be a non-empty string')
  }
  if (fields.model !== undefined && typeof fields.model !== 'string') {
    throw new Error('hooks-codex: model must be a string')
  }
  const defaultTimeoutMs = fields.defaultTimeoutMs === undefined ? DEFAULT_HOOK_TIMEOUT_MS : fields.defaultTimeoutMs
  if (typeof defaultTimeoutMs !== 'number' || !Number.isFinite(defaultTimeoutMs) || defaultTimeoutMs <= 0) {
    throw new Error('hooks-codex: defaultTimeoutMs must be a positive finite number')
  }
  const stderrSummaryMaxChars = fields.stderrSummaryMaxChars === undefined
    ? DEFAULT_STDERR_SUMMARY_MAX_CHARS : fields.stderrSummaryMaxChars
  if (typeof stderrSummaryMaxChars !== 'number') {
    throw new Error('hooks-codex: stderrSummaryMaxChars must be a number')
  }
  assertPositiveInteger('stderrSummaryMaxChars', stderrSummaryMaxChars)
  const path = fields.configPath
  let parsed: CodexHookConfig = {}
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const result = parseCodexConfig(raw)
    parsed = result.config
    for (const skipped of result.skipped) {
      warn(`hooks-codex: skipping ${skipped.reason} on ${skipped.event} (only sync command hooks run)`)
    }
  } catch (error: unknown) {
    warn(`hooks-codex: could not load hook config "${path}": ${String(error)} — no hooks registered`)
    return undefined
  }
  return {
    parsed,
    model: typeof fields.model === 'string' ? fields.model : '',
    defaultTimeoutMs,
    stderrSummaryMaxChars,
  }
}

/**
 * Build additional model context from hook output.
 * @param merged - folded outcome of every matched hook.
 * @returns one sourced user message, or undefined when no hook added context.
 */
function contextFrom(merged: MergedHookOutcome): UserMessage | undefined {
  if (merged.additionalContext.length === 0) return undefined
  const content: ContentBlock[] = merged.additionalContext.map(text => ({ type: 'text', text }))
  return createUserMessage({ content, source: PLUGIN_SOURCE })
}

/**
 * Prepend one context without flattening source fields or other downstream metadata.
 * @param ours - this bridge's context.
 * @param theirs - contexts a downstream listener supplied.
 * @returns the combined order.
 */
function prependContext(ours: UserMessage, theirs: readonly UserMessage[] | undefined): UserMessage[] {
  return [ours, ...theirs ?? []]
}

/**
 * Flatten content blocks to the text a hook payload carries.
 * @param content - message or result content.
 * @returns the concatenated text of every text block.
 */
function blocksToText(content: readonly ContentBlock[]): string {
  return content.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text).join('')
}

/**
 * Extract a command string from a tool call's parsed arguments.
 * @param args - parsed tool arguments.
 * @returns the command, or an empty string when the call carries none.
 */
function commandOf(args: unknown): string {
  if (typeof args === 'object' && args !== null && 'command' in args) {
    const command: unknown = (args as { command?: unknown }).command
    if (typeof command === 'string') return command
  }
  return ''
}

/**
 * The Codex base fields every payload carries.
 * @param session - Session supplying identity and workspace.
 * @param event - hook point name.
 * @param model - configured model name stamped on every payload.
 * @returns the shared payload prefix.
 */
function base(session: Session, event: string, model: string): Record<string, unknown> {
  return {
    session_id: session.header.id,
    // The persistence seam exposes no artifact path; the field stays null
    // (a durable consumer gap recorded in this package's README).
    transcript_path: null,
    cwd: session.header.cwd,
    hook_event_name: event,
    model,
    permission_mode: 'default',
  }
}

/**
 * The base fields plus the turn id for turn-scoped events.
 * @param session - Session supplying identity and workspace.
 * @param event - hook point name.
 * @param model - configured model name.
 * @param turn - the open turn, when one is known.
 * @returns the shared payload prefix for a turn-scoped event.
 */
function turnBase(session: Session, event: string, model: string, turn: number | undefined): Record<string, unknown> {
  return { ...base(session, event, model), turn_id: String(turn ?? 0) }
}

/**
 * Build the PreToolUse payload.
 * @param call - pre-tool decision facts.
 * @param model - configured model name.
 * @returns the stdin payload.
 */
function preToolPayload(call: Readonly<NativeToolPreCall>, model: string): Record<string, unknown> {
  return {
    ...turnBase(call.session, 'PreToolUse', model, call.turn),
    tool_name: call.name,
    tool_input: { command: commandOf(call.arguments) },
    tool_use_id: call.callId,
  }
}

/**
 * Build the PostToolUse payload.
 * @param call - post-tool decision facts.
 * @param model - configured model name.
 * @returns the stdin payload.
 */
function postToolPayload(call: Readonly<NativeToolPostCall>, model: string): Record<string, unknown> {
  return {
    ...turnBase(call.session, 'PostToolUse', model, call.turn),
    tool_name: call.name,
    tool_input: { command: commandOf(call.arguments) },
    tool_use_id: call.callId,
    tool_response: blocksToText(call.result.content),
  }
}

/**
 * Run every command hook configured for one point whose matcher selects the query.
 *
 * Codex treats every matcher as an unanchored regex and writes stdin without a
 * trailing newline. Clean plain stdout becomes context when no structured context
 * exists, and raw JSON never leaks as prose.
 * @param context - the installation's owned capabilities, for the shell service.
 * @param settings - validated bridge settings.
 * @param point - hook point name, also the payload's hook_event_name.
 * @param matchQuery - the event's matcher subject; empty for events ignoring matchers.
 * @param payload - the exact object written to the hook's stdin.
 * @param opts - the invocation's Session, open turn, cancellation and plain-stdout rule.
 * @returns the most-restrictive folded outcome of every matched hook.
 */
async function runPoint(
  context: NativeContext, settings: Settings, point: CodexSupportedEvent, matchQuery: string, payload: unknown,
  opts: { readonly session?: Session; readonly turn?: number; readonly signal: AbortSignal; readonly plainStdoutAsContext?: boolean },
): Promise<MergedHookOutcome> {
  const groups: MatcherGroup[] = settings.parsed[point] ?? []
  const outputs: HookOutput[] = []
  // Run the hook in the Session workspace so relative paths address the project.
  const workdir = opts.session?.header.cwd
  for (const group of groups) {
    // Codex always interprets matchers as regexes; it has no literal fast path.
    if (!matchesMatcher(group.matcher, matchQuery, 'codex')) continue
    for (const hook of group.hooks) {
      const handlerId = nextHandlerId(point)
      const session = opts.session
      const turn = opts.turn
      const records = session !== undefined && turn !== undefined
      if (records) {
        appendHookInvoked(session, {
          turn, point, dialect: 'codex', handlerId,
          ...group.matcher === undefined ? {} : { matcher: group.matcher },
        })
      }
      const { output, durationMs } = await runHook(context.require('shell'), hook, {
        payload,
        defaultTimeoutMs: settings.defaultTimeoutMs,
        ...workdir === undefined ? {} : { cwd: workdir },
        signal: opts.signal,
        // Codex writes stdin without a trailing newline.
        trailingNewline: false,
        // Discard a hookSpecificOutput block naming a different event.
        expectedEventName: point,
      }, () => performance.now())
      // Clean plain stdout becomes context only when no structured context
      // exists; nonzero output and raw JSON never leak as prose.
      if (opts.plainStdoutAsContext === true && output.exitCode === 0
        && output.additionalContext === undefined
        && output.stdout.length > 0 && !output.stdout.startsWith('{')) {
        output.additionalContext = output.stdout
      }
      outputs.push(output)
      if (output.systemMessage !== undefined) {
        console.warn(`hooks-codex: ${point} hook emitted a systemMessage, which is not surfaced (ignored)`)
      }
      if (records) {
        appendHookResult(session, {
          turn, point, handlerId, output, stderrSummaryMaxChars: settings.stderrSummaryMaxChars, durationMs,
        })
      }
    }
  }
  return mergeHookOutputs(outputs)
}

/**
 * Answer the UserPromptSubmit hook for one admitted prompt.
 *
 * Codex supports reject and context but not rewrite or ask. The prompt enters
 * through step admission, so the decision is made there: a rejection opens no step
 * and its context joins the admitted batch.
 * @param context - the installation's owned capabilities.
 * @param settings - validated bridge settings.
 * @param ask - the admission context supplied by the Program.
 * @param next - the remaining admission chain, called exactly once.
 * @returns the admitted batch, or a rejection that opens no step.
 */
async function admitPrompt(
  context: NativeContext, settings: Settings,
  ask: NativeStepAdmissionContext, next: () => Promise<NativeStepAdmissionDecision>,
): Promise<NativeStepAdmissionDecision> {
  if (ask.candidates.length === 0) return next()
  const prompt = blocksToText(ask.candidates.flatMap(message => message.content))
  const payload = {
    ...turnBase(ask.owner.session, 'UserPromptSubmit', settings.model, ask.turn),
    prompt,
  }
  const merged = await runPoint(context, settings, 'UserPromptSubmit', '', payload, {
    session: ask.owner.session, turn: ask.turn, plainStdoutAsContext: true, signal: ask.signal,
  })
  if (merged.decision === 'deny') return { kind: 'reject', discard: ask.candidates.map(message => message.id) }
  // Context alone is not a veto: DELEGATE so a later admission hook can still reject.
  const downstream = await next()
  if (downstream.kind !== 'enter') return downstream
  const ours = contextFrom(merged)
  if (ours === undefined) return downstream
  return { ...downstream, messages: [...downstream.messages, ours] }
}

/**
 * Install one bridge instance over the extension points a Native profile exposes.
 * @param context - this installation's owned capabilities, scope and cancellation.
 * @param settings - validated bridge settings.
 */
function install(context: NativeContext, settings: Settings): void {
  // SessionStart is the one emit-shaped point: track its run chain so disposal
  // aborts a still-running hook process and drains the continuation.
  const detached = createDetachedRuns()
  context.own(() => detached.drain())
  // The first request reads the start announcement outcome; a later request does not.
  let startContext: Promise<UserMessage | undefined> | undefined

  context.on('session/starting', (notice: NativeSessionStartNotice) => {
    const payload = { ...base(notice.session, 'SessionStart', settings.model), source: notice.source }
    const run = runPoint(context, settings, 'SessionStart', notice.source, payload, {
      session: notice.session, plainStdoutAsContext: true,
      signal: AbortSignal.any([detached.signal, notice.signal]),
    }).then(merged => contextFrom(merged)).catch((error: unknown) => {
      console.warn(`hooks-codex: SessionStart hook failed: ${String(error)}`)
      return undefined
    })
    detached.track(run)
    startContext = run
  })

  const requestContexts = context.optional('requestContexts')
  if (requestContexts !== undefined) {
    // SessionStart is announced in parallel and cannot gate the opening request, so
    // the outcome is offered as a request-context provider: the first request awaits
    // it and later requests contribute nothing.
    context.effect(requestContexts.register(context.scope, {
      id: REQUEST_CONTEXT_ID, order: 0,
      async prepare(): Promise<PreparedNativeRequestContext> {
        const pending = startContext
        startContext = undefined
        if (pending === undefined) return { messages: [], commit() {} }
        const message = await pending
        return { messages: message === undefined ? [] : [message], commit() {} }
      },
    }))
  }

  const activeSessions = context.optional('activeSessions')
  if (activeSessions !== undefined) {
    context.effect(activeSessions.onAttached((owner) => {
      context.effect(owner.beforeStep((ask, next) => admitPrompt(context, settings, ask, next), ADMISSION_ORDER))
      return Promise.resolve()
    }))
  }

  const tools = context.optional('tools')
  if (tools !== undefined) {
    // --- PreToolUse: Codex blocks only (no allow or ask honored). ---
    context.effect(tools.interceptBeforeCall(async (call, next): Promise<NativeToolPreDecision> => {
      const merged = await runPoint(context, settings, 'PreToolUse', call.name, preToolPayload(call, settings.model), {
        session: call.session,
        ...call.turn === undefined ? {} : { turn: call.turn },
        signal: call.signal,
      })
      if (merged.decision === 'deny') return { kind: 'deny', reason: merged.reason ?? 'blocked by PreToolUse hook' }
      return next()
    }, context.scope))
    // --- PostToolUse: block with feedback, or attach context. ---
    context.effect(tools.interceptAfterCall(async (call, next): Promise<NativeToolPostDecision> => {
      const merged = await runPoint(context, settings, 'PostToolUse', call.name, postToolPayload(call, settings.model), {
        session: call.session,
        ...call.turn === undefined ? {} : { turn: call.turn },
        signal: call.signal,
      })
      const ours = contextFrom(merged)
      if (merged.decision === 'deny') {
        return {
          kind: 'block',
          feedback: [{ type: 'text', text: merged.reason ?? 'blocked by PostToolUse hook' }],
          ...ours === undefined ? {} : { additionalContexts: [ours] },
        }
      }
      // Context alone is not a veto: DELEGATE, then fold our context onto the
      // downstream decision (a downstream block carries it too).
      const downstream = await next()
      if (ours === undefined) return downstream
      return { ...downstream, additionalContexts: prependContext(ours, downstream.additionalContexts) }
    }, context.scope))
  }

  // --- Stop: admit one model-visible message into the next-step inbox. A blocking
  // Stop hook forces continuation; a block with no reason still forces it, so fall
  // back to a generic steering line rather than letting the turn stop. ---
  context.on('turn/stopping', async (notice) => {
    const payload = {
      ...turnBase(notice.session, 'Stop', settings.model, notice.turn),
      stop_hook_active: false,
      last_assistant_message: null,
    }
    const merged = await runPoint(context, settings, 'Stop', '', payload, {
      session: notice.session, turn: notice.turn, signal: notice.signal,
    })
    if (merged.decision !== 'deny') return
    const text = merged.reason ?? 'continue: blocked by Stop hook'
    if (activeSessions === undefined) return
    const owner = activeSessions.owners().find(candidate => candidate.session === notice.session)
    if (owner === undefined) return
    await owner.enqueue(createUserMessage({ content: [{ type: 'text', text }], source: PLUGIN_SOURCE }),
      'next-step', true, notice.signal)
  })
}

/**
 * One bridge installation: a Native plugin answering the extension points a Codex
 * hooks.json configures.
 */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@redspark/rsh-hooks-codex', targets: ['host'],
  requires: ['shell'], optional: ['tools', 'requestContexts', 'activeSessions'], provides: [],
  resolve(input) {
    const settings = readSettings(input, (message) => { console.warn(message) })
    return (context) => { if (settings !== undefined) install(context, settings) }
  },
}
