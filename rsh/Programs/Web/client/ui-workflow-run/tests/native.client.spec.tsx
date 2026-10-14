// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { NativeWorkflowRunPanel, workflowRunsFromSessionEvents } from '../src/native.ts'

afterEach(cleanup)
function at(seq: number, type: string, data: object): SessionEvent {
  return { seq, type, data, time: seq } as SessionEvent
}
const starts = [
  at(0, 'turn/start', { turn: 1 }),
  at(1, 'step/start', { turn: 1, step: 1 }),
  at(2, 'tool-workflow/run-start', { runId: 'audit', name: 'Audit' }),
  at(3, 'tool-workflow/agent-start', { runId: 'audit', seq: 2, label: 'Unphased member', childId: 'a' }),
  at(4, 'tool-workflow/agent-start', { runId: 'audit', seq: 1, label: 'Empty phase member', phase: '', childId: 'b' }),
  at(5, 'tool-workflow/agent-start', { runId: 'audit', seq: 3, label: 'Second unphased', childId: 'c' }),
]

it('keeps a stable start anchor, exact phases and start order through live append and restored history', () => {
  const initial = workflowRunsFromSessionEvents(starts)[0]!
  expect(initial.seq).toBe(2)
  expect(initial.data.status).toBe('running')
  expect(initial.data.phases.map(phase => [phase.phase, phase.members.map(member => member.seq)]))
    .toEqual([[null, [2, 3]], ['', [1]]])
  expect(workflowRunsFromSessionEvents([...starts, at(6, 'turn/end', { turn: 9 })])[0]!.data.status).toBe('running')
  const settled = [...starts,
    at(6, 'tool-workflow/agent-end', { runId: 'audit', seq: 2, outcome: 'completed' }),
    at(7, 'step/end', { turn: 9, step: 1 }),
  ]
  expect(workflowRunsFromSessionEvents(settled)[0]!.data.status).toBe('running')
  const closed = workflowRunsFromSessionEvents([...settled, at(8, 'step/end', { turn: 1, step: 1 })])[0]!
  expect(closed.seq).toBe(initial.seq)
  expect(closed.data.status).toBe('interrupted')
  expect(closed.data.phases[0]!.members.map(member => member.status)).toEqual(['completed', 'interrupted'])
  expect(workflowRunsFromSessionEvents([...settled, at(8, 'turn/end', { turn: 1 })])[0]!.data).toEqual(closed.data)
})

it('preserves terminal runs, zero members and update-only tails without deriving closure from another turn', () => {
  expect(workflowRunsFromSessionEvents([at(0, 'tool-workflow/run-end', { runId: 'absent', stopReason: 'error' })])).toEqual([])
  const events = [at(0, 'tool-workflow/run-start', { runId: 'session', name: 'Session run' }),
    at(1, 'turn/start', { turn: 1 }), at(2, 'turn/end', { turn: 1 })]
  expect(workflowRunsFromSessionEvents(events)[0]!.data).toEqual({ name: 'Session run', status: 'running', phases: [] })
  for (const [stopReason, status] of [['completed', 'completed'], ['error', 'failed'], ['cancelled', 'cancelled']]) {
    const data = workflowRunsFromSessionEvents([...starts,
      at(6, 'tool-workflow/run-end', { runId: 'audit', stopReason }), at(7, 'turn/end', { turn: 1 })])[0]!.data
    expect(data.status).toBe(status)
    expect(data.phases[0]!.members[0]!.status).toBe('running')
  }
})

it('renders localized disclosures with read-only members and zero-member copy', () => {
  const { rerender } = render(<NativeWorkflowRunPanel data={workflowRunsFromSessionEvents(starts)[0]!.data} locale="en" />)
  expect(screen.getByText('Unphased')).toBeTruthy()
  expect(screen.getByText('Empty phase name')).toBeTruthy()
  expect(screen.getByText('Unphased member').closest('button')).toBeNull()
  expect(screen.queryByRole('button', { name: /Open/ })).toBeNull()
  rerender(<NativeWorkflowRunPanel data={{ name: 'Empty', status: 'completed', phases: [] }} locale="zh" />)
  fireEvent.click(screen.getByText('Empty'))
  expect(screen.getByText('没有启动成员')).toBeTruthy()
})
