/**
 * Framework-free plan-mode facts shared by the Cordis service and the native
 * Consumer: the durable `plan/mode` event, guidance validation, the reviewed
 * exit's question and answer interpretation, and the `/plan` command copy.
 *
 * @module @deepseek-ai/dsh-plan-mode/common
 */

import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/protocol'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Whether plan mode is in force from this point on: log-only, non-surface,
     * whole-value replace. The last `plan/mode` wins; a log with none folds to
     * inactive.
     * @mode serial
     * @param active - plan mode state recorded from this event onward.
     */
    'plan/mode': { active: boolean }
  }
}

/**
 * The model-facing exit tool's name. It stays registered while plan mode is
 * inactive so the request tool catalog is stable across transitions.
 */
export const EXIT_PLAN_MODE = 'exit_plan_mode'

/** Model-facing description of the exit tool. */
export const EXIT_DESCRIPTION
  = 'Use only in plan mode. Present your plan for the user\'s review and, on approval, leave plan mode. '
  + 'Send the COMPLETE plan as markdown, starting with a # heading that names it. '
  + 'The user may approve (carry out the plan from your next step) or keep '
  + 'planning — their feedback comes back in the tool result; revise and present again.'

/** Model-facing description of the exit tool's only argument. */
export const EXIT_PLAN_ARGUMENT_DESCRIPTION = 'The complete plan, as markdown, starting with a # heading that names it.'

/** Rendered result of an approved review. */
export const EXIT_APPROVED_TEXT = 'Plan approved — plan mode exited; carry out the plan starting with your next step.'

/** Failure returned when no interactive review channel can present the plan. */
export const NO_REVIEW_CHANNEL_MESSAGE
  = 'no user-questions channel is available to review the plan; ask the user to switch the session mode instead'

/** Failure returned when the user closes the review to type a message. */
export const REVIEW_DISMISSED_MESSAGE = 'The user dismissed the plan review to speak instead; '
  + 'stay in plan mode, stop here, and wait for their message.'

/** Plugin name recorded on plan-mode notices. */
export const PLAN_NOTICE_PLUGIN = 'plan-mode'

/** Name of the human slash command. */
export const PLAN_COMMAND_NAME = 'plan'

/** Human-facing command description. */
export const PLAN_COMMAND_DESCRIPTION = 'Enter or leave plan mode'

/** Human-facing command argument hint. */
export const PLAN_COMMAND_HINT = '[off|message]'

/** Command failure for `/plan off` with attachments. */
export const PLAN_OFF_ATTACHMENTS_TEXT = 'Attachments cannot accompany /plan off.'

/** Deployment-owned plan guidance. */
export interface PlanModeConfig {
  /** Guidance shown to the model while plan mode is active. */
  section: string
}

/** The review question's id, echoed in the answer this tool reads. */
const REVIEW_ID = 'plan-review'

/** The review question's approve option label. */
const APPROVE_LABEL = 'Approve'

/** The review question's keep-planning option label. */
const KEEP_PLANNING_LABEL = 'Keep planning'

/**
 * Validate deployment-owned plan guidance. Missing, blank, non-string, or
 * unknown fields fail at plugin load rather than being ignored.
 *
 * @param config Raw plugin config.
 * @returns A detached validated config.
 */
export function resolveConfig(config: PlanModeConfig): PlanModeConfig {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('PlanModeConfig needs a string `section`')
  }
  const section = (config as Partial<PlanModeConfig>).section
  if (typeof section !== 'string') {
    throw new Error('PlanModeConfig needs a string `section`')
  }
  if (section.trim() === '') {
    throw new Error('PlanModeConfig needs a non-empty `section`')
  }
  const unknown = Object.keys(config).filter(key => key !== 'section')
  if (unknown.length > 0) {
    throw new Error(`PlanModeConfig has unknown key(s) ${unknown.join(', ')} — config is { section }`)
  }
  return { section }
}

/**
 * Read the plan's first markdown heading.
 * @param plan - plan markdown supplied to the exit tool.
 * @returns the first heading text at any level, or `undefined` when none exists.
 */
export function firstHeading(plan: string): string | undefined {
  for (const line of plan.split('\n')) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line)
    if (match) return match[1]
  }
  return undefined
}

/**
 * Reject a plan that does not open with a level-one heading.
 * @param plan - plan markdown supplied to the exit tool.
 */
export function assertPlanHeading(plan: string): void {
  if (!/^#\s+\S/.test(plan.trim())) {
    throw new Error(`${EXIT_PLAN_MODE} requires a non-empty markdown plan starting with a # heading`)
  }
}

/**
 * Build the single plan-review question.
 * @param plan - complete plan markdown shown as the question detail.
 * @returns the question with the `plan-review` presentation intent.
 */
export function planReviewQuestion(plan: string): AskUserQuestionItem {
  return {
    id: REVIEW_ID,
    header: 'Plan review',
    question: 'Approve this plan and leave plan mode?',
    detail: plan,
    options: [
      { label: APPROVE_LABEL, description: 'Leave plan mode; the plan is carried out from the next step.' },
      { label: KEEP_PLANNING_LABEL, description: 'Stay in plan mode; feedback goes back to the model.' },
    ],
    // Presentation only: a capable UI renders the plan as a review decision
    // instead of a generic question, and answers with one of the labels above.
    intent: { kind: 'plan-review', approve: APPROVE_LABEL },
  }
}

/**
 * Reject every answer except an exact single approval of the review question.
 * @param answer - human answer returned by the user-questions channel.
 */
export function assertPlanApproved(answer: AskUserQuestionAnswer): void {
  const reviewItems = answer.answers.filter(entry => entry.id === REVIEW_ID)
  const item = reviewItems.length === 1 ? reviewItems[0] : undefined
  if (item?.selected.length !== 1 || item.selected[0] !== APPROVE_LABEL || item.custom !== undefined) {
    const feedback = item?.custom ?? ''
    throw new Error(feedback === ''
      ? 'The user chose to keep planning; revise the plan and present it again.'
      : `The user chose to keep planning; their feedback: ${feedback}`)
  }
}

/**
 * Sentence telling the model that the user changed the mode.
 * @param active - mode selected by the user.
 * @returns the one-sentence user-switch notice.
 */
export function planSwitchText(active: boolean): string {
  return active
    ? 'The user switched this session to plan mode.'
    : 'The user switched this session back to the default mode.'
}

/** Outcome of one mode selection. */
export type PlanSelectionOutcome = 'committed' | 'queued' | 'cancelled' | 'noop'

/**
 * Human command result text for one selection.
 * @param active - selected mode.
 * @param outcome - selection outcome.
 * @param loggedActive - logged mode after the selection, used for an exit that is still waiting.
 * @returns the command's success text.
 */
export function planCommandText(active: boolean, outcome: PlanSelectionOutcome, loggedActive: boolean): string {
  if (active) {
    return outcome === 'committed'
      ? 'Plan mode on. Use /plan off to leave.'
      : 'Entering plan mode (applies from the next step). Use /plan off to leave.'
  }
  switch (outcome) {
    case 'committed': return 'Plan mode off.'
    case 'queued': return 'Leaving plan mode (applies from the next step).'
    case 'cancelled': return 'Plan mode entry cancelled.'
    // Repeat the queued wording while an exit still awaits the next accepted
    // step; only a truly inactive session reads idempotent.
    case 'noop': return loggedActive ? 'Leaving plan mode (applies from the next step).' : 'Plan mode is already inactive.'
  }
}
