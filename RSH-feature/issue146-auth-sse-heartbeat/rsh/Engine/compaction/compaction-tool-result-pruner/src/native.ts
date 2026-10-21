/**
 * Native tool-result pruner Definition and Provider over the shared
 * head/middle/tail pruning and shadow-price protocol.
 * @module @deepseek-ai/dsh-compaction-tool-result-pruner/native
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm/native'
import type { Session } from '@deepseek-ai/dsh-session/native'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {} from '@deepseek-ai/dsh-token-meter/native'
import { resolveConfig } from './config.ts'
import { measureContent, pruneContent, pruneSessionSurface } from './core.ts'
import type { PruneResult, ResolvedConfig } from './types.ts'

export { codePointLength, DEFAULTS, PRUNE_MARKER, resolveConfig } from './config.ts'
export type { PrunedEntry, PruneResult, ResolvedConfig, ToolResultPruneConfig } from './types.ts'

/** Live Session access one native pruning pass writes through. */
export interface NativePruneOwner {
  readonly session: Session
  /** Append through the Program's sole retained Session writer. */
  readonly append: Session['append']
}

/** Native deterministic pruning over current tool-result surface nodes. */
export interface NativeToolResultPrunerOperations {
  /** Validated, deeply immutable character budgets. */
  readonly config: ResolvedConfig
  /**
   * @param blocks - tool-result content to measure.
   * @returns total Unicode code points across text blocks.
   */
  measureContent(blocks: readonly ContentBlock[]): number
  /**
   * @param blocks - original tool-result content.
   * @returns pruned content, or `null` when the text is within budget.
   */
  pruneContent(blocks: readonly ContentBlock[]): ContentBlock[] | null
  /**
   * Prune every over-budget tool result in one stable surface snapshot; each
   * replacement follows its `compaction/prune` shadow-price event.
   * @param owner - live Session and its sole writer.
   * @returns landed replacements and aggregate Unicode-code-point savings.
   * @throws when the Session rejects a replacement; earlier replacements stay durable.
   */
  pruneSession(owner: NativePruneOwner): PruneResult
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { toolResultPruner: NativeToolResultPrunerOperations }
}

/**
 * Validate native pruner configuration.
 * @param input - raw installation config.
 * @returns validated character budgets.
 * @throws when the input is not a plain object or a budget is invalid.
 */
export function resolveNativeToolResultPrunerConfig(input: unknown): ResolvedConfig {
  if (input === undefined) return resolveConfig()
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('tool-result-pruner: native configuration must be an object')
  }
  return resolveConfig(input)
}

/** Install the deterministic pruner over the selected token meter. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-compaction-tool-result-pruner', targets: ['host'],
  requires: ['tokenMeter'], provides: ['toolResultPruner'],
  resolve(input) {
    const config = resolveNativeToolResultPrunerConfig(input)
    return (context) => {
      const meter = context.require('tokenMeter')
      context.provide('toolResultPruner', {
        config,
        measureContent,
        pruneContent: blocks => pruneContent(config, blocks),
        pruneSession: owner => pruneSessionSurface(config, {
          session: owner.session,
          append: owner.append,
          estimateMessage: message => meter.estimateMessage(message),
        }),
      })
    }
  },
}
