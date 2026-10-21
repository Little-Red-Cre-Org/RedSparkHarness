/** Framework-neutral fixed Ralph script, terminal validation and model output. */
import type { WorkflowResult } from '@deepseek-ai/dsh-workflow/types'

type RalphRoundStatus = 'continue' | 'complete' | 'blocked'

interface RalphRoundReport {
  readonly status: RalphRoundStatus
  readonly summary: string
  readonly evidence: string[]
  readonly nextSteps: string[]
  readonly blocker: string
}

type RalphRunStatus = 'complete' | 'blocked' | 'budget-limited'

/** Worker-reported terminal progress after a bounded series of fresh children. */
export interface RalphRunResult {
  readonly status: RalphRunStatus
  readonly roundsStarted: number
  readonly report: RalphRoundReport
}

interface RalphRoundFailure {
  readonly status: 'round-failed'
  readonly roundsStarted: number
  readonly lastReport?: RalphRoundReport
}

type RalphTerminalResult = RalphRunResult | RalphRoundFailure

/** Fixed identity and progress phase for the deployment-owned script. */
export const RALPH_META = {
  name: 'ralph-loop',
  description: 'Iterate toward one objective with a fresh child and bounded structured handoff per round.',
  phases: [{ title: 'Fresh-agent rounds', detail: 'One clean child context per Ralph round.' }],
}

/**
 * Fixed, deployment-owned orchestration. The model supplies data only; it
 * cannot alter the loop, provider route, schema, or handoff validation.
 */
export const RALPH_SCRIPT = String.raw`
const reportSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['continue', 'complete', 'blocked'] },
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    nextSteps: { type: 'array', items: { type: 'string' } },
    blocker: { type: 'string' },
  },
  required: ['status', 'summary', 'evidence', 'nextSteps', 'blocker'],
  additionalProperties: false,
}

function normalizedText(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}

function normalizedList(value) {
  return Array.isArray(value) && value.every(normalizedText)
}

function validateReport(report) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('Ralph child returned no structured round report')
  }
  if (!normalizedText(report.summary)) {
    throw new Error('Ralph round report summary must be non-empty and normalized')
  }
  if (!normalizedList(report.evidence) || !normalizedList(report.nextSteps)) {
    throw new Error('Ralph round report evidence and nextSteps must contain only non-empty normalized strings')
  }
  if (typeof report.blocker !== 'string' || report.blocker !== report.blocker.trim()) {
    throw new Error('Ralph round report blocker must be a normalized string')
  }
  switch (report.status) {
    case 'continue':
      if (report.nextSteps.length === 0 || report.blocker !== '') {
        throw new Error('a continuing Ralph report needs nextSteps and an empty blocker')
      }
      break
    case 'complete':
      if (report.evidence.length === 0 || report.nextSteps.length !== 0 || report.blocker !== '') {
        throw new Error('a complete Ralph report needs evidence, no nextSteps, and an empty blocker')
      }
      break
    case 'blocked':
      if (!normalizedText(report.blocker)) {
        throw new Error('a blocked Ralph report needs a concrete blocker')
      }
      break
    default:
      throw new Error('Ralph round report status is invalid')
  }
  const serialized = JSON.stringify(report)
  if (serialized.length > args.maxHandoffChars) {
    throw new Error('Ralph round report exceeds maxHandoffChars (' + serialized.length + ' > ' + args.maxHandoffChars + ')')
  }
  return report
}

let previous
phase('Fresh-agent rounds')
for (let round = 1; round <= args.maxRounds; round += 1) {
  const prior = previous === undefined ? '(none — this is the first round)' : JSON.stringify(previous)
  const prompt = [
    'You are one fresh worker in a foreground Ralph loop. You receive no parent conversation and no prior child session. Do not call the ralph tool: this round already is its worker.',
    'Immutable objective:\n' + args.objective,
    'Ralph round: ' + round + ' of ' + args.maxRounds + '.',
    'The shared workspace and its current working tree are the long-term memory and source of truth. Inspect them before acting, preserve existing work, perform concrete in-scope work, and verify what you change. Treat the previous report only as a bounded handoff; confirm it against the workspace.',
    'Previous structured handoff:\n' + prior,
    'Return one report with exact normalized strings. Use status continue with at least one nextSteps entry while useful work remains; complete only with concrete evidence and no nextSteps; blocked only when no meaningful progress is possible without human input or an external-state change. blocker must be empty unless blocked.',
  ].join('\n\n')
  const rawReport = await agent(prompt, {
    label: 'Ralph round ' + round,
    phase: 'Fresh-agent rounds',
    schema: reportSchema,
  })
  if (rawReport === null) {
    return { status: 'round-failed', roundsStarted: round, lastReport: previous ?? null }
  }
  const report = validateReport(rawReport)
  if (report.status === 'complete') return { status: 'complete', roundsStarted: round, report }
  if (report.status === 'blocked') return { status: 'blocked', roundsStarted: round, report }
  previous = report
}
return { status: 'budget-limited', roundsStarted: args.maxRounds, report: previous }
`

