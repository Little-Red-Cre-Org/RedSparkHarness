// @vitest-environment jsdom
/** Native delivery folding and the declared-file row over the authenticated open routes. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionId } from '@redspark/rsh-session/types'
import type { SessionEvent } from '@redspark/rsh-session/types'
import { foldDeliverables, NativePresentedFiles, PresentedOpenController } from '../src/native.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const sessionId = SessionId('presented-native')

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq * 1_000, type, data,
    ...(type === 'tool/result' ? { surfaceOp: 'append' } : {}) } as SessionEvent
}

it('folds produced and declared files from one log without failed or foreign calls', () => {
  const events: SessionEvent[] = [
    event(0, 'tool/call', { turn: 1, step: 0, callId: 'write-1', name: 'write',
      arguments: JSON.stringify({ file_path: 'report.txt', content: 'report' }) }),
    event(1, 'tool/call', { turn: 1, step: 0, callId: 'read-1', name: 'read',
      arguments: JSON.stringify({ file_path: 'ignored.txt' }) }),
    event(2, 'tool/result', { turn: 1, step: 0, message: { id: 'r1', role: 'tool',
      content: [{ type: 'text', text: 'ok' }], source: { kind: 'tool', callId: 'write-1' } } }),
    event(3, 'tool/result', { turn: 1, step: 0, message: { id: 'r2', role: 'tool',
      content: [{ type: 'text', text: 'missing' }], source: { kind: 'tool', callId: 'read-1' } } }),
    event(4, 'deliverables/presented', { turn: 1, callId: 'present-1',
      files: [{ path: 'report.txt', description: 'Final report' }, { path: '说明.txt' }, null] }),
    event(5, 'tool/call', { turn: 2, step: 0, callId: 'edit-1', name: 'edit',
      arguments: JSON.stringify({ file_path: 'report.txt', old_string: 'a', new_string: 'b' }) }),
    event(6, 'tool/result', { turn: 2, step: 0, message: { id: 'r3', role: 'tool',
      content: [{ type: 'text', text: 'denied', isError: true }], source: { kind: 'tool', callId: 'edit-1' } } }),
  ]
  expect(foldDeliverables(events)).toEqual([
    { turn: 1, produced: ['report.txt'], presented: [
      { path: 'report.txt', description: 'Final report', seq: 4, index: 0 },
      { path: '说明.txt', seq: 4, index: 1 },
    ] },
  ])
})

it('opens and reveals declared files through the authenticated Native routes', async () => {
  const url = (input: RequestInfo | URL): string =>
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (url(input) === '/api/present.host') {
      return Promise.resolve(Response.json({ name: 'desktop', available: true, fileManager: 'finder' }))
    }
    expect(init?.method).toBe('POST')
    return Promise.resolve(new Response(null, { status: 204 }))
  })
  vi.stubGlobal('fetch', fetcher)
  const controller = new PresentedOpenController()
  render(<NativePresentedFiles sessionId={sessionId} cwd="/work" controller={controller} locale="en"
    files={[{ path: 'report.txt', description: 'Final report', seq: 4, index: 0 },
      { path: '说明.txt', seq: 4, index: 1 }]} />)
  const open = await screen.findByRole('button', { name: 'Open report.txt in default app' })
  await waitFor(() => { expect(open).toHaveProperty('disabled', false) })
  expect(screen.getByText('Final report')).toBeTruthy()
  fireEvent.click(open)
  await waitFor(() => {
    expect(fetcher).toHaveBeenCalledWith('/api/present.open?sessionId=presented-native&seq=4&index=0',
      expect.objectContaining({ method: 'POST' }))
  })
  expect(fetcher.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  fireEvent.click(screen.getByRole('button', { name: 'Show 说明.txt in file manager' }))
  await waitFor(() => {
    expect(fetcher).toHaveBeenCalledWith('/api/present.open?sessionId=presented-native&seq=4&index=1&action=reveal',
      expect.objectContaining({ method: 'POST' }))
  })
  expect(fetcher.mock.calls[2]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  expect(document.querySelector('[data-presented-files-row]')).not.toBeNull()
  expect(document.querySelectorAll('[data-presented-file]')).toHaveLength(2)
  await controller.dispose()
})

it('keeps actions disabled when the Host has no desktop', async () => {
  const controller = new PresentedOpenController()
  controller.host.set({ name: 'desktop', available: false, fileManager: null })
  render(<NativePresentedFiles sessionId={sessionId} cwd="/work" controller={controller} locale="en"
    files={[{ path: 'report.txt', seq: 4, index: 0 }]} />)
  expect(screen.getByText('This Host has no desktop available to open files or folders')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Open report.txt in default app' })).toHaveProperty('disabled', true)
  await controller.dispose()
})
