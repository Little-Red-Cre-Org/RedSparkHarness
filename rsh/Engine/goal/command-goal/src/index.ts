/**
 * Human-facing `/goal` command over the persisted same-session goal domain.
 * @module @deepseek-ai/dsh-command-goal
 */

import { assertNever, prepareGoalCommand, resolveGoalCommandState, renderGoal, goalCommandRef, missingGoal } from './common.ts'
import type { Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { GoalError } from '@deepseek-ai/dsh-goal'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'command-goal'
export const inject = ['commands', 'goals']

/**
 * Submit the invocation's admitted composer attachments as one model-visible user
 * message ahead of the goal's next round. The attachments precede a fixed text
 * block naming their role, so a later goal round reads them from ordinary
 * session history without the goal domain storing attachment state.
 */
function submitObjectiveAttachments(invocation: CommandInvocation): void {
  if (invocation.attachments.length === 0) return
  invocation.agent.followup(createUserMessage({
    content: [...invocation.attachments, { type: 'text', text: 'Reference attachments for the goal objective.' }],
    source: { kind: 'user' },
  }))
}

/** Execute one parsed human command through the domain that owns persistence. */
function executeGoalCommand(ctx: Context, invocation: CommandInvocation): CommandResult {
  const prepared = prepareGoalCommand(invocation.rawInput, invocation.attachments.length)
  if (prepared.kind === 'error') return prepared
  try {
    const current = ctx.goals.get(invocation.agent)
    const resolved = resolveGoalCommandState(prepared.command, current)
    if (resolved.kind !== 'action') return resolved
    const command = resolved.command
    switch (command.kind) {
      case 'create': {
        const created = ctx.goals.create(invocation.agent, { objective: command.objective,
          ...command.expectedRef === undefined ? {} : { expectedRef: command.expectedRef } })
        submitObjectiveAttachments(invocation)
        return renderGoal('Goal created', created)
      }
      case 'edit': {
        if (current === undefined) return missingGoal('edit')
        if (current.phase === 'complete') {
          const replaced = ctx.goals.create(invocation.agent, { objective: command.objective,
            ...command.expectedRef === undefined ? {} : { expectedRef: command.expectedRef } })
          submitObjectiveAttachments(invocation)
          return renderGoal('Goal created', replaced)
        }
        const edited = ctx.goals.edit(invocation.agent, goalCommandRef(command, current), { objective: command.objective })
        submitObjectiveAttachments(invocation)
        return renderGoal('Goal updated', edited)
      }
      case 'pause':
        if (current === undefined) return missingGoal('pause')
        return renderGoal('Goal paused', ctx.goals.pause(invocation.agent, goalCommandRef(command, current)))
      case 'resume':
        if (current === undefined) return missingGoal('resume')
        return renderGoal('Goal resumed', ctx.goals.resume(invocation.agent, goalCommandRef(command, current)))
      case 'clear':
        if (current === undefined) return { kind: 'success', text: 'No goal to clear.' }
        ctx.goals.clear(invocation.agent, goalCommandRef(command, current))
        return { kind: 'success', text: 'Goal cleared.' }
      /* v8 ignore next 2 -- GoalCommand is closed and every member is handled above */
      default: return assertNever(command, 'goal command')
    }
  } catch (error: unknown) {
    if (error instanceof GoalError) {
      return {
        kind: 'error',
        text: 'The goal command is not valid for the current state. Run /goal to view available commands.',
      }
    }
    throw error
  }
}

/** Register the Codex-shaped `/goal` command for every composed command adapter. */
export function apply(ctx: Context): void {
  ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-command-goal'),
    name: 'goal',
    description: 'Set or view the goal for a long-running task',
    input: { hint: '[<objective>|clear|edit <objective>|pause|resume]', attachments: true },
    handler: invocation => executeGoalCommand(ctx, invocation),
  })
}
