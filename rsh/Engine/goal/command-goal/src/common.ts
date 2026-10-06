/** Shared human Goal parser and direct UI output. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CommandResult } from '@deepseek-ai/dsh-commands/facts'
import type { GoalPhase, GoalRef, GoalView } from '@deepseek-ai/dsh-goal/types'

/** Human Goal command grammar help. */
export const USAGE = 'Usage: /goal [<objective>|clear|edit <objective>|pause|resume]'

/** Parsed human Goal action. */
export type GoalCommand = (
  | { readonly kind: 'show' }
  | { readonly kind: 'create'; readonly objective: string }
  | { readonly kind: 'edit'; readonly objective: string }
  | { readonly kind: 'invalid-edit' }
  | { readonly kind: 'pause' }
  | { readonly kind: 'resume' }
  | { readonly kind: 'clear' }
) & { readonly expectedRef?: GoalRef | null }

/**
 * Fail loudly for an unhandled action.
 * @param value - impossible closed-union member.
 * @param label - diagnostic subject.
 * @returns never.
 */
/* v8 ignore start -- closed-union backstop is unreachable without violating the TypeScript contract */
export function assertNever(value: never, label: string): never {
  throw new TypeError(`unknown ${label}: ${String(value)}`)
}
/* v8 ignore stop */

/**
 * Parse the human Goal grammar.
 * @param rawInput - command input after the slash name.
 * @returns requested Goal action.
 */
export function parseGoalCommand(rawInput: string): GoalCommand {
  const input = rawInput.trim()
  if (input.length === 0) return { kind: 'show' }
  const control = input.toLowerCase()
  if (control === 'clear') return { kind: 'clear' }
  if (control === 'pause') return { kind: 'pause' }
  if (control === 'resume') return { kind: 'resume' }
  if (control === 'edit') return { kind: 'invalid-edit' }
  if (/^edit(?=\s)/iu.test(input)) return { kind: 'edit', objective: input.slice(4).trim() }
  return { kind: 'create', objective: input }
}

/** Parse human input and refuse attachments on commands without an objective.
 * @param rawInput - text following the slash command name.
 * @param attachmentCount - admitted composer attachments.
 * @returns the parsed command or a direct human refusal before domain access.
 */
export function prepareGoalCommand(rawInput: string, attachmentCount: number):
  { readonly kind: 'command'; readonly command: GoalCommand } | { readonly kind: 'error'; readonly text: string } {
  let command: GoalCommand
  try {
    const prefix = /^--expected-ref=(\S+)(?:\s+|$)/u.exec(rawInput.trim())
    if (prefix === null) {
      if (rawInput.trim().startsWith('--expected-ref')) throw new TypeError('invalid Goal reference parameter')
      command = parseGoalCommand(rawInput)
    }
    else {
      const decoded: unknown = JSON.parse(decodeURIComponent(prefix[0].slice('--expected-ref='.length).trim()))
      let expectedRef: GoalRef | null
      if (decoded === null) expectedRef = null
      else {
        if (typeof decoded !== 'object' || Array.isArray(decoded)) throw new TypeError('invalid Goal reference')
        const fields = decoded as Record<string, unknown>
        if (Object.keys(fields).some(key => key !== 'id' && key !== 'revision')
          || typeof fields.id !== 'string' || fields.id.trim().length === 0
          || typeof fields.revision !== 'number' || !Number.isSafeInteger(fields.revision) || fields.revision < 1) {
          throw new TypeError('invalid Goal reference')
        }
        expectedRef = { id: brandString<GoalRef['id']>(fields.id), revision: fields.revision }
      }
      command = { ...parseGoalCommand(rawInput.trim().slice(prefix[0].length)), expectedRef }
    }
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError) && !(error instanceof URIError) && !(error instanceof TypeError)) throw error
    return { kind: 'error', text: 'The expected Goal reference must be URI-encoded JSON containing null or an exact id and positive revision.' }
  }
  if (attachmentCount > 0 && command.kind !== 'create' && command.kind !== 'edit') {
    return { kind: 'error', text: 'Attachments only accompany a goal objective: /goal <objective> or /goal edit <objective>.' }
  }
  return { kind: 'command', command }
}

/** Resolve observations and state refusals without mutating the Goal domain.
 * @param command - parsed human action after attachment admission.
 * @param current - exact domain-owned Goal view, if present.
 * @returns direct human output or an action for the owning synchronous or asynchronous domain.
 */
