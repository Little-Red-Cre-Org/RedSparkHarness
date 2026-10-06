/** Shared model policy and canonical Goal results for both runtime Consumers. */
import type { GoalView } from '@deepseek-ai/dsh-goal/types'

/** Model policy for direct-human Goal creation. */
export const CREATE_DESCRIPTION =
  'Create one persisted same-session completion goal when the current direct human request '
  + 'is a long-running objective that should continue across autonomous goal rounds. You may '
  + 'infer that intent without requiring the user to say "create a goal". Do not use this for '
  + 'trivial single-turn work. Execution rejects non-human and subagent authority.'

/** Model instructions for observing exact Goal state. */
export const GET_DESCRIPTION =
  'Read the current same-session goal, including its exact id/revision, objective, phase, completed '
  + 'continuation rounds, round limit, blocker reason when present, and whether another continuation is armed. '
  + 'Call this before updating a goal.'

/** Canonical goal-tool output, matching the existing compact Native JSON. */
export type GoalToolValue =
  | { goal: null }
  | {
    goal: {
      id: string
      revision: number
      objective: string
      phase: GoalView['phase']
      roundsStarted: number
      maxGoalRounds: number
      blockedReason?: { code: string; message: string }
    }
    activation: GoalView['activation']
  }

/**
 * Render Goal model policy.
 * @param blockedAfter - deployment-selected blocked threshold.
 * @returns stable system-prompt section.
 */
export function guidance(blockedAfter: number): string {
  return 'Use goal tools for one long-running completion objective in the current session. '
    + 'create_goal may infer goal intent from a direct human request in any language; do not '
    + 'create a goal for routine single-turn work. Call get_goal before update_goal and copy its '
    + 'exact goal_id and revision. After session resume or fork, an active goal is disarmed: when '
    + 'a human asks to continue or resume in any wording or language, use update_goal action '
    + 'resume to rearm it. Mark complete only when the objective is actually achieved. Mark '
    + `blocked only after the same blocking condition persists for at least ${blockedAfter} `
    + 'consecutive goal rounds, and report that concrete condition in blocked_reason; difficulty, uncertainty, '
    + 'or useful remaining work is not blocked.'
}

/**
 * Render canonical Goal data.
 * @param goal - exact current Goal or absence.
 * @returns compact model result; activation is process-local.
 */
export function goalValue(goal: GoalView | undefined): GoalToolValue {
  if (goal === undefined) return { goal: null }
  return {
    goal: {
      id: goal.id,
      revision: goal.revision,
      objective: goal.objective,
      phase: goal.phase,
      roundsStarted: goal.roundsStarted,
      maxGoalRounds: goal.maxGoalRounds,
      ...goal.blockedReason === undefined ? {} : {
        blockedReason: { code: goal.blockedReason.code, message: goal.blockedReason.message },
      },
    },
    activation: goal.activation,
  }
}
