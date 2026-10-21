// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { NativeTranscript, groupNativeTranscriptEvents } from '../src/native-transcript.tsx'
import { toolCardRecords } from '../src/tool-cards.tsx'
import { en } from '../src/locales.ts'

afterEach(cleanup)
function at(seq: number, type: string, data: object): SessionEvent {
  return { seq, time: seq, type, data } as SessionEvent
}
const history = [at(0, 'turn/start', { turn: 1 }), at(1, 'step/start', { turn: 1, step: 1 }),
  at(2, 'tool/call', { turn: 1, step: 1, callId: 'wf', name: 'workflow', arguments: '{}' }),
  at(3, 'tool-workflow/run-start', { runId: 'run', name: 'Audit' }),
  at(4, 'tool-workflow/agent-start', { runId: 'run', seq: 1, label: 'Reviewer', childId: 'child' })]

const props = {
  sessionId: 'parent' as SessionId, locale: 'en' as const, loadImage: async () => new Blob(),
  t: makeTranslate(en), markdownLabels: { code: { copyLabel: 'Copy code', copiedLabel: 'Copied' }, footnotes: 'Footnotes' },
  imageGroupClassName: undefined, truncatedClassName: undefined,
}

it('inserts exactly one run at its start sequence and keeps the ordinary tool row on restore and append', () => {
  expect(groupNativeTranscriptEvents([at(0, 'tool-workflow/run-start', { runId: 'empty', name: 'Empty' })], new Map())
    .map(turn => turn.events.map(event => event.seq))).toEqual([[0]])
  const cards = new Map(toolCardRecords(history).map(record => [record.seq, record.block]))
  expect(groupNativeTranscriptEvents(history, cards).map(turn => turn.events.map(event => event.seq))).toEqual([[2, 3]])
  const { container, rerender } = render(<NativeTranscript {...props} snapshot={{ sessions: [], events: history, state: 'ready' }} />)
  const panel = container.querySelector('[data-workflow-run]')
  expect(panel).toBeTruthy()
  expect(container.querySelector('[data-chat-call-id="wf"]')).toBeTruthy()
  expect(screen.getByText('Reviewer').closest('button')).toBeNull()
  const ended = [...history, at(5, 'tool-workflow/agent-end', { runId: 'run', seq: 1, outcome: 'completed' }),
    at(6, 'tool-workflow/run-end', { runId: 'run', stopReason: 'completed' }), at(7, 'turn/end', { turn: 1 })]
  rerender(<NativeTranscript {...props} snapshot={{ sessions: [], events: ended, state: 'ready' }} />)
  expect(container.querySelectorAll('[data-workflow-run]')).toHaveLength(1)
  expect(container.querySelector('[data-workflow-run]')).toBe(panel)
  expect(panel?.getAttribute('data-run-status')).toBe('completed')
  fireEvent.click(screen.getByText('Audit'))
  fireEvent.click(screen.getByText('Unphased'))
  expect(screen.getByText('Reviewer')).toBeTruthy()
})

it('keeps session-scope runs between their neighboring turns without colliding with turn zero', () => {
  const events = [at(0, 'tool-workflow/run-start', { runId: 'a', name: 'Scope A' }),
    at(1, 'turn/start', { turn: 1 }), at(2, 'step/start', { turn: 1, step: 1 }),
    at(3, 'tool/call', { turn: 1, step: 1, callId: 'ordinary', name: 'read', arguments: '{}' }),
    at(4, 'turn/end', { turn: 1 }), at(5, 'tool-workflow/run-start', { runId: 'b', name: 'Scope B' }),
    at(6, 'turn/start', { turn: 0 }), at(7, 'tool-workflow/run-start', { runId: 'zero', name: 'Turn zero' })]
  const cards = new Map(toolCardRecords(events).map(record => [record.seq, record.block]))
  const groups = groupNativeTranscriptEvents(events, cards)
  expect(groups.map(group => [group.turn, group.events.map(event => event.seq)]))
    .toEqual([[undefined, [0]], [1, [3]], [undefined, [5]], [0, [7]]])
  expect(new Set(groups.map(group => group.key)).size).toBe(4)
  const { container } = render(<NativeTranscript {...props} snapshot={{ sessions: [], events, state: 'ready' }} />)
  expect([...container.querySelectorAll('[data-workflow-run], [data-chat-call-id]')]).toEqual([
    screen.getByText('Scope A').closest('[data-workflow-run]'),
    container.querySelector('[data-chat-call-id="ordinary"]'),
    screen.getByText('Scope B').closest('[data-workflow-run]'),
    screen.getByText('Turn zero').closest('[data-workflow-run]'),
  ])
  expect(container.querySelectorAll('[data-chat-turn="0"]')).toHaveLength(1)
})

it.each(['running', 'completed'] as const)('resets %s run disclosure when switching Sessions with identical sequences', (status) => {
  const events = status === 'running' ? history : [...history,
    at(5, 'tool-workflow/agent-end', { runId: 'run', seq: 1, outcome: 'completed' }),
    at(6, 'tool-workflow/run-end', { runId: 'run', stopReason: 'completed' })]
  const snapshot = { sessions: [], events, state: 'ready' as const }
  const { container, rerender } = render(<NativeTranscript {...props} snapshot={snapshot} />)
  const header = () => container.querySelector('[data-workflow-run] [data-disclosure-row]')!
  expect(header().getAttribute('aria-expanded')).toBe(status === 'running' ? 'true' : 'false')
  fireEvent.click(header())
  expect(header().getAttribute('aria-expanded')).toBe(status === 'running' ? 'false' : 'true')
  rerender(<NativeTranscript {...props} sessionId={'second' as SessionId} snapshot={snapshot} />)
  expect(header().getAttribute('aria-expanded')).toBe(status === 'running' ? 'true' : 'false')
})
