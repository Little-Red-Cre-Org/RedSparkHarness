/**
 * Render the context report the `/context` command shows.
 *
 * The report is plain text on purpose: it renders identically in a terminal, in the Web
 * transcript and in a log excerpt, and it never needs a client component to be readable. Numbers
 * come from the composition and request projections, so the command and any future dashboard
 * cannot disagree about the same Session.
 *
 * @module @deepseek-ai/dsh-context-insight/report
 */

import type { CompositionCategory, CompositionState } from './composition.ts'
import type { RequestHistoryState } from './requests.ts'

/** Everything the report needs, kept separate from the Agent so it can be tested directly. */
export interface ContextReportInput {
  readonly composition: CompositionState
  readonly requests: RequestHistoryState
}

/** Human-facing label for one category. */
const CATEGORY_LABEL: Readonly<Record<CompositionCategory, string>> = {
  system: 'System prompt',
  tools: 'Tool schemas',
  user: 'Your messages',
  inject: 'Plugin injections',
  skill: 'Skill loads',
  assistant: 'Assistant output',
  tool: 'Tool results',
}

/** Categories in the order a reader expects: what the harness adds, then the conversation. */
const CATEGORY_ORDER: readonly CompositionCategory[] = ['system', 'tools', 'inject', 'skill', 'user', 'assistant', 'tool']

/** A thousands separator, because six-digit character counts are unreadable without one. */
function count(value: number): string {
  return value.toLocaleString('en-US')
}

/** Share of the total, as a whole percent; zero totals never produce NaN. */
function share(value: number, total: number): string {
  if (total === 0) return '0%'
  return `${Math.round(value / total * 100)}%`
}

/** A fixed-width bar so the composition reads at a glance in a monospaced surface. */
function bar(value: number, total: number, width = 18): string {
  if (total === 0) return ' '.repeat(width)
  const filled = Math.round(value / total * width)
  return '█'.repeat(filled) + '·'.repeat(Math.max(0, width - filled))
}

/** Rough token estimate. Characters over four is the long-standing English approximation. */
function tokens(chars: number): number {
  return Math.round(chars / 4)
}

/**
 * Format one Session's context composition and growth.
 * @param input - the projection states to render.
 * @returns the report text.
 */
export function formatContextReport(input: ContextReportInput): string {
  const { composition, requests } = input
  const total = CATEGORY_ORDER.reduce((sum, category) => sum + composition.totals[category], 0)
  const provider = composition.provider
  const model = composition.model
  const lines: string[] = []

  lines.push('Context')
  lines.push('')
  if (provider !== undefined || model !== undefined) {
    const effort = composition.reasoningEffort === undefined ? '' : ` · effort ${composition.reasoningEffort}`
    lines.push(`  Route      ${provider ?? '?'} / ${model ?? '?'}${effort}`)
  }
  if (composition.contextWindow !== undefined) {
    lines.push(`  Window     ${count(composition.contextWindow)} tokens`)
  }
  lines.push(`  Turns      ${count(composition.turns)}    Steps ${count(composition.steps)}    Requests ${count(requests.rows.length)}`)
  lines.push('')

  lines.push(`Composition — ${count(total)} chars ≈ ${count(tokens(total))} tokens`)
  lines.push('')
  const width = Math.max(...CATEGORY_ORDER.map(category => CATEGORY_LABEL[category].length))
  for (const category of CATEGORY_ORDER) {
    const value = composition.totals[category]
    const label = CATEGORY_LABEL[category].padEnd(width)
    lines.push(`  ${label}  ${bar(value, total)}  ${count(value).padStart(9)}  ${share(value, total).padStart(4)}`)
  }

  if (requests.rows.length > 0) {
    lines.push('')
    lines.push('Growth')
    lines.push('')
    // The last few requests are what a reader can still act on; the whole history stays in the
    // projection for a dashboard that wants to chart it.
    const recent = requests.rows.slice(-5)
    for (const row of recent) {
      const boundary = row.startsSeries ? '│ ' : '  '
      const route = row.model === undefined ? '' : ` ${row.model}`
      lines.push(`  ${boundary}#${row.seq}  ${row.reason.padEnd(7)} tools ${String(row.tools).padStart(3)}${route}`)
    }
  }

  return lines.join('\n')
}
