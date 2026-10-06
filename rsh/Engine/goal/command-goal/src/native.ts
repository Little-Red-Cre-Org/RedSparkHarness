/** Direct human Goal commands over the selected native Goal Definition. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { CommandDefinitionId, type NativeCommandInvocation, type CommandResult } from '@deepseek-ai/dsh-commands/native'
import { GoalError, type NativeGoalOperations } from '@deepseek-ai/dsh-goal/native'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import { assertNever, prepareGoalCommand, resolveGoalCommandState, renderGoal, goalCommandRef, missingGoal } from './common.ts'

async function submitAttachments(invocation: NativeCommandInvocation): Promise<void> {
  if (invocation.attachments.length === 0) return
  await invocation.owner.enqueue(createUserMessage({ source: { kind: 'user' },
    content: [...invocation.attachments, { type: 'text', text: 'Reference attachments for the goal objective.' }],
  }), 'next-turn', false, invocation.signal)
}

async function execute(goals: NativeGoalOperations, invocation: NativeCommandInvocation): Promise<CommandResult> {
  const prepared = prepareGoalCommand(invocation.rawInput, invocation.attachments.length)
  if (prepared.kind === 'error') return prepared
  invocation.signal.throwIfAborted()
  try {
    const current = goals.get(invocation.agent)
    const resolved = resolveGoalCommandState(prepared.command, current)
    if (resolved.kind !== 'action') return resolved
    const command = resolved.command
    switch (command.kind) {
      case 'create': {
        const goal = await goals.create(invocation.agent, { objective: command.objective,
          ...command.expectedRef === undefined ? {} : { expectedRef: command.expectedRef } })
        await submitAttachments(invocation)
        return renderGoal('Goal created', goal)
      }
      case 'edit': {
        if (current === undefined) return missingGoal('edit')
        const goal = current.phase === 'complete' ? await goals.create(invocation.agent, { objective: command.objective,
          ...command.expectedRef === undefined ? {} : { expectedRef: command.expectedRef } })
          : await goals.edit(invocation.agent, goalCommandRef(command, current), { objective: command.objective })
        await submitAttachments(invocation)
        return renderGoal(current.phase === 'complete' ? 'Goal created' : 'Goal updated', goal)
      }
      case 'pause': {
        if (current === undefined) return missingGoal('pause')
        const release = invocation.owner.retain()
        try {
          const goal = await goals.pause(invocation.agent, goalCommandRef(command, current))
          await invocation.owner.rootOperations?.interruptTurn({ kind: 'hook', reason: 'goal-pause' })
          return renderGoal('Goal paused', goal)
        } finally { release() }
      }
      case 'resume': return current === undefined ? missingGoal('resume')
        : renderGoal('Goal resumed', await goals.resume(invocation.agent, goalCommandRef(command, current)))
      case 'clear':
        if (current === undefined) return { kind: 'success', text: 'No goal to clear.' }
        await goals.clear(invocation.agent, goalCommandRef(command, current))
        return { kind: 'success', text: 'Goal cleared.' }
      default: return assertNever(command, 'goal command')
    }
  } catch (failure: unknown) {
    if (!(failure instanceof GoalError)) throw failure
    return { kind: 'error', text: 'The goal command is not valid for the current state. Run /goal to view available commands.' }
  }
}

/** Native Goal human Consumer; slash input stays outside model history. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-command-goal', targets: ['host'], requires: ['commands', 'goals'], provides: [],
  resolve(input) {
    if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 0)) {
      throw new Error('command-goal: configuration must be an empty object')
    }
    return (context) => {
      const goals = context.require('goals')
      context.effect(context.require('commands').register({ definitionId: CommandDefinitionId('@deepseek-ai/dsh-command-goal'),
        name: 'goal', description: 'Set or view the goal for a long-running task',
        input: { hint: '[<objective>|clear|edit <objective>|pause|resume]', attachments: true },
        handler: invocation => execute(goals, invocation),
      }, context.scope))
    }
  },
}
