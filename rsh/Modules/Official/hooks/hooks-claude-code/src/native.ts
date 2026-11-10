/**
 * Native bridge for unmodified Claude Code command hooks.
 *
 * It supports the same seven points the Cordis bridge owns — SessionStart,
 * UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStart and
 * SubagentStop — and owns the same Claude payloads, environment, substitution
 * and decision mapping. Shared execution, matching, merging and the durable
 * hook invocation pair live in the shared hook protocol; this module replaces
 * only the extension-point wiring and the payload facts a Native Agent supplies.
 *
 * A Native profile reaches these points through the tool interception service,
 * the request-context service and the lifecycle events the headless application
 * announces. Where the compatibility surface has no Native counterpart, this
 * bridge states the gap instead of emulating it.
 *
 * @module @redspark/rsh-hooks-claude-code/native
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
import { parseClaudeCodeConfig, type ClaudeCodeHookConfig } from './config.ts'

/** The plugin source every context this bridge injects is stamped with. */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'hooks-claude-code' }

/** Request-context provider identity this bridge registers for SessionStart context. */
const REQUEST_CONTEXT_ID = NativeRequestContextProviderId('hooks-claude-code:SessionStart')

/**
 * The agent type reported for SubagentStart and SubagentStop. The Native subagent
 * seam carries no per-kind label, so the bridge uses Claude Code's own Task-tool
 * default: a default, '*' or empty matcher fires and a config naming a specific
 * kind does not.
 */
const SUBAGENT_TYPE = 'general-purpose'

/** Admission order for the prompt hook: after program-owned gates, before the model request. */
const ADMISSION_ORDER = 100

/** Substitution and execution settings one Native installation accepts. */
export interface NativeConfig {
  /** Path to a hooks.json or to a settings file whose hooks key holds the config. */
  readonly configPath: string
  /** Replaces the plugin-root token in command strings. */
  readonly pluginRoot?: string
  /** Replaces the project-directory token and is exported to the hook process. */
  readonly projectDir?: string
  /** Per-hook timeout in milliseconds when a hook declares none (Claude Code default: 600000). */
  readonly defaultTimeoutMs?: number
  /** Character cap for the hook result event's persisted stderr summary. */
  readonly stderrSummaryMaxChars?: number
}

/** Resolved settings after validation; no callback supplies a default again. */
interface Settings {
  readonly parsed: ClaudeCodeHookConfig
  readonly projectDir: string | undefined
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
  return `claude-code:${point}:${++handlerCounter}`
}

/**
 * Reject a persisted summary cap a slice would misbehave on.
 * @param name - configuration field being validated.
 * @param value - declared cap.
 */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`hooks-claude-code: ${name} must be a positive integer`)
}

/**
 * Read and validate one installation's settings.
 * @param input - the profile row's configuration value.
 * @param warn - report a skipped or unreadable configuration without failing activation.
 * @returns resolved settings, or undefined when the config file cannot be read.
 */
