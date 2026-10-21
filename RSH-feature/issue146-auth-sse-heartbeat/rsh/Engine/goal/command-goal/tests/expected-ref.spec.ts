/** Guarded human commands reject stale observed Goal revisions before mutation admission. */
import { expect, it } from 'vitest'
import { prepareGoalCommand, resolveGoalCommandState } from '../src/common.ts'
import type { GoalView } from '@deepseek-ai/dsh-goal/types'

it('rejects stale and malformed observed references instead of substituting the current revision', () => {
  // The view represents domain-decoded durable JSON, including its branded Goal identity.
  const current = { id: 'goal', revision: 2, objective: 'Review work', phase: 'paused',
    maxGoalRounds: 2, roundsStarted: 0, activation: 'disarmed' } as GoalView
  const prepared = prepareGoalCommand(`--expected-ref=${encodeURIComponent(JSON.stringify({ id: 'goal', revision: 1 }))} resume`, 0)
  expect(prepared.kind).toBe('command')
  if (prepared.kind !== 'command') throw new Error('Fixture command was not parsed')
  expect(resolveGoalCommandState(prepared.command, current).kind).toBe('error')
  expect(prepareGoalCommand('--expected-ref=%7Bbroken resume', 0).kind).toBe('error')
  expect(resolveGoalCommandState({ kind: 'resume', expectedRef: { id: current.id, revision: 2 } }, current).kind).toBe('action')
})