export function resolveGoalCommandState(command: GoalCommand, current: GoalView | undefined):
  CommandResult | { readonly kind: 'action'; readonly command: Exclude<GoalCommand, { kind: 'show' | 'invalid-edit' }> } {
  if (command.expectedRef !== undefined) {
    const expected = command.expectedRef
    if (expected === null ? current !== undefined
      : current === undefined || current.id !== expected.id || current.revision !== expected.revision) {
      return { kind: 'error', text: 'The Goal changed since it was displayed. Refresh the Session before changing it.' }
    }
  }
  if (command.kind === 'show') return current === undefined
    ? { kind: 'success', text: `No goal is currently set.\n${USAGE}` }
    : renderGoal('Goal', current)
  if (command.kind === 'invalid-edit') return { kind: 'error', text: `Goal editing requires a replacement objective.\n${USAGE}` }
  if (command.kind === 'create' && current !== undefined && current.phase !== 'complete') return { kind: 'error',
    text: `A goal is already ${phaseLabel(current.phase)}. Use /goal edit <objective> to change it or /goal clear before replacing it.` }
  return { kind: 'action', command }
}

/**
 * Render the durable Goal phase.
 * @param phase - current phase.
 * @returns direct human label.
 */
export function phaseLabel(phase: GoalPhase): string {
  switch (phase) {
    case 'active': return 'active'
    case 'paused': return 'paused'
    case 'blocked': return 'blocked'
    case 'complete': return 'complete'
    /* v8 ignore next 2 -- GoalPhase is closed and every member is handled above */
    default: return assertNever(phase, 'goal phase')
  }
}

/** Commands that are meaningful from one exact live state. */
function commandHint(goal: GoalView): string {
  if (goal.phase === 'active') {
    return goal.activation === 'armed'
      ? '/goal edit <objective>, /goal pause, /goal clear'
      : '/goal edit <objective>, /goal resume, /goal clear'
  }
  switch (goal.phase) {
    case 'paused':
    case 'blocked':
      return '/goal edit <objective>, /goal resume, /goal clear'
    case 'complete':
      return '/goal <objective>, /goal clear'
    /* v8 ignore next 2 -- the active branch and every non-active phase are handled above */
    default: return assertNever(goal.phase, 'goal phase')
  }
}

/**
 * Render direct human Goal output.
 * @param title - operation heading.
 * @param goal - current durable Goal and process-local activation.
 * @returns direct UI outcome.
 */
export function renderGoal(title: string, goal: GoalView): CommandResult {
  const reason = goal.phase === 'blocked' ? goal.blockedReason : undefined
  /* v8 ignore next -- durable replay guarantees every blocked goal carries its validated reason */
  if (goal.phase === 'blocked' && reason === undefined) throw new TypeError('blocked goal is missing its reason')
  const blocker = reason === undefined ? [] : [`Blocker: ${reason.code}: ${reason.message}`]
  return {
    kind: 'success',
    text: [
      title,
      `Status: ${phaseLabel(goal.phase)}`,
      ...blocker,
      `Objective: ${goal.objective}`,
      `Rounds: ${goal.roundsStarted}/${goal.maxGoalRounds}`,
      `Activation: ${goal.activation}`,
      '',
      `Commands: ${commandHint(goal)}`,
    ].join('\n'),
  }
}

/**
 * Take the current revision reference.
 * @param goal - current view.
 * @returns exact revision reference.
 */
export function goalRef(goal: GoalView): GoalRef {
  return { id: goal.id, revision: goal.revision }
}

/**
 * Render a missing Goal outcome.
 * @param action - requested operation.
 * @returns direct error and usage guidance.
 */
export function missingGoal(action: string): CommandResult {
  return {
    kind: 'error',
    text: `No goal is currently set; /goal ${action} requires one. ${USAGE}`,
  }
}

/** Exact observed revision after the command's state precondition has succeeded.
 * @param command - parsed action, optionally carrying the human's observed revision.
 * @param goal - exact domain state read for this invocation.
 * @returns the supplied reference, or the invocation's current reference for legacy unguarded input.
 */
export function goalCommandRef(command: GoalCommand, goal: GoalView): GoalRef {
  if (command.expectedRef === null) throw new TypeError('An absent Goal reference cannot mutate an existing Goal')
  return command.expectedRef === undefined ? goalRef(goal) : command.expectedRef
}
