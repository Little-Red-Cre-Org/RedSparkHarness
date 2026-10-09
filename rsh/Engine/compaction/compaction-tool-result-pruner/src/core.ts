/**
 * Cordis-free tool-result pruning shared by the Cordis Service and the native
 * Provider: deterministic head/middle/tail content replacement and the
 * shadow-price protocol for one stable surface snapshot.
 */

import { freezeMessage } from '@deepseek-ai/dsh-llm/native'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm/native'
import type { Session, SessionEvent, SessionSeq, ToolResultMessage } from '@deepseek-ai/dsh-session/native'
// Type-only: the `compaction/*` SessionEventMap merges (the shadow-price event).
import type {} from '@deepseek-ai/dsh-compaction/native'
import { codePointLength, PRUNE_MARKER } from './config.ts'
import type { PrunedEntry, PruneResult, ResolvedConfig } from './types.ts'

/** Session access and pricing one pruning pass writes through. */
export interface PruneTarget {
  readonly session: Session
  /** Append through the caller's sole Session writer. */
  readonly append: Session['append']
  /**
   * Price one shadowed model-visible message for its `compaction/prune` event.
   * @param message - the full-fidelity message being shadowed.
   * @returns its fixed-heuristic token price.
   */
  estimateMessage(message: Message): number
}

interface SnapshotCandidate {
  readonly seq: SessionSeq
  readonly event: SessionEvent<'tool/result'>
}

/**
 * Measure text content in Unicode code points; non-text blocks cost zero.
 * @param blocks - tool-result content to measure.
 * @returns total Unicode code points across text blocks.
 */
export function measureContent(blocks: readonly ContentBlock[]): number {
  let chars = 0
  for (const block of blocks) {
    if (block.type === 'text') chars += codePointLength(block.text)
  }
  return chars
}

/**
 * Replace an over-budget text middle while retaining rich-block order.
 * Text slicing is by Unicode code point, not UTF-16 code unit, so a retained
 * boundary cannot split a surrogate pair. Grapheme clusters may still split.
 * @param config - validated character budgets.
 * @param blocks - original tool-result content.
 * @returns pruned content, or `null` when the text is within budget.
 */
export function pruneContent(config: ResolvedConfig, blocks: readonly ContentBlock[]): ContentBlock[] | null {
  const totalChars = measureContent(blocks)
  if (totalChars <= config.thresholdChars) return null

  const removedStart = config.headChars
  const removedEnd = totalChars - config.tailChars
  const pruned: ContentBlock[] = []
  let consumed = 0
  let markerInserted = false

  for (const block of blocks) {
    if (block.type !== 'text') {
      pruned.push(block)
      continue
    }

    const points = Array.from(block.text)
    const blockStart = consumed
    const blockEnd = blockStart + points.length
    const headEnd = Math.min(points.length, Math.max(0, removedStart - blockStart))
    const tailStart = Math.min(points.length, Math.max(0, removedEnd - blockStart))
    const intersectsRemoved = blockStart < removedEnd && blockEnd > removedStart
    const marker = intersectsRemoved && !markerInserted ? PRUNE_MARKER : ''
    if (marker.length > 0) markerInserted = true
    const text = points.slice(0, headEnd).join('')
      + marker
      + points.slice(tailStart).join('')
    if (text.length > 0) pruned.push({ ...block, text })
    consumed = blockEnd
  }

  /* v8 ignore next -- totalChars > threshold and valid budgets guarantee a removed text span. */
  if (!markerInserted) throw new Error('tool-result prune: failed to locate the removed text span')
  const charsAfter = measureContent(pruned)
  /* v8 ignore next -- config validation fixes the emitted head + marker + tail budget. */
  if (charsAfter > config.thresholdChars || charsAfter >= totalChars) {
    throw new Error('tool-result prune: replacement must be smaller and within threshold')
  }
  return pruned
}

/**
 * Prune every over-budget tool result from one stable current-surface snapshot.
 * Each replacement preserves the complete event data except for `content`,
 * cites the shadowed node so replay can recover the replacement input, and is
 * immediately preceded by a `compaction/prune` shadow-price event pricing the
 * shadowed node, so pure consumers can subtract it without per-node state.
 * @param config - validated character budgets.
 * @param target - Session, writer and pricing used by this pass.
 * @returns landed replacements and aggregate Unicode-code-point savings.
 * @throws when the session rejects a replacement; replacements committed
 * earlier in the pass remain durable.
 */
export function pruneSessionSurface(config: ResolvedConfig, target: PruneTarget): PruneResult {
  const { session } = target
  const candidates: SnapshotCandidate[] = []
  for (const seq of [...session.surface.nodes]) {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const event = session.eventAt(seq)
    /* v8 ignore next -- surface seqs are validated contiguous log references. */
    if (event?.type === 'tool/result') candidates.push({ seq, event })
  }

  const pruned: PrunedEntry[] = []
  let charsRemoved = 0
  for (const { seq, event } of candidates) {
    const result = event.data.message.content[0]
    const content = pruneContent(config, result.content)
    if (content === null) continue
    const charsBefore = measureContent(result.content)
    const charsAfter = measureContent(content)
    const message = freezeMessage<ToolResultMessage>({
      ...event.data.message,
      content: [{
        ...result,
        content,
      }] as [typeof result],
    })
    // Shadow-price protocol: the metering event and its replacement are
    // appended synchronously adjacent, so pure consumers subtract the
    // shadowed node's heuristic price without retaining per-node state.
    target.append('compaction/prune', {
      shadowedRange: { start: seq, end: seq },
      shadowedSeqs: [seq],
      shadowedTokenCount: target.estimateMessage(event.data.message),
    })
    const replacement = target.append('tool/result', {
      ...event.data,
      message,
    }, {
      surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq },
      sourceEventSeqs: [seq],
    })
    pruned.push({
      originalSeq: seq,
      replacementSeq: replacement.seq,
      callId: event.data.message.source.callId,
      charsBefore,
      charsAfter,
    })
    charsRemoved += charsBefore - charsAfter
  }
  return { pruned, charsRemoved }
}
