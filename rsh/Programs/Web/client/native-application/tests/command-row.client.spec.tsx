// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionEvent } from '@redspark/rsh-session/types'
import type { TranslateNS } from '@redspark/rsh-client-ui-slots'
import { foldNativeCommands, NativeCommandRow } from '../src/command-row.tsx'
import { groupNativeTranscriptEvents } from '../src/native-transcript.tsx'
import { en } from '../src/locales.ts'

afterEach(() => { cleanup() })

const t = ((key: keyof typeof en) => en[key]) as TranslateNS<'nativeApplication'>

function run(seq: number, commandId: string, name: string): SessionEvent {
  return { type: 'command/run', seq, time: seq, data: { commandId, name, source: { kind: 'user' } } } as unknown as SessionEvent
}

function done(seq: number, commandId: string, kind: 'success' | 'error', text?: string): SessionEvent {
  return { type: 'command/done', seq, time: seq, data: { commandId, kind, ...text === undefined ? {} : { text } } } as unknown as SessionEvent
}

describe('native command rows', () => {
  it('folds a paired lifecycle into one row anchored at the run', () => {
    const records = foldNativeCommands([run(4, 'cmd-1', 'feedback'), done(6, 'cmd-1', 'success', 'Feedback recorded.')])

    expect([...records.keys()]).toEqual([4])
    expect(records.get(4)).toEqual({ seq: 4, name: 'feedback', outcome: { kind: 'success', text: 'Feedback recorded.' } })
  })

  it('keeps a run without its done executing', () => {
    expect(foldNativeCommands([run(4, 'cmd-1', 'compact')]).get(4)?.outcome).toBeNull()
  })

  it('keeps a settled command outside any turn as its own session-scope row', () => {
    const events = [
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } } as unknown as SessionEvent,
      { type: 'turn/end', seq: 1, time: 1, data: { turn: 1 } } as unknown as SessionEvent,
      run(2, 'cmd-1', 'feedback'), done(3, 'cmd-1', 'success', 'Feedback recorded.'),
    ]
    const commands = foldNativeCommands(events)

    expect(groupNativeTranscriptEvents(events, new Map(), commands).map(group => [group.turn, group.events.map(event => event.seq)]))
      .toEqual([[undefined, [2]]])
  })

  it('keeps a done whose run fell outside the window, without a name', () => {
    const records = foldNativeCommands([done(9, 'cmd-1', 'error', 'No such command')])

    expect(records.get(9)).toEqual({ seq: 9, name: null, outcome: { kind: 'error', text: 'No such command' } })
  })

  it('renders the running row with a hidden running label', () => {
    render(<NativeCommandRow record={{ seq: 4, name: 'compact', outcome: null }} t={t} />)

    expect(screen.getByText('compact')).toBeTruthy()
    expect(screen.getByText(en.commandRunning)).toBeTruthy()
    expect(screen.getByText(en.rowRunning)).toBeTruthy()
  })

  it('expands a multi-line settlement and keeps single-line output collapsed', () => {
    const { container, rerender } = render(
      <NativeCommandRow record={{ seq: 4, name: 'compact', outcome: { kind: 'success', text: 'line one\nline two' } }} t={t} />,
    )
    const row = container.querySelector<HTMLElement>('[data-command-row] [data-disclosure-row]')
    if (row === null) throw new Error('command row missing')
    expect(row.textContent).toContain('line one')
    expect(container.querySelector('pre')).toBeNull()

    fireEvent.click(row)
    expect(container.querySelector('pre')?.textContent).toBe('line one\nline two')

    rerender(<NativeCommandRow record={{ seq: 4, name: 'compact', outcome: { kind: 'error', text: 'failed' } }} t={t} />)
    expect(container.querySelector('[data-command-row]')?.getAttribute('data-state')).toBe('error')
    expect(container.querySelector('[data-disclosure-row] button')).toBeNull()
  })
})
