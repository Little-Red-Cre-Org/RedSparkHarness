/**
 * Conversation call configuration and freeze utilities. Provider routing,
 * model, reasoning effort, and sampling values are request-header state that
 * can affect cache reuse; request waterfalls replace them and the loop logs
 * changed snapshots instead of allowing silent per-call drift.
 * @module dsh-llm/call-config
 */

import { LlmError } from './error.ts'
import type { LlmResolvedModelInfo, GenerateOptions } from './types.ts'
import type { ReasoningEffortId } from './brand.ts'

/** Process-local identities of request objects assembled by dsh-agent-loop. */
const AGENT_LOOP_REQUESTS = new WeakSet<GenerateOptions>()

// TODO(call-config-shape): Revisit which fields are epoch-level for cache reuse
// and where provider-specific request options belong.
/**
 * Provider, model, reasoning effort, and sampling scalars of one conversation's
 * requests. Every field maps 1:1 onto the same-named `GenerateOptions` field;
 * the loop builds requests from the logged header rather than accepting these
 * per call.
 */
export interface LlmCallConfig {
  provider: string
  model: string
  reasoningEffort?: ReasoningEffortId
  temperature?: number
  maxTokens?: number
  stop?: string[]
}

/**
 * Effective config fields supplied by exact-model adapter resolution rather
 * than by the caller's request proposal.
 */
export interface LlmCallConfigAdapterDefaults {
  reasoningEffort?: true
  maxTokens?: true
}

/** Resolve request controls against metadata captured from its dispatch generation.
 * @param config - selected route and explicit request controls.
 * @param info - exact model metadata bound to that route's eventual dispatch.
 * @returns request controls with declared defaults; unsupported reasoning rejects.
 */
export function resolveCallConfigWithModel(config: LlmCallConfig, info: LlmResolvedModelInfo): LlmCallConfig {
  const defaulted = config.maxTokens === undefined && info.defaultMaxTokens !== undefined
    ? { ...config, maxTokens: info.defaultMaxTokens }
    : config
  const reasoning = info.reasoning
  const requested = defaulted.reasoningEffort
  let resolvedConfig = defaulted
  if (reasoning === undefined) {
    if (requested !== undefined) {
      throw new LlmError(
        `provider "${config.provider}" model "${config.model}" does not support reasoning effort "${requested}"`,
        'UNSUPPORTED_REASONING_EFFORT',
      )
    }
  } else {
    const effective = requested ?? reasoning.defaultEffort
    if (effective !== undefined) {
      if (!reasoning.efforts.some(effort => effort.id === effective)) {
        throw new LlmError(
          `provider "${config.provider}" model "${config.model}" does not support reasoning effort "${effective}"`,
          'UNSUPPORTED_REASONING_EFFORT',
        )
      }
      if (requested !== effective) resolvedConfig = { ...defaulted, reasoningEffort: effective }
    }
  }
  return resolvedConfig
}


/**
 * Field-wise equality over {@link LlmCallConfig} — the comparison a caller
 * runs to decide whether a proposed configuration is a real change (worth a
 * logged header snapshot) or the held one restated.
 * @param a - one configuration.
 * @param b - the other.
 * @returns whether every field (including the `stop` list, element-wise) matches.
 */
export function callConfigEquals(a: LlmCallConfig, b: LlmCallConfig): boolean {
  if (
    a.provider !== b.provider
    || a.model !== b.model
    || a.reasoningEffort !== b.reasoningEffort
    || a.temperature !== b.temperature
    || a.maxTokens !== b.maxTokens
  ) return false
  if (a.stop === undefined || b.stop === undefined) return a.stop === b.stop
  return a.stop.length === b.stop.length && a.stop.every((s, i) => s === b.stop?.[i])
}

/**
 * Mark one exact request object as assembled by dsh-agent-loop.
 * @param request - loop-owned request envelope before LLM dispatch.
 * @returns the same request object marked as created by the process-local agent loop.
 */
export function markAgentLoopRequest<T extends GenerateOptions>(request: T): T {
  AGENT_LOOP_REQUESTS.add(request)
  return request
}

/**
 * Test whether the exact request object was assembled by dsh-agent-loop.
 * @param request - request envelope observed at the LLM waterfall.
 * @returns whether {@link markAgentLoopRequest} recorded this object.
 */
export function isAgentLoopRequest(request: GenerateOptions): boolean {
  return AGENT_LOOP_REQUESTS.has(request)
}