function readSettings(input: unknown, warn: (message: string) => void): Settings | undefined {
  if (input === undefined || typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('hooks-claude-code: native configuration must be an object')
  }
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (!['configPath', 'pluginRoot', 'projectDir', 'defaultTimeoutMs', 'stderrSummaryMaxChars'].includes(key)) {
      throw new Error(`hooks-claude-code: unknown configuration field ${key}`)
    }
  }
  if (typeof fields.configPath !== 'string' || fields.configPath.length === 0) {
    throw new Error('hooks-claude-code: configPath must be a non-empty string')
  }
  for (const key of ['pluginRoot', 'projectDir'] as const) {
    if (fields[key] !== undefined && typeof fields[key] !== 'string') {
      throw new Error(`hooks-claude-code: ${key} must be a string`)
    }
  }
  const defaultTimeoutMs = fields.defaultTimeoutMs === undefined ? DEFAULT_HOOK_TIMEOUT_MS : fields.defaultTimeoutMs
  if (typeof defaultTimeoutMs !== 'number' || !Number.isFinite(defaultTimeoutMs) || defaultTimeoutMs <= 0) {
    throw new Error('hooks-claude-code: defaultTimeoutMs must be a positive finite number')
  }
  const stderrSummaryMaxChars = fields.stderrSummaryMaxChars === undefined
    ? DEFAULT_STDERR_SUMMARY_MAX_CHARS : fields.stderrSummaryMaxChars
  if (typeof stderrSummaryMaxChars !== 'number') {
    throw new Error('hooks-claude-code: stderrSummaryMaxChars must be a number')
  }
  assertPositiveInteger('stderrSummaryMaxChars', stderrSummaryMaxChars)
  const path = fields.configPath
  let parsed: ClaudeCodeHookConfig = {}
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const result = parseClaudeCodeConfig(raw, {
      ...fields.pluginRoot === undefined ? {} : { pluginRoot: fields.pluginRoot as string },
      ...fields.projectDir === undefined ? {} : { projectDir: fields.projectDir as string },
    })
    parsed = result.config
    for (const skipped of result.skipped) {
      warn(`hooks-claude-code: skipping unsupported "${skipped.type}" hook on ${skipped.event} (only command hooks run)`)
    }
  } catch (error: unknown) {
    warn(`hooks-claude-code: could not load hook config "${path}": ${String(error)} — no hooks registered`)
    return undefined
  }
  return {
    parsed,
    projectDir: fields.projectDir as string | undefined,
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
 * The Claude Code base fields every payload carries.
 * @param session - Session supplying identity and workspace.
 * @param event - hook point name.
 * @returns the shared payload prefix.
 */
function base(session: Session, event: string): Record<string, unknown> {
  return {
    session_id: session.header.id,
    // The persistence seam exposes no artifact path; the field stays empty
    // (a durable consumer gap recorded in this package's README).
    transcript_path: '',
    cwd: session.header.cwd,
    hook_event_name: event,
  }
}

/**
 * Build the SessionStart payload for one announced start.
 * @param session - Session starting its first request.
 * @param source - why the Session started.
 * @returns the stdin payload.
 */
function sessionStartPayload(session: Session, source: string): Record<string, unknown> {
  return { ...base(session, 'SessionStart'), source }
}

/**
 * Build the UserPromptSubmit payload.
 * @param session - Session receiving the prompt.
 * @param prompt - admitted prompt text.
 * @returns the stdin payload.
 */
function promptPayload(session: Session, prompt: string): Record<string, unknown> {
  return { ...base(session, 'UserPromptSubmit'), prompt }
}

/**
 * Build the PreToolUse payload from call facts.
 * @param call - pre-tool decision facts.
 * @returns the stdin payload.
 */
function preToolPayload(call: Readonly<NativeToolPreCall>): Record<string, unknown> {
  return {
    ...base(call.session, 'PreToolUse'),
    tool_name: call.name, tool_input: call.arguments, tool_use_id: call.callId,
  }
}

/**
 * Build the PostToolUse payload from call facts and the body result.
 * @param call - post-tool decision facts.
 * @returns the stdin payload.
 */
function postToolPayload(call: Readonly<NativeToolPostCall>): Record<string, unknown> {
  return {
    ...base(call.session, 'PostToolUse'),
    tool_name: call.name, tool_input: call.arguments, tool_use_id: call.callId,
    tool_response: blocksToText(call.result.content),
  }
}

/**
 * Build the Stop payload for one stopping turn.
 * @param session - Session whose turn is stopping.
 * @returns the stdin payload.
 */
function stopPayload(session: Session): Record<string, unknown> {
  return { ...base(session, 'Stop'), stop_hook_active: false }
}

/**
 * Run every command hook configured for one point whose matcher selects the query.
 *
 * A hook invocation/result pair is written per hook when the invocation has an
 * open turn; a detached lifecycle point omits the pair.
 * @param context - the installation's owned capabilities, for the shell service.
 * @param settings - validated bridge settings.
 * @param point - hook point name, also the payload's hook_event_name.
 * @param matchQuery - the event's matcher subject; empty for events ignoring matchers.
 * @param payload - the exact object written to the hook's stdin.
 * @param opts - the invocation's Session, open turn and cancellation.
 * @returns the most-restrictive folded outcome of every matched hook.
 */
async function runPoint(
  context: NativeContext, settings: Settings, point: string, matchQuery: string, payload: unknown,
  opts: { readonly session?: Session; readonly turn?: number; readonly signal: AbortSignal },
): Promise<MergedHookOutcome> {
  const groups: MatcherGroup[] = settings.parsed[point] ?? []
  const outputs: HookOutput[] = []
  // Run the hook in the Session workspace (the Session header cwd), not the
  // launching process's directory.
  const workdir = opts.session?.header.cwd
  const projectDir = settings.projectDir ?? workdir
  const hookEnv = projectDir !== undefined ? { CLAUDE_PROJECT_DIR: projectDir } : undefined
  for (const group of groups) {
    if (!matchesMatcher(group.matcher, matchQuery, 'claude-code')) continue
    for (const hook of group.hooks) {
      const handlerId = nextHandlerId(point)
      const session = opts.session
      const turn = opts.turn
      const records = session !== undefined && turn !== undefined
      if (records) {
        appendHookInvoked(session, {
          turn, point, dialect: 'claude-code', handlerId,
          ...group.matcher === undefined ? {} : { matcher: group.matcher },
        })
      }
      const { output, durationMs } = await runHook(context.require('shell'), hook, {
        payload,
        defaultTimeoutMs: settings.defaultTimeoutMs,
        ...hookEnv === undefined ? {} : { env: hookEnv },
        ...workdir === undefined ? {} : { cwd: workdir },
        signal: opts.signal,
        trailingNewline: true,
        // Discard a hookSpecificOutput block naming a different event than the one firing.
        expectedEventName: point,
      }, () => performance.now())
      outputs.push(output)
      if (output.updatedInput !== undefined) {
        // Rewriting already recorded arguments is refused by design; a hook may only
        // change what a body receives, through this bridge's own mapping.
        console.warn(`hooks-claude-code: ${point} hook requested updatedInput, which is not honored (ignored)`)
      }
      if (output.systemMessage !== undefined) {
        console.warn(`hooks-claude-code: ${point} hook emitted a systemMessage, which is not surfaced (ignored)`)
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
 * Install one bridge instance over the extension points a Native profile exposes.
 * @param context - this installation's owned capabilities, scope and cancellation.
 * @param settings - validated bridge settings.
 */
function install(context: NativeContext, settings: Settings): void {
  // Emit-shaped points run detached, so disposal aborts active hooks and drains
  // continuations before the installation releases its resources.
  const detached = createDetachedRuns()
  context.own(() => detached.drain())
  // The first request reads the start announcement outcome; a later request does not.
  let startContext: Promise<UserMessage | undefined> | undefined

  context.on('session/starting', (notice: NativeSessionStartNotice) => {
    const run = runPoint(context, settings, 'SessionStart', notice.source,
      sessionStartPayload(notice.session, notice.source), {
        session: notice.session, signal: AbortSignal.any([detached.signal, notice.signal]),
      }).then(merged => contextFrom(merged)).catch((error: unknown) => {
      console.warn(`hooks-claude-code: SessionStart hook failed: ${String(error)}`)
      return undefined
    })
    detached.track(run)
    startContext = run
  })

  const requestContexts = context.optional('requestContexts')
  if (requestContexts !== undefined) {
    // SessionStart is announced in parallel and cannot gate the opening request, so the
    // outcome is offered as a request-context provider: the first request awaits it and
    // later requests contribute nothing.
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

  const tools = context.optional('tools')
  if (tools !== undefined) {
    // --- PreToolUse: the matcher subject is the tool name. ---
    context.effect(tools.interceptBeforeCall(async (call, next): Promise<NativeToolPreDecision> => {
      const merged = await runPoint(context, settings, 'PreToolUse', call.name, preToolPayload(call), {
        session: call.session,
        ...call.turn === undefined ? {} : { turn: call.turn },
        signal: call.signal,
      })
      if (merged.decision === 'deny') return { kind: 'deny', reason: merged.reason ?? 'blocked by PreToolUse hook' }
      if (merged.decision === 'ask') return { kind: 'ask', ...merged.reason === undefined ? {} : { reason: merged.reason } }
      return next()
    }, context.scope))
    // --- PostToolUse: block with corrective feedback, or attach context. ---
    context.effect(tools.interceptAfterCall(async (call, next): Promise<NativeToolPostDecision> => {
      const merged = await runPoint(context, settings, 'PostToolUse', call.name, postToolPayload(call), {
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
      // Our hooks did not block, so DELEGATE: a later listener can still block, and it
      // receives our context either way.
      const downstream = await next()
      if (ours === undefined) return downstream
      return { ...downstream, additionalContexts: prependContext(ours, downstream.additionalContexts) }
    }, context.scope))
  }

  // --- UserPromptSubmit: reject the prompt before a step opens, or attach context to
  // the admitted batch. Active-owner admission is the Native Program's pre-step seam. ---
  const activeSessions = context.optional('activeSessions')
  if (activeSessions !== undefined) {
    context.effect(activeSessions.onAttached((owner) => {
      context.effect(owner.beforeStep(
        (ask, next) => admitPrompt(context, settings, ask, next), ADMISSION_ORDER))
      return Promise.resolve()
    }))
  }

  // --- Stop: admit one model-visible message into the next-step inbox, which the
  // application re-reads before it closes the turn. Awaited, so the admission is
  // durable before the turn decides whether to continue. ---
  context.on('turn/stopping', async (notice) => {
    const merged = await runPoint(context, settings, 'Stop', '', stopPayload(notice.session), {
      session: notice.session, turn: notice.turn, signal: notice.signal,
    })
    if (merged.decision !== 'deny') return
    // A blocking Stop hook forces continuation; a block with no reason still forces
    // it, so fall back to a generic steering line rather than letting the turn stop.
    const text = merged.reason ?? 'continue: blocked by Stop hook'
    const activeSessions = context.optional('activeSessions')
    if (activeSessions === undefined) return
    const owner = activeSessions.owners().find(candidate => candidate.session === notice.session)
    if (owner === undefined) return
    await owner.enqueue(createUserMessage({ content: [{ type: 'text', text }], source: PLUGIN_SOURCE }),
      'next-step', true, notice.signal)
  })

  // SubagentStart and SubagentStop have no Native counterpart: the Native subagent
  // seam announces no child lifecycle edge on the event bus, so a config that
  // declares them parses and runs nothing here. The compatibility bridge covers them
  // for compositions that still run Cordis.
  void SUBAGENT_TYPE
}

/**
 * One bridge installation: a Native plugin answering the extension points a Claude
 * Code hooks.json configures.
 */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@redspark/rsh-hooks-claude-code', targets: ['host'],
  requires: ['shell'], optional: ['tools', 'requestContexts', 'activeSessions'], provides: [],
  resolve(input) {
    const settings = readSettings(input, (message) => { console.warn(message) })
    return (context) => { if (settings !== undefined) install(context, settings) }
  },
}

/**
 * Answer the UserPromptSubmit hook for one admitted prompt.
 *
 * A prompt enters through step admission, so the hook runs there: it can reject the
 * prompt before any step opens, and its context joins the admitted batch. The
 * compatibility bridge instead fires a waterfall on the pre-step extension point;
 * this bridge observes the same decision with a `beforeStep` admission hook, which
 * is the Native Program's equivalent seam.
 * @param context - the installation's owned capabilities.
 * @param settings - validated bridge settings.
 * @param scope - installation scope the admission hook is registered under.
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
  const merged = await runPoint(context, settings, 'UserPromptSubmit', '',
    promptPayload(ask.owner.session, prompt), {
      session: ask.owner.session, turn: ask.turn, signal: ask.signal,
    })
  if (merged.decision === 'deny') return { kind: 'reject', discard: ask.candidates.map(message => message.id) }
  // Context alone is not a veto: DELEGATE so a later admission hook can still reject,
  // then fold our context onto its decision.
  const downstream = await next()
  if (downstream.kind !== 'enter') return downstream
  const ours = contextFrom(merged)
  if (ours === undefined) return downstream
  return { ...downstream, messages: [...downstream.messages, ours] }
}
