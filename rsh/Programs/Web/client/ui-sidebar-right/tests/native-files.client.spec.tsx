// @vitest-environment jsdom
import { ReadableStream, type ReadableStreamDefaultController } from 'node:stream/web'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionId } from '@redspark/rsh-session/types'
import type { NativeWorkspaceFilesClient } from '@redspark/rsh-client-native-session/native'
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
  const readAll = vi.fn<NativeWorkspaceFilesClient['readAll']>()
  const readRelated = vi.fn<NativeWorkspaceFilesClient['readRelated']>()
  const list = vi.fn<NativeWorkspaceFilesClient['list']>(async (_id, path) => ({ path, truncated: false,
    entries: path === '.' ? [{ name: 'folder', type: 'directory' }, { name: 'preview-data', type: 'file' }]
      : folderEntries.map(name => ({ name, type: 'file' })),
  }))
  const service: NativeWorkspaceFilesClient = {
    list, read,
    async stat() { throw new Error('unexpected stat') },
    readAll, readRelated,
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
  return { Panel, service, read, list, readAll, readRelated,
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

it.each(['v1', 'v2', 'absent'])('compares an in-flight preview response with observation %s', async (observed) => {
  const state = fixture()
  const first = Promise.withResolvers<Page>()
  state.read.mockImplementationOnce(() => first.promise).mockImplementation(async () => {
    if (observed === 'absent') throw new Error('file removed')
    return page('fresh preview', 1, true, 'v2')
  })
  const view = render(<state.Panel />)
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'preview-data' }))
    await waitFor(() => { expect(state.read).toHaveBeenCalledTimes(1) })
    await act(async () => { state.emit({ kind: 'change', change: observed === 'absent'
      ? { absolutePath: '/fixture/preview-data', absent: true }
      : { absolutePath: '/fixture/preview-data', version: observed } }) })
    await act(async () => { first.resolve(page('stale preview', 1, true, 'v1')) })
    if (observed === 'absent') await screen.findByRole('alert')
    else await waitFor(() => { expect(view.container.querySelector('pre')?.textContent).toBe(observed === 'v1' ? 'stale preview' : 'fresh preview') })
    expect(state.read).toHaveBeenCalledTimes(observed === 'v1' ? 1 : 2)
  } finally {
    first.resolve(page('stale preview', 1, true, 'v1'))
    await act(async () => { view.unmount() })
    await state.closed()
  }
})