/** Model-visible purpose and explicit-human-request usage policy. */
export const DESCRIPTION = 'Run a foreground fresh-agent Ralph loop toward one immutable objective. '
  + 'Use only when the direct human explicitly asks for Ralph or fresh-agent iteration. Each round '
  + 'opens a new child with no parent conversation or prior child session; the shared workspace is '
  + 'long-term memory, and only a bounded structured report crosses rounds. The call returns when '
  + 'a worker reports completion or a concrete blocker, or at the round limit. Ordinary long-running same-session work '
  + 'belongs to goal tools.'

/** Resolve one model-selected cap against the deployment ceiling.
 * @param requested - optional caller-selected round limit.
 * @param ceiling - positive deployment limit.
 * @returns admitted positive round limit.
 */
export function resolveMaxRounds(requested: number | undefined, ceiling: number): number {
  const value = requested ?? ceiling
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('Ralph maxRounds must be a positive safe integer')
  }
  if (value > ceiling) {
    throw new TypeError(`Ralph maxRounds ${value} exceeds the deployment ceiling ${ceiling}`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizedText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}

function normalizedList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(normalizedText)
}

/** Defensively decode the fixed script's report across a provider boundary. */
function readReport(value: unknown, expectedStatus: RalphRoundStatus, maxChars: number): RalphRoundReport {
  if (!isRecord(value)
    || Object.keys(value).sort().join(',') !== 'blocker,evidence,nextSteps,status,summary'
    || value['status'] !== expectedStatus
    || !normalizedText(value['summary'])
    || !normalizedList(value['evidence'])
    || !normalizedList(value['nextSteps'])
    || typeof value['blocker'] !== 'string'
    || value['blocker'] !== value['blocker'].trim()) {
    throw new Error('Ralph workflow returned a malformed round report')
  }
  const report: RalphRoundReport = {
    status: expectedStatus,
    summary: value['summary'],
    evidence: value['evidence'],
    nextSteps: value['nextSteps'],
    blocker: value['blocker'],
  }
  if (expectedStatus === 'continue' && (report.nextSteps.length === 0 || report.blocker !== '')) {
    throw new Error('Ralph workflow returned an invalid continuing report')
  }
  if (expectedStatus === 'complete'
    && (report.evidence.length === 0 || report.nextSteps.length !== 0 || report.blocker !== '')) {
    throw new Error('Ralph workflow returned an invalid completion report')
  }
  if (expectedStatus === 'blocked' && !normalizedText(report.blocker)) {
    throw new Error('Ralph workflow returned an invalid blocked report')
  }
  const chars = JSON.stringify(report).length
  if (chars > maxChars) {
    throw new Error(`Ralph workflow returned an oversized handoff (${chars} > ${maxChars})`)
  }
  return report
}

/** Decode the fixed script's terminal value after the worker transport.
 * @param value - worker result JSON.
 * @param maxRounds - admitted round limit.
 * @param maxHandoffChars - serialized handoff ceiling.
 * @returns validated terminal outcome.
 */
