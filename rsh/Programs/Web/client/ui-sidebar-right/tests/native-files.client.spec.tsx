// @vitest-environment jsdom
import { ReadableStream, type ReadableStreamDefaultController } from 'node:stream/web'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NativeWorkspaceFilesClient } from '@deepseek-ai/dsh-client-native-session/native'
import { NativeFilesPanel, type NativeFilesPanelProps } from '../src/native-files.tsx'

afterEach(cleanup)

type WatchFrame = ReturnType<NativeWorkspaceFilesClient['follow']> extends AsyncIterable<infer Frame> ? Frame : never
type Page = Awaited<ReturnType<NativeWorkspaceFilesClient['read']>>
const t: NativeFilesPanelProps['t'] = key => key
const page = (text: string, lines: number, eof = false, version = 'v1', offset = 1): Page =>
  ({ text, lines, eof, version, offset, absolutePath: '/fixture/preview-data' })

function fixture() {
  let folderEntries = ['old-entry']
  const watches = new Set<ReadableStreamDefaultController<WatchFrame>>()
  const closed: Promise<undefined>[] = []
  const read = vi.fn<NativeWorkspaceFilesClient['read']>()
  const list = vi.fn<NativeWorkspaceFilesClient['list']>(async (_id, path) => ({ path, truncated: false,
    entries: path === '.' ? [{ name: 'folder', type: 'directory' }, { name: 'preview-data', type: 'file' }]
      : folderEntries.map(name => ({ name, type: 'file' })),
  }))
  const service: NativeWorkspaceFilesClient = {
    list, read,
    async stat() { throw new Error('unexpected stat') },
    async readAll() { throw new Error('unexpected byte read') },
    async readRelated() { throw new Error('unexpected related read') },
    async *follow(_id, signal) {
      const done = Promise.withResolvers<undefined>()
      closed.push(done.promise)
      let channel: ReadableStreamDefaultController<WatchFrame> | undefined
      const abort = (): void => { channel?.close() }
      const stream = new ReadableStream<WatchFrame>({ start(controller) {
        channel = controller
        watches.add(controller)
      } })
      signal.addEventListener('abort', abort, { once: true })
      try {
        yield { kind: 'ready' }
        for await (const frame of stream) yield frame
      } finally {
        signal.removeEventListener('abort', abort)
        if (channel !== undefined) watches.delete(channel)
        done.resolve(undefined)
      }
    },
  }
  function Panel() {
    const [section, setSection] = useState<'files' | 'preview'>('files')
    return <NativeFilesPanel sessionId={'session' as SessionId} workspaceRoot="/fixture" section={section}
      service={service} onOpenPreview={() => { setSection('preview') }} t={t} />
  }
  return { Panel, read, list,
    replaceFolder() { folderEntries = ['fresh-entry'] },
    emit(frame: WatchFrame) { for (const watch of watches) watch.enqueue(frame) },
    async closed() { await Promise.all(closed) },
  }
}

it.each([{ body: 'body' }])('retains empty line pages and reloads a reopened directory ($body)', async ({ body }) => {
  const state = fixture()
  const pages = [page('', 1), page('', 1, false, 'v1', 2), page(body, 1, false, 'v1', 3), page('', 0, true, 'v1', 4)]
  state.read.mockImplementation(async (_id, _path, range) => pages[(range.offset ?? 1) - 1] as Page)
  const view = render(<state.Panel />)
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'folder' }))
    await screen.findByRole('button', { name: 'old-entry' })
    fireEvent.click(screen.getByRole('button', { name: 'folder' }))
    state.replaceFolder()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'folder' })) })
    expect.soft(state.list.mock.calls.filter(call => call[1] === './folder')).toHaveLength(2)
    expect.soft(screen.queryByRole('button', { name: 'old-entry' })).toBeNull()
    expect.soft(screen.queryByRole('button', { name: 'fresh-entry' })).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'preview-data' }))
    await screen.findByRole('button', { name: 'loadMore' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'loadMore' })) })
    expect.soft(view.container.querySelector('pre')?.textContent).toBe('\n')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'loadMore' })) })
    expect.soft(view.container.querySelector('pre')?.textContent).toBe(`\n\n${body}`)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'loadMore' })) })
    expect(view.container.querySelector('pre')?.textContent).toBe(`\n\n${body}`)
    expect(screen.queryByRole('button', { name: 'loadMore' })).toBeNull()
    expect(state.read.mock.calls.map(call => call[2].offset)).toEqual([1, 2, 3, 4])
  } finally {
    await act(async () => { view.unmount() })
    await state.closed()
  }
})

it.each([{ fresh: 'fresh preview' }])('isolates preview lifecycle from unrelated observations and old pages ($fresh)', async ({ fresh }) => {
  const state = fixture()
  const oldSuccess = Promise.withResolvers<Page>()
  const oldFailure = Promise.withResolvers<Page>()
  let current = page('original preview', 1)
  let nextPage = 0
  let absent = false
  state.read.mockImplementation(async (_id, _path, range) => {
    if (range.offset === 1) {
      if (absent) throw new Error('file removed')
      return current
    }
    return nextPage++ === 0 ? oldSuccess.promise : oldFailure.promise
  })
  const view = render(<state.Panel />)
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'preview-data' }))
    await screen.findByRole('button', { name: 'loadMore' })
    fireEvent.click(screen.getByRole('button', { name: 'loadMore' }))
    await act(async () => { state.emit({ kind: 'change', change: { absolutePath: '/fixture/other', version: 'v2' } }) })
    expect.soft(state.read.mock.calls.filter(call => call[2].offset === 1)).toHaveLength(1)
    await act(async () => { state.emit({ kind: 'change', change: { absolutePath: current.absolutePath, version: 'v1' } }) })
    expect.soft(state.read.mock.calls.filter(call => call[2].offset === 1)).toHaveLength(1)

    current = page(fresh, 1, false, 'v2')
    await act(async () => { state.emit({ kind: 'change', change: { absolutePath: current.absolutePath, version: 'v2' } }) })
    await waitFor(() => { expect(view.container.querySelector('pre')?.textContent).toBe(fresh) })
    await act(async () => { oldSuccess.resolve(page('obsolete append', 1, false, 'v1', 2)) })
    expect.soft(view.container.querySelector('pre')?.textContent).toBe(fresh)

    fireEvent.click(screen.getByRole('button', { name: 'loadMore' }))
    current = page('manual refresh', 1, false, 'v2')
    fireEvent.click(screen.getByRole('button', { name: 'reloadPreview' }))
    await waitFor(() => { expect(view.container.querySelector('pre')?.textContent).toBe('manual refresh') })
    await act(async () => { oldFailure.reject(new Error('obsolete page failure')) })
    expect.soft(screen.queryByRole('alert')).toBeNull()
    expect.soft(view.container.querySelector('pre')?.textContent).toBe('manual refresh')

    absent = true
    await act(async () => { state.emit({ kind: 'change', change: { absolutePath: current.absolutePath, absent: true } }) })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'fileUnavailable')
  } finally {
    await act(async () => { view.unmount(); oldSuccess.resolve(page('', 0, true)); oldFailure.resolve(page('', 0, true)) })
    await state.closed()
  }
})