it.each([false, true, 'pending'] as const)('refreshes HTML dependencies (initially missing: %s)', async (initiallyMissing) => {
  const state = fixture()
  const descriptors = new Map(['createObjectURL', 'revokeObjectURL'].map(key => [key, Object.getOwnPropertyDescriptor(URL, key)]))
  let unmount: (() => void) | undefined
  const pendingFailure = Promise.withResolvers<Awaited<ReturnType<NativeWorkspaceFilesClient['readRelated']>>>()
  let sequence = 0
  try {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => `blob:review-${++sequence}` })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} })
    state.list.mockResolvedValue({ path: '.', truncated: false, entries: [{ name: 'index.html', type: 'file' }] })
    state.readAll.mockImplementation(async () => ({ absolutePath: '/fixture/index.html', version: 'html-v1',
      offset: 0, eof: true, data: btoa('<script src="app.js"></script>') }))
    const related = state.readRelated.mockImplementation(async () => ({ absolutePath: '/fixture/app.js', version: 'js-v1', offset: 0, eof: true, data: btoa('window.marker = 1') }))
    if (initiallyMissing === 'pending') related.mockImplementationOnce(() => pendingFailure.promise)
    else if (initiallyMissing) related.mockRejectedValueOnce(new Error('dependency not created yet'))
    const extra = initiallyMissing ? 1 : 0
    const view = render(<state.Panel />)
    unmount = () => { view.unmount() }
    fireEvent.click(await screen.findByRole('button', { name: 'index.html' }))
    if (initiallyMissing) {
      if (initiallyMissing === 'pending') await waitFor(() => { expect(related).toHaveBeenCalledTimes(1) })
      else await screen.findByRole('alert')
      await act(async () => {
        state.emit({ kind: 'change', change: { absolutePath: '/fixture/index.html', version: 'html-v1' } })
        state.emit({ kind: 'change', change: { absolutePath: '/fixture/app.js', absent: true } })
      })
      expect(related).toHaveBeenCalledTimes(1)
      await act(async () => { state.emit({ kind: 'change', change: { absolutePath: '/fixture/app.js', version: 'js-v1' } }) })
      if (initiallyMissing === 'pending') await act(async () => { pendingFailure.reject(new Error('delayed missing dependency response')) })
    }
    await waitFor(() => { expect(view.container.querySelector('iframe')).not.toBeNull() })
    expect(related).toHaveBeenCalledTimes(1 + extra)
    await act(async () => {
      state.emit({ kind: 'change', change: { absolutePath: '/fixture/unrelated.js', version: 'v2' } })
      state.emit({ kind: 'change', change: { absolutePath: '/fixture/app.js', version: 'js-v1' } })
    })
    expect(related).toHaveBeenCalledTimes(1 + extra)
    related.mockResolvedValue({ absolutePath: '/fixture/app.js', version: 'js-v2', offset: 0, eof: true, data: btoa('window.marker = 2') })
    await act(async () => { state.emit({ kind: 'change', change: { absolutePath: '/fixture/app.js', version: 'js-v2' } }) })
    await waitFor(() => { expect(related).toHaveBeenCalledTimes(2 + extra) })
    related.mockRejectedValueOnce(new Error('dependency removed'))
    await act(async () => { state.emit({ kind: 'change', change: { absolutePath: '/fixture/app.js', absent: true } }) })
    await screen.findByRole('alert')
    await act(async () => { state.emit({ kind: 'change', change: { absolutePath: '/fixture/app.js', version: 'js-v2' } }) })
    await waitFor(() => { expect(view.container.querySelector('iframe')).not.toBeNull() })
    expect(related).toHaveBeenCalledTimes(4 + extra)
    state.readAll.mockResolvedValue({ absolutePath: '/fixture/index.html', version: 'html-v2',
      offset: 0, eof: true, data: btoa('<p>No dependencies</p>') })
    await act(async () => { state.emit({ kind: 'change', change: { absolutePath: '/fixture/index.html', version: 'html-v2' } }) })
    await waitFor(() => { expect(view.container.querySelector('iframe')).not.toBeNull() })
    expect(state.readAll).toHaveBeenCalledTimes(5 + extra)
    await act(async () => { state.emit({ kind: 'change', change: { absolutePath: '/fixture/app.js', version: 'js-v3' } }) })
    expect(state.readAll).toHaveBeenCalledTimes(5 + extra)
  } finally {
    pendingFailure.resolve({ absolutePath: '/fixture/app.js', version: 'js-v1', offset: 0, eof: true, data: btoa('') })
    await act(async () => { unmount?.() })
    await state.closed()
    for (const [key, descriptor] of descriptors) {
      if (descriptor === undefined) Reflect.deleteProperty(URL, key)
      else Object.defineProperty(URL, key, descriptor)
    }
  }
})

it('keeps a second opened file, switches documents, and closes one tab', async () => {
  const state = fixture()
  state.list.mockResolvedValue({ path: '.', truncated: false, entries: [
    { name: 'alpha.txt', type: 'file' }, { name: 'beta.txt', type: 'file' },
  ] })
  state.read.mockImplementation(async (_id, path) => page(path, 1, true))
  function Panel() {
    const [section, setSection] = useState<'files' | 'preview'>('files')
    return <>
      <button type="button" onClick={() => { setSection('files') }}>show-files</button>
      <NativeFilesPanel sessionId={'session' as SessionId} workspaceRoot="/fixture" section={section}
        service={state.service} onOpenPreview={() => { setSection('preview') }} t={t} />
    </>
  }
  const view = render(<Panel />)
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'alpha.txt' }))
    await waitFor(() => { expect(view.container.querySelector('pre')?.textContent).toBe('./alpha.txt') })
    fireEvent.click(screen.getByRole('button', { name: 'show-files' }))
    fireEvent.click(screen.getByRole('button', { name: 'beta.txt' }))
    await waitFor(() => { expect(view.container.querySelector('pre')?.textContent).toBe('./beta.txt') })
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['alpha.txt', 'beta.txt'])
    fireEvent.click(screen.getByRole('tab', { name: 'alpha.txt' }))
    await waitFor(() => { expect(view.container.querySelector('pre')?.textContent).toBe('./alpha.txt') })
    fireEvent.click(screen.getAllByRole('button', { name: 'closeDocument' })[1]!)
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['alpha.txt'])
    expect(view.container.querySelector('pre')?.textContent).toBe('./alpha.txt')
    fireEvent.click(screen.getByRole('button', { name: 'closeDocument' }))
    expect(screen.queryByRole('tab')).toBeNull()
    expect(view.container.textContent).toContain('chooseFile')
  } finally {
    await act(async () => { view.unmount() })
    await state.closed()
  }
})