export function readRunResult(value: unknown, maxRounds: number, maxHandoffChars: number): RalphTerminalResult {
  if (!isRecord(value)
    || typeof value['roundsStarted'] !== 'number'
    || !Number.isSafeInteger(value['roundsStarted'])
    || value['roundsStarted'] < 1
    || value['roundsStarted'] > maxRounds) {
    throw new Error('Ralph workflow returned a malformed terminal result')
  }
  const roundsStarted = value['roundsStarted']
  switch (value['status']) {
    case 'complete':
      if (Object.keys(value).sort().join(',') !== 'report,roundsStarted,status') {
        throw new Error('Ralph workflow returned a malformed terminal result')
      }
      return { status: 'complete', roundsStarted, report: readReport(value['report'], 'complete', maxHandoffChars) }
    case 'blocked':
      if (Object.keys(value).sort().join(',') !== 'report,roundsStarted,status') {
        throw new Error('Ralph workflow returned a malformed terminal result')
      }
      return { status: 'blocked', roundsStarted, report: readReport(value['report'], 'blocked', maxHandoffChars) }
    case 'budget-limited':
      if (Object.keys(value).sort().join(',') !== 'report,roundsStarted,status') {
        throw new Error('Ralph workflow returned a malformed terminal result')
      }
      if (roundsStarted !== maxRounds) {
        throw new Error('Ralph workflow returned budget-limited before the round limit')
      }
      return { status: 'budget-limited', roundsStarted, report: readReport(value['report'], 'continue', maxHandoffChars) }
    case 'round-failed': {
      if (Object.keys(value).sort().join(',') !== 'lastReport,roundsStarted,status') {
        throw new Error('Ralph workflow returned a malformed terminal result')
      }
      if (roundsStarted === 1) {
        if (value['lastReport'] !== null) {
          throw new Error('Ralph workflow returned an invalid first-round failure')
        }
        return { status: 'round-failed', roundsStarted }
      }
      if (value['lastReport'] === null) {
        throw new Error('Ralph workflow returned a round failure without its last handoff')
      }
      return {
        status: 'round-failed',
        roundsStarted,
        lastReport: readReport(value['lastReport'], 'continue', maxHandoffChars),
      }
    }
    default:
      throw new Error('Ralph workflow returned an unknown terminal status')
  }
}

/** Map a non-clean workflow finish to a Ralph error.
 * @param result - worker settlement.
 * @returns failure text, or undefined for a completed script.
 */
export function stopReasonError(result: WorkflowResult): string | undefined {
  switch (result.stopReason) {
    case 'completed':
      return undefined
    case 'cancelled':
      return `Ralph workflow was cancelled${result.error === undefined ? '' : ` (${result.error})`}`
    case 'error':
      return `Ralph workflow failed: ${result.error ?? 'unknown error'}`
    /* v8 ignore start -- WorkflowStopReason is closed; a future variant must fail loud here. */
    default:
      return `Ralph workflow ended abnormally (${String(result.stopReason satisfies never)})`
    /* v8 ignore stop */
  }
}

const TRUNCATION_NOTICE = '\n… [truncated]'

/** Canonical Ralph result fields used by the legacy tool schema. */
export const RALPH_OUTPUT_PROPERTIES = {
  runId: { type: 'string', required: true },
  agentsStarted: { type: 'integer', required: true },
  result: { type: 'json', required: true },
} as const

/** Bound complete parent-facing text, including its envelope and truncation marker. */
function boundResult(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  if (maxChars <= TRUNCATION_NOTICE.length) return TRUNCATION_NOTICE.slice(0, maxChars)
  return `${text.slice(0, maxChars - TRUNCATION_NOTICE.length)}${TRUNCATION_NOTICE}`
}

/** Render the fixed terminal envelope without presenting self-report as certification.
 * @param result - validated worker-reported progress.
 * @param maxChars - total rendered text ceiling.
 * @returns bounded model text including the terminal status.
 */
export function renderResult(result: RalphRunResult, maxChars: number): string {
  const rounds = `${result.roundsStarted} round${result.roundsStarted === 1 ? '' : 's'}`
  let text: string
  switch (result.status) {
    case 'complete':
      text = `Ralph worker reported completion after ${rounds}.\nFinal report:\n${JSON.stringify(result.report, null, 2)}`
      break
    case 'blocked':
      text = `Ralph worker reported a blocker after ${rounds}.\nFinal report:\n${JSON.stringify(result.report, null, 2)}`
      break
    case 'budget-limited':
      text = `Ralph reached its ${rounds} limit; the worker reported work remaining.\nFinal report:\n${JSON.stringify(result.report, null, 2)}`
      break
  }
  return boundResult(text, maxChars)
}

/** Render an ordinary child failure with the most recent durable handoff.
 * @param result - validated failed round and optional prior report.
 * @param maxChars - total rendered text ceiling.
 * @returns bounded failure text.
 */
export function renderRoundFailure(result: RalphRoundFailure, maxChars: number): string {
  const header = `Ralph round ${result.roundsStarted} child failed before producing a structured report.`
  const text = result.lastReport === undefined
    ? `${header}\nNo previous handoff was available.`
    : `${header}\nLast successful handoff:\n${JSON.stringify(result.lastReport, null, 2)}`
  return boundResult(text, maxChars)
}
