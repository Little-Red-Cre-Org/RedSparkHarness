/**
 * Trigger detection pure core. Scans backward from
 * the caret for a live trigger char under the guard tier and applies the
 * word-boundary rules. Zero React / DOM / cordis.
 */
import { activeAtToken } from '@redspark/rsh-file-reference/grammar'
import { slashTokenAt } from '@redspark/rsh-client-ui-primitives'
import type { DetectTrigger } from './contract.ts'

/**
 * Detect a trigger token at the caret. `@` first uses the shared grammar,
 * including an open quoted token that may span whitespace.
 *
 * `/` delegates to the shared slash grammar in `ui-primitives`, which the
 * Native composer palette reads too, so both surfaces apply one boundary rule.
 * This module adds only what belongs to detection: the guard tier and the
 * leading/inline position. A claimed tier suppresses `/` outright, which is
 * why it does not need the slash scan at all.
 *
 * Guard tiers: plain = both chars live; claimed = `/` fully suppressed,
 * `@` live; frozen = none.
 *
 * @param draft - Full draft text.
 * @param caret - Caret offset into `draft`.
 * @param guard - Availability tier derived from the input phase.
 * @returns The hit with `query` = trigger-to-caret slice and `span` =
 * `{start: triggerIndex, end: caret}`; `span.draftRev` is a placeholder `0`
 * — the calling shell stamps the real revision. Null when no trigger is
 * live at the caret.
 */
export const detectTrigger: DetectTrigger = (draft, caret, guard) => {
  if (guard.tier === 'frozen') return null
  const at = activeAtToken(draft, caret)
  if (at !== undefined) {
    const start = caret - at.prefix.length
    return {
      trigger: '@',
      query: at.query,
      quoted: at.quoted,
      position: draft.search(/\S/u) === start ? 'leading' : 'inline',
      span: { start, end: caret, draftRev: 0 },
    }
  }
  if (guard.tier === 'claimed') return null
  const slash = slashTokenAt(draft, caret)
  if (slash === null) return null
  return {
    trigger: '/',
    query: slash.query,
    quoted: false,
    position: draft.search(/\S/u) === slash.start ? 'leading' : 'inline',
    span: { start: slash.start, end: slash.end, draftRev: 0 },
  }
}