it.each([
  { kind: 'session', sessionId: 'other-session' as SessionId, workspaceRoot: '/fixture' },
  { kind: 'workspace', sessionId: 'session' as SessionId, workspaceRoot: '/other-root' },
])('drops open documents when $kind changes', async ({ sessionId, workspaceRoot }) => {
  const state = fixture()
  state.list.mockResolvedValue({ path: '.', truncated: false, entries: [
    { name: 'alpha.txt', type: 'file' }, { name: 'beta.txt', type: 'file' },
  ] })
  state.read.mockImplementation(async (id, path) => page(`${id}:${path}`, 1, true))
  function Panel() {
    const [scope, setScope] = useState({ sessionId: 'session' as SessionId, workspaceRoot: '/fixture' })
    const [section, setSection] = useState<'files' | 'preview'>('files')
    return <>
      <button type="button" onClick={() => { setScope({ sessionId, workspaceRoot }) }}>switch-scope</button>
      <button type="button" onClick={() => { setSection('files') }}>show-files</button>
      <NativeFilesPanel sessionId={scope.sessionId} workspaceRoot={scope.workspaceRoot} section={section}
        service={state.service} onOpenPreview={() => { setSection('preview') }} t={t} />
    </>
  }
  const view = render(<Panel />)
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'alpha.txt' }))
    await waitFor(() => { expect(view.container.querySelector('pre')?.textContent).toBe('session:./alpha.txt') })
    fireEvent.click(screen.getByRole('button', { name: 'show-files' }))
    fireEvent.click(screen.getByRole('button', { name: 'beta.txt' }))
    await waitFor(() => { expect(screen.getAllByRole('tab')).toHaveLength(2) })
    const reads = state.read.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'switch-scope' }))
    expect(screen.queryByRole('tab')).toBeNull()
    expect(view.container.textContent).toContain('chooseFile')
    expect(state.read.mock.calls).toHaveLength(reads)
    expect(state.read.mock.calls.every(call => call[0] === 'session')).toBe(true)
  } finally {
    await act(async () => { view.unmount() })
    await state.closed()
  }
})

it('rereads the adjacent document after closing the current tab', async () => {
  const state = fixture()
  state.list.mockResolvedValue({ path: '.', truncated: false, entries: [
    { name: 'alpha.txt', type: 'file' }, { name: 'beta.txt', type: 'file' }, { name: 'gamma.txt', type: 'file' },
  ] })
  state.read.mockImplementation(async (_id, path) => page(path, 1, true))
  let section: 'files' | 'preview' = 'files'
  const draw = (): void => {
    view.rerender(<NativeFilesPanel sessionId={'session' as SessionId} workspaceRoot="/fixture" section={section}
      service={state.service} onOpenPreview={() => { section = 'preview'; draw() }} t={t} />)
  }
  const view = render(<NativeFilesPanel sessionId={'session' as SessionId} workspaceRoot="/fixture" section={section}
    service={state.service} onOpenPreview={() => { section = 'preview'; draw() }} t={t} />)
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'alpha.txt' }))
    section = 'files'
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'beta.txt' }))
    section = 'files'
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'gamma.txt' }))
    await waitFor(() => { expect(view.container.querySelector('pre')?.textContent).toBe('./gamma.txt') })
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['alpha.txt', 'beta.txt', 'gamma.txt'])
    const reads = state.read.mock.calls.length
    fireEvent.click(screen.getAllByRole('button', { name: 'closeDocument' })[2]!)
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['alpha.txt', 'beta.txt'])
    expect(screen.getByRole('tab', { name: 'beta.txt', selected: true })).toBeTruthy()
    await waitFor(() => { expect(view.container.querySelector('pre')?.textContent).toBe('./beta.txt') })
    expect(state.read.mock.calls.slice(reads).map(call => call[1])).toEqual(['./beta.txt'])
  } finally {
    await act(async () => { view.unmount() })
    await state.closed()
  }
})
