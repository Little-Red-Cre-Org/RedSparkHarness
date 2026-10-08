/**
 * Shared route, framing, timeout, assembly, and validation policy for
 * model-backed session-title providers.
 * @module @deepseek-ai/dsh-session-title-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { SessionTitleProviderId } from '@deepseek-ai/dsh-session-title'
import type {
  SessionTitleAutomaticMode,
  SessionTitleProviderRequest,
  SessionTitleProviderResult,
  SessionTitleUserMessage,
} from '@deepseek-ai/dsh-session-title'
import {
  generateSessionTitle,
  resolveSessionTitleLlmConfig,
  type ResolvedSessionTitleLlmConfig,
  type SessionTitleLlmConfig,
  type SessionTitleLlmMessageSelector,
} from './core.ts'

export {
  generateSessionTitle,
  resolveSessionTitleLlmConfig,
  selectAllPrompts,
  selectFirstPrompt,
  SESSION_TITLE_TIMEOUT_CODE,
} from './core.ts'
export type {
  ResolvedSessionTitleLlmConfig,
  SessionTitleLlmConfig,
  SessionTitleLlmHost,
  SessionTitleLlmMessageSelector,
  SessionTitleLlmRequest,
  SessionTitleLlmRequestEventData,
  SessionTitleLlmResult,
} from './core.ts'

/** Shared Loader field schemas with no library defaults. */
export const SessionTitleLlmConfigFields = {
  targetWords: z.number().step(1).min(1).required(),
  targetCjkCharacters: z.number().step(1).min(1).required(),
  maxInputBytes: z.number().step(1).min(1).required(),
  maxOutputTokens: z.number().step(1).min(1).required(),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
  provider: z.string(),
  model: z.string(),
}

/** Shared Loader schema with no library defaults. */
export const SessionTitleLlmConfigSchema: z<SessionTitleLlmConfig> = z.object(SessionTitleLlmConfigFields)

/**
 * Register one model-backed provider through the shared configuration and call policy.
 * @param ctx - context exposing the title and LLM services.
 * @param config - untrusted required deployment policy.
 * @param id - stable plugin id recorded with generated titles.
 * @param automatic - provider-owned automatic generation cadence.
 * @param selectMessages - exact source-message selection for one revision.
 */
export function registerSessionTitleLlmProvider(
  ctx: Context,
  config: SessionTitleLlmConfig,
  id: string,
  automatic: SessionTitleAutomaticMode,
  selectMessages: SessionTitleLlmMessageSelector,
): void {
  const resolved = resolveSessionTitleLlmConfig(config)
  const titleProvider = SessionTitleProviderId(id)
  ctx.sessionTitle.register({
    id: titleProvider,
    automatic,
    async generate(request) {
      return generateSessionTitleWithLlm(ctx, resolved, request, selectMessages(request.messages), titleProvider)
    },
  })
}

/**
 * Generate one title through the shared auxiliary LLM call.
 * @param ctx - context exposing the registered LLM service.
 * @param config - validated model-provider policy.
 * @param request - service-owned session, route, message snapshot, and cancellation.
 * @param selectedMessages - exact provider-selected subset to frame and attribute.
 * @param titleProvider - registered title-provider identity recorded with the request.
 * @returns normalized non-empty title, exact source seqs, and used model route.
 */
export async function generateSessionTitleWithLlm(
  ctx: Context,
  config: ResolvedSessionTitleLlmConfig,
  request: SessionTitleProviderRequest,
  selectedMessages: readonly SessionTitleUserMessage[],
  titleProvider: SessionTitleProviderId,
): Promise<SessionTitleProviderResult> {
  return generateSessionTitle({
    stream: options => ctx.llm.stream(options),
    record: (data) => { request.session.append('session/title-llm-request', data) },
  }, config, {
    sessionId: request.session.id,
    ...request.route === undefined ? {} : { route: request.route },
    signal: request.signal,
  }, selectedMessages, titleProvider)
}
