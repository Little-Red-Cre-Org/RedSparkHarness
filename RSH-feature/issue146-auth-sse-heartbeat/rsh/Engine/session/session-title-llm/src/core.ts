/**
 * Framework-free model-backed title generation shared by the Cordis
 * registration and native providers: configuration validation, the durable
 * pre-dispatch request record, JSON framing, the deadline, stream assembly,
 * and output validation.
 *
 * @module @deepseek-ai/dsh-session-title-llm/core
 */

import { createUserMessage, BlockAssembler } from '@deepseek-ai/dsh-llm/native'
import type { FinishReason, GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm/native'
import { deadline, MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { normalizeSessionTitle } from '@deepseek-ai/dsh-session-title/normalize'
import type {
  SessionTitleModelProvenance,
  SessionTitleProviderId,
  SessionTitleUserMessage,
} from '@deepseek-ai/dsh-session-title/types'

/** Exact model-visible request recorded before one auxiliary title dispatch. */
export interface SessionTitleLlmRequestEventData {
  /** Registered title-provider identity responsible for the request. */
  readonly titleProvider: SessionTitleProviderId
  /** Exact human `user/message` seqs represented in `messages`. */
  readonly messageSeqs: SessionSeq[]
  /** Exact auxiliary LLM route. */
  readonly route: SessionTitleModelProvenance
  /** Exact auxiliary system prompt. */
  readonly system: string
  /** Exact auxiliary message list. */
  readonly messages: Message[]
  /** Exact auxiliary output-token cap. */
  readonly maxTokens: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Log-only pre-dispatch record of one session-title model request. */
    'session/title-llm-request': SessionTitleLlmRequestEventData
  }
}

/** Capability-owned timeout reason code for auxiliary title requests. */
export const SESSION_TITLE_TIMEOUT_CODE = 'SESSION_TITLE_TIMEOUT'

/** Required deployment policy for one model-backed title plugin. */
export interface SessionTitleLlmConfig {
  /** Target word count for non-CJK titles. */
  readonly targetWords: number
  /** Target character count for Chinese, Japanese, or Korean titles. */
  readonly targetCjkCharacters: number
  /** Maximum UTF-8 bytes in the final JSON-framed user prompt. */
  readonly maxInputBytes: number
  /** Auxiliary generation output-token cap. */
  readonly maxOutputTokens: number
  /** End-to-end auxiliary request deadline in milliseconds. */
  readonly timeoutMs: number
  /** Optional explicit provider route; must be paired with `model`. */
  readonly provider?: string
  /** Optional explicit model id; must be paired with `provider`. */
  readonly model?: string
}

/** Validated immutable model-provider policy. */
export interface ResolvedSessionTitleLlmConfig extends SessionTitleLlmConfig {}

/** Complete configuration key set for direct construction validation. */
const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'targetWords',
  'targetCjkCharacters',
  'maxInputBytes',
  'maxOutputTokens',
  'timeoutMs',
  'provider',
  'model',
])

/** Validate one positive integer limit. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`session-title-llm: ${name} must be a positive integer`)
  }
}

/**
 * Validate and detach required model-provider configuration.
 * @param config - untrusted plugin configuration.
 * @returns immutable policy with optional route absence preserved.
 */
export function resolveSessionTitleLlmConfig(
  config: SessionTitleLlmConfig,
): ResolvedSessionTitleLlmConfig {
  const candidate: unknown = config
  if (candidate === null || typeof candidate !== 'object') {
    throw new Error('session-title-llm: configuration is required')
  }
  const value = candidate as SessionTitleLlmConfig
  for (const key of Object.keys(value)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`session-title-llm: unknown config key "${key}"`)
  }
  assertPositiveInteger('targetWords', value.targetWords)
  assertPositiveInteger('targetCjkCharacters', value.targetCjkCharacters)
  assertPositiveInteger('maxInputBytes', value.maxInputBytes)
  assertPositiveInteger('maxOutputTokens', value.maxOutputTokens)
  assertPositiveInteger('timeoutMs', value.timeoutMs)
  if (value.timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`session-title-llm: timeoutMs must not exceed ${MAX_TIMER_DELAY_MS}`)
  }
  const hasProvider = value.provider !== undefined
  const hasModel = value.model !== undefined
  if (hasProvider !== hasModel) {
    throw new Error('session-title-llm: provider and model must be supplied together')
  }
  if (hasProvider
    && (typeof value.provider !== 'string' || value.provider.length === 0
      || typeof value.model !== 'string' || value.model.length === 0)) {
    throw new Error('session-title-llm: provider and model overrides must be non-empty strings')
  }
  return deepFreeze({ ...value })
}

/** Select the provider-owned message subset from one fixed service revision. */
export type SessionTitleLlmMessageSelector = (
  messages: readonly SessionTitleUserMessage[],
) => readonly SessionTitleUserMessage[]

/** Resolve the explicit pair or the exact route captured from `request/header`. */
function resolveRoute(
  config: ResolvedSessionTitleLlmConfig,
  request: SessionTitleLlmRequest,
): SessionTitleModelProvenance {
  if (config.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model }
  }
  if (request.route === undefined) {
    throw new Error('session-title-llm: no logged request route is available; configure provider and model together')
  }
  return request.route
}

