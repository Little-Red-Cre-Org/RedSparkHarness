// @vitest-environment jsdom

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { NativeSessionGoal } from '../src/goal.tsx'

const history = [
  {
    type: 'goal/change', seq: 0, time: 1,
    data: {
      kind: 'goal/change', version: 1, operation: 'create',
      goal: { id: 'goal-1', revision: 1, objective: 'Ship the Native goal bar', phase: 'active', maxGoalRounds: 3 },
      roundsStarted: 0, createdAt: 1, updatedAt: 1,
    },
  },
  {
    type: 'user/message', seq: 1, time: 2, surfaceOp: 'append',
    data: {
      id: 'goal-round-1', role: 'user',
      source: { kind: 'goal', goalId: 'goal-1', revision: 1, round: 1 },
      content: [{ type: 'text', text: 'Continue the goal.' }],
    },
  },
] as unknown as SessionEvent[]

it('shows the current goal and its admitted-round progress from Session history', () => {
  render(<NativeSessionGoal events={history} locale="en" />)

  expect(screen.getByText('Ongoing Goal')).toBeTruthy()
  expect(screen.getByText('Ship the Native goal bar')).toBeTruthy()
  expect(screen.getByText('Round 1 of 3')).toBeTruthy()
})
