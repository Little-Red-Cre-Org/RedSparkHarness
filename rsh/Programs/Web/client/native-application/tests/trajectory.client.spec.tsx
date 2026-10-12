// @vitest-environment jsdom

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NativeTrajectoryInspector } from '../src/trajectory.tsx'

const history = [
  { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
  {
    type: 'user/message', seq: 1, time: 2, surfaceOp: 'append',
    data: { id: 'user-message', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello from history' }] },
  },
  {
    type: 'assistant/message', seq: 2, time: 3, surfaceOp: 'append',
    data: {
      turn: 1, step: 1, stream: [],
      message: {
        id: 'assistant-message', role: 'assistant',
        source: { kind: 'model', provider: 'test', model: 'test' },
        content: [{ type: 'text', text: 'reply from history' }],
      },
    },
  },
  { type: 'turn/end', seq: 3, time: 4, data: { turn: 1, reason: { kind: 'completed' } } },
] as unknown as SessionEvent[]

describe('Native trajectory inspector', () => {
  it('opens the current event history with its turn and messages', () => {
    render(<NativeTrajectoryInspector events={history} locale="en" openLabel="Trajectory"
      title="Session trajectory" closeLabel="Close trajectory" />)

    fireEvent.click(screen.getByRole('button', { name: 'Trajectory' }))

    expect(screen.getByRole('dialog', { name: 'Session trajectory' })).toBeTruthy()
    expect(screen.getByText('Turn 1')).toBeTruthy()
    expect(screen.getByText('hello from history')).toBeTruthy()
    expect(screen.getByText('reply from history')).toBeTruthy()
  })
})
