/** Cordis Client adapter for the shared Chat statistics view. */
import { memo, useMemo } from 'react'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatSnapshot } from '../contract/snapshot.ts'
import { assistantStepReading } from '../contract/turn-metrics.ts'
import type { ChatWindowStats } from '../../native-contracts.ts'
import { StatsPillsView } from './StatsPillsView.tsx'

export { billedInputTokens, cacheHitPercent, formatDuration, StatsPillsView } from './StatsPillsView.tsx'
export type { StatsPillsViewProps } from './StatsPillsView.tsx'

/** Fold Assistant and Tool-result nodes into window-scoped display totals.
 * @param nodes - the legacy Chat snapshot nodes.
 * @returns counts and summed wall times for the loaded window.
 */
export function deriveStats(nodes: ChatSnapshot['legacy']['nodes']): ChatWindowStats {
  const turns = new Set<number>()
  let steps = 0
  let llmMs = 0
  let toolMs = 0
  let ttftMs = 0
  let ttftSteps = 0
  let decodeMs = 0
  let decodeTokens = 0
  for (const node of nodes) {
    if (node.kind === 'tool-result') {
      if (node.callTime !== null) toolMs += Math.max(0, node.time - node.callTime)
      continue
    }
    if (node.kind !== 'assistant') continue
    turns.add(node.turn)
    steps += 1
    if (node.timing !== undefined && node.timing.stepStartTime !== null) {
      llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime)
    }
    const reading = assistantStepReading(node)
    if (reading.ttftMs !== null) {
      ttftMs += reading.ttftMs
      ttftSteps += 1
    }
    if (reading.decodeMs !== null && reading.outputTokens !== null) {
      decodeMs += reading.decodeMs
      decodeTokens += reading.outputTokens
    }
  }
  return { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }
}

/** Props supplied by the legacy Chat snapshot and projection hooks. */
export interface StatsPillsProps {
  /** Selected Chat snapshot. */
  useChat: SnapshotSelectorHook<ChatSnapshot>
  /** Whole-session statistics and token projections. */
  useProjection: UseProjection
  /** Chat locale seat. */
  t: ChatViewSlotProps['t']
}

/** Render the statistics view from Cordis Chat projections.
 * @param props - Chat snapshot, projection reader, and locale.
 * @returns the shared Chat statistics pills.
 */
export const StatsPills = memo(function StatsPills({ useChat, useProjection, t }: StatsPillsProps) {
  const settledNodes = useChat(s => s.legacy.nodes)
  const usage = useProjection('tokenUsage')
  const projected = useProjection('sessionStats')
  const stats = useMemo(() => projected ?? deriveStats(settledNodes), [projected, settledNodes])
  return <StatsPillsView stats={stats} usage={usage} t={t} />
})