/** Stable language-aware system instruction shared by both provider plugins. */
function systemPrompt(config: ResolvedSessionTitleLlmConfig): string {
  return [
    'Create a concise title for an AI coding-assistant session from the supplied human messages.',
    'Return only the title on one line, **in plain text of natural language**, with no quotes, prefix, explanation, Markdown, XML, or terminal control codes. No code is allowed.',
    'Use the language of the messages.',
    `Aim for about ${config.targetWords} words in non-CJK languages or ${config.targetCjkCharacters} CJK characters.`,
  ].join('\n')
}

/** Frame exact messages as JSON so user text cannot break structural delimiters. */
function frameMessages(messages: readonly SessionTitleUserMessage[]): string {
  return `Generate the session title from this JSON array of human messages:\n${JSON.stringify(messages)}`
}

/** Translate terminal finish reasons into an auxiliary-call failure. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('session-title-llm: title output reached maxOutputTokens')
    case 'tool-calls':
      return new Error('session-title-llm: title model unexpectedly requested a tool')
    default:
      return new Error(`session-title-llm: unsupported finish reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}

/** Framework-neutral input to one auxiliary title generation. */
export interface SessionTitleLlmRequest {
  /** Session whose title is generated; recorded as the request's session id. */
  readonly sessionId: SessionId
  /** Exact logged main-request route, when one has been recorded. */
  readonly route?: SessionTitleModelProvenance
  /** Supersession, disposal, or caller cancellation. */
  readonly signal: AbortSignal
}

/** Host operations that dispatch the request and record it before dispatch. */
export interface SessionTitleLlmHost {
  /**
   * Stream one auxiliary model request.
   * @param options - frozen request options.
   * @returns the model stream.
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
  /**
   * Record the exact request durably before dispatch.
   * @param data - `session/title-llm-request` payload.
   */
  record(data: SessionTitleLlmRequestEventData): void | Promise<void>
}

/** Generated title, exact source seqs, and the route used. */
export interface SessionTitleLlmResult {
  readonly title: string
  readonly messageSeqs: readonly SessionSeq[]
  readonly model: SessionTitleModelProvenance
}

/**
 * Generate one title through the shared auxiliary model call.
 * @param host - stream dispatch and durable pre-dispatch record.
 * @param config - validated model-provider policy.
 * @param request - Session identity, route, and cancellation.
 * @param selectedMessages - exact provider-selected subset to frame and attribute.
 * @param titleProvider - registered title-provider identity recorded with the request.
 * @returns normalized non-empty title, exact source seqs, and used model route.
 */
export async function generateSessionTitle(
  host: SessionTitleLlmHost,
  config: ResolvedSessionTitleLlmConfig,
  request: SessionTitleLlmRequest,
  selectedMessages: readonly SessionTitleUserMessage[],
  titleProvider: SessionTitleProviderId,
): Promise<SessionTitleLlmResult> {
  request.signal.throwIfAborted()
  if (selectedMessages.length === 0) {
    throw new Error('session-title-llm: at least one source message is required')
  }
  const framedInput = frameMessages(selectedMessages)
  const inputBytes = Buffer.byteLength(framedInput, 'utf8')
  if (inputBytes > config.maxInputBytes) {
    throw new Error(`session-title-llm: input is ${inputBytes} bytes, exceeding maxInputBytes ${config.maxInputBytes}`)
  }
  const route = resolveRoute(config, request)
  const messages: Message[] = [createUserMessage({
    content: [{ type: 'text', text: framedInput }],
    source: { kind: 'plugin', plugin: 'dsh-session-title-llm' },
  })]
  const system = systemPrompt(config)
  using callDeadline = deadline(request.signal, config.timeoutMs, SESSION_TITLE_TIMEOUT_CODE)
  const options: GenerateOptions = deepFreeze({
    provider: route.provider,
    model: route.model,
    messages,
    system,
    maxTokens: config.maxOutputTokens,
    sessionId: request.sessionId,
    purpose: 'session-title',
    signal: callDeadline.signal,
  })
  await host.record({
    titleProvider,
    messageSeqs: selectedMessages.map(message => message.seq),
    route,
    system,
    messages,
    maxTokens: config.maxOutputTokens,
  })
  callDeadline.signal.throwIfAborted()
  const assembler = new BlockAssembler()
  for await (const chunk of host.stream(options)) {
    callDeadline.signal.throwIfAborted()
    assembler.push(chunk)
  }
  callDeadline.signal.throwIfAborted()
  const terminalError = finishError(assembler.finish)
  if (terminalError !== undefined) throw terminalError
  const blocks = assembler.blocks()
  if (blocks.some(block => block.type === 'tool-call')) {
    throw new Error('session-title-llm: title output must contain text only')
  }
  const text = blocks
    .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(' ')
  const title = normalizeSessionTitle(text, Number.MAX_SAFE_INTEGER)
  if (title.length === 0) throw new Error('session-title-llm: title model produced no text')
  return {
    title,
    messageSeqs: selectedMessages.map(message => message.seq),
    model: route,
  }
}

/**
 * Select only the first eligible human message.
 * @param messages - eligible messages through the revision.
 * @returns the first message.
 */
export function selectFirstPrompt(messages: readonly SessionTitleUserMessage[]): readonly SessionTitleUserMessage[] {
  const first = messages[0]
  if (first === undefined) throw new Error('first-prompt title provider requires one human message')
  return [first]
}

/**
 * Select every eligible human message.
 * @param messages - eligible messages through the revision.
 * @returns the same messages.
 */
export function selectAllPrompts(messages: readonly SessionTitleUserMessage[]): readonly SessionTitleUserMessage[] {
  return messages
}
