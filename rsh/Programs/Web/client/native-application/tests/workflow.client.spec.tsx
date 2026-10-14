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

it('inserts exactly one run at its start sequence and keeps the ordinary tool row on restore and append', () => {
  expect(groupNativeTranscriptEvents([at(0, 'tool-workflow/run-start', { runId: 'empty', name: 'Empty' })], new Map())
    .map(turn => turn.events.map(event => event.seq))).toEqual([[0]])
  const cards = new Map(toolCardRecords(history).map(record => [record.seq, record.block]))
  expect(groupNativeTranscriptEvents(history, cards).map(turn => turn.events.map(event => event.seq))).toEqual([[2, 3]])
  const props = {
    sessionId: 'parent' as SessionId, locale: 'en' as const, loadImage: async () => new Blob(),
    t: makeTranslate(en), markdownLabels: { code: { copyLabel: 'Copy code', copiedLabel: 'Copied' }, footnotes: 'Footnotes' },
    imageGroupClassName: undefined, truncatedClassName: undefined,
  }
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
