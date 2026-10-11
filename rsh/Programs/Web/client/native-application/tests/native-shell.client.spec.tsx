// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { SESSION_FORMAT_VERSION, type SessionHeader, type SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  NativeSessionClient, NativeSessionListFrame, NativeSessionListItem,
} from '@deepseek-ai/dsh-client-native-session/native'
import type {
  NativeDirectoryPickerClient, NativeWorkspace, NativeWorkspaceBaseline, NativeWorkspaceClient, NativeWorkspaceFrame,
} from '@deepseek-ai/dsh-client-native-session/workspaces'
import { plugin as application } from '../src/native.ts'
import { plugin as locale } from '../../locale/src/native.ts'
import { plugin as renderer } from '../../ui-renderer/src/native.ts'
import { plugin as layout } from '../../ui-layout/src/native.ts'
import { plugin as sessionPresentation } from '../../ui-session/src/native.ts'
import { plugin as sidebar } from '../../ui-sidebar/src/native.ts'
import { plugin as rightbar } from '../../ui-sidebar-right/src/native.ts'
import { plugin as theme } from '../../ui-theme/src/native.ts'

const makeHeader = (id: string, cwd?: string): SessionHeader => ({
  version: SESSION_FORMAT_VERSION,
  id: id as SessionId,
  createdAt: 1,
  isSeeded: false,
  ...(cwd === undefined ? {} : { cwd }),
})

function frameChannel<T>() {
  const queued: T[] = []
  const waiters: Array<(value: T | undefined) => void> = []
  return {
    publish(value: T) {
      const waiter = waiters.shift()
      if (waiter === undefined) queued.push(value)
      else waiter(value)
    },
    take(signal: AbortSignal): Promise<T | undefined> {
      const value = queued.shift()
      if (value !== undefined) return Promise.resolve(value)
      return new Promise((resolve) => {
        const deliver = (next: T | undefined): void => {
          signal.removeEventListener('abort', abort)
          resolve(next)
        }
        const abort = (): void => {
          const index = waiters.indexOf(deliver)
          if (index !== -1) waiters.splice(index, 1)
          deliver(undefined)
        }
        waiters.push(deliver)
        signal.addEventListener('abort', abort, { once: true })
      })
    },
  }
}

const sessionProvider = (
  client: NativeSessionClient, workspace: NativeWorkspaceClient, directoryPicker: NativeDirectoryPickerClient,
): NativePlugin => ({
  apiVersion: 1,
  name: 'test-native-session-provider',
  targets: ['client'],
  requires: [],
  provides: ['clientNativeSession', 'clientNativeWorkspace', 'clientNativeDirectoryPicker'],
  resolve: () => (context) => {
    context.provide('clientNativeSession', client)
    context.provide('clientNativeWorkspace', workspace)
    context.provide('clientNativeDirectoryPicker', directoryPicker)
    context.own(() => client.close())
    context.own(() => workspace.close())
  },
})

const mountApplication = (container: HTMLElement): NativePlugin => ({
  apiVersion: 1,
  name: 'test-native-application-mount',
  targets: ['client'],
  requires: ['clientApplication', 'clientRenderer'],
  provides: [],
  resolve: () => (context) => {
    context.own(context.require('clientRenderer').mount(
      container, context.require('clientApplication'), context.signal,
    ))
  },
})

class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void { this.callback([], this) }
}

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  document.head.querySelectorAll('style[data-plugin="@deepseek-ai/dsh-client-ui-theme"], meta[name="theme-color"]')
    .forEach((element) => { element.remove() })
  document.documentElement.removeAttribute('lang')
  document.documentElement.style.removeProperty('color-scheme')
  document.body.removeAttribute('data-ds-dark-theme')
  document.body.style.removeProperty('--dsh-content-font-size')
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('installs modular Native navigation, Session selection, details, locale and theme, then drains them', async () => {
  vi.stubEnv('DSH_CLIENT_TITLE', 'Product')
  vi.stubGlobal('innerWidth', 1280)
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  const languageListeners = new Set<EventListener>()
  const mediaMock = {
    matches: false,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: EventListener) => { languageListeners.add(listener) }),
    removeEventListener: vi.fn((_type: string, listener: EventListener) => { languageListeners.delete(listener) }),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(() => true),
  }
  const media = mediaMock as unknown as MediaQueryList
  vi.stubGlobal('matchMedia', vi.fn(() => media))

  const activity = { updatedAt: 0, blank: false, running: false, completed: false, runningSubagentCount: 0, hasActiveSchedule: false }
  let rows: NativeSessionListItem[] = [
    { header: makeHeader('session-alpha', 'C:\\Work\\Shared'), titleProjection: { status: 'resolved', title: 'Alpha' },
      titleActions: { rename: true, refresh: true }, ...activity, workspaceId: 'workspace-shared' as NativeWorkspace['workspaceId'] },
    { header: makeHeader('session-beta', 'C:\\Work\\Shared'), titleProjection: { status: 'resolved', title: 'Beta' },
      titleActions: { rename: true, refresh: true }, ...activity, workspaceId: 'workspace-shared' as NativeWorkspace['workspaceId'] },
  ]
  const listFrames = frameChannel<NativeSessionListFrame>()
  const workspaceFrames = frameChannel<NativeWorkspaceFrame>()
  const workspaceId = 'workspace-shared' as NativeWorkspace['workspaceId']
  let workspaces: NativeWorkspace[] = [{
    workspaceId, path: 'C:\\Work\\Shared', title: 'Shared', createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z', sessionIds: ['session-alpha' as SessionId, 'session-beta' as SessionId],
  }]
  let archivedSessionIds: NativeWorkspaceBaseline['archivedSessionIds'] = []
  const workspaceBaseline = (): NativeWorkspaceBaseline => ({ workspaces, archivedSessionIds })
  const createWorkspace = vi.fn(async (input: Parameters<NativeWorkspaceClient['create']>[0]) => {
    const { path } = input
    const workspace: NativeWorkspace = {
      workspaceId: 'workspace-new' as NativeWorkspace['workspaceId'], path, title: 'New',
      createdAt: '2026-10-11T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z', sessionIds: [],
    }
    workspaces = [...workspaces, workspace]
    workspaceFrames.publish({ type: 'upsert', workspace })
    return { workspace, created: true }
  })
  const connectWorkspace = vi.fn(async (id: Parameters<NativeWorkspaceClient['connectWorkspace']>[0]) => {
    const sessionId = id === 'workspace-new' ? 'session-in-workspace' : 'session-alpha'
    if (!rows.some(row => row.header.id === sessionId)) {
      const workspace = workspaces.find(item => item.workspaceId === id)!
      const row: NativeSessionListItem = {
        header: makeHeader(sessionId, workspace.path), titleProjection: { status: 'absent' },
        ...activity, blank: true, workspaceId: id,
      }
      rows = [...rows, row]
      listFrames.publish({ type: 'upsert', item: row })
    }
    return { sessionId: sessionId as NativeSessionListItem['header']['id'] }
  })
  const pickDirectory = vi.fn(async () => 'C:\\Work\\New')
  const workspaceClient: NativeWorkspaceClient = {
    async list() { return workspaceBaseline() },
    async *follow(signal) {
      yield { type: 'baseline', value: workspaceBaseline() }
      while (true) {
        const frame = await workspaceFrames.take(signal)
        if (frame === undefined) return
        yield frame
      }
    },
    create: createWorkspace,
    rename: vi.fn(async (id: Parameters<NativeWorkspaceClient['rename']>[0], title: string) => {
      const workspace = workspaces.find(item => item.workspaceId === id)!
      const updated = { ...workspace, title }
      workspaces = workspaces.map(item => item.workspaceId === id ? updated : item)
      workspaceFrames.publish({ type: 'upsert', workspace: updated })
      return updated
    }),
    delete: vi.fn(async (id: Parameters<NativeWorkspaceClient['delete']>[0]) => {
      workspaces = workspaces.filter(item => item.workspaceId !== id)
      workspaceFrames.publish({ type: 'remove', workspaceId: id })
    }),
    reorder: vi.fn(async () => []), reorderSession: vi.fn(async id => workspaces.find(item => item.workspaceId === id)!),
    archiveSession: vi.fn(async (id) => {
      archivedSessionIds = [...archivedSessionIds, id]
      workspaceFrames.publish({ type: 'archived', archivedSessionIds })
      return archivedSessionIds
    }),
    search: vi.fn(async () => []),
    connectWorkspace,
    close: vi.fn(async () => undefined),
  }
  const directoryPicker: NativeDirectoryPickerClient = {
    pick: pickDirectory, list: vi.fn(), createDirectory: vi.fn(),
  }
  const close = vi.fn(async () => undefined)
  const clientMock = {
    close,
    settingsDescribe: vi.fn(),
    settingsMutate: vi.fn(),
    credentialsDescribe: vi.fn(),
    authorizationList: vi.fn(async () => []), authorizationBegin: vi.fn(), authorizationFrames: vi.fn(),
    authorizationAnswer: vi.fn(), authorizationDecline: vi.fn(), authorizationCancel: vi.fn(),
    accountsList: vi.fn(), accountsUsage: vi.fn(), accountsBalance: vi.fn(), accountsSignOut: vi.fn(),
    modelsListProviders: vi.fn(async () => []), modelsListConfigurableProviders: vi.fn(async () => []),
    modelsDiscover: vi.fn(async () => []), settingsEvents: async function* () {},
    agentPresetsList: vi.fn(async () => ({ default: null, presets: [] })),
    credentialsSet: vi.fn(),
    credentialsUnset: vi.fn(),
    list: vi.fn(async () => rows),
    async *follow(signal: AbortSignal) {
      yield { type: 'baseline', items: rows }
      while (true) {
        const frame = await listFrames.take(signal)
        if (frame === undefined) return
        yield frame
      }
    },
    search: vi.fn(async () => ({ items: [{ sessionId: 'session-alpha' as NativeSessionListItem['header']['id'],
      title: 'Refreshed Alpha', workspaceId, snippet: 'Needle in transcript' }] })),
    archive: vi.fn(async (id: NativeSessionListItem['header']['id']) => {
      rows = rows.filter(row => row.header.id !== id)
      listFrames.publish({ type: 'remove', sessionId: id })
      await workspaceClient.archiveSession(id)
    }),
    modelControls: vi.fn(async () => ({ catalog: null, canSelectModel: false, presets: [] })),
    history: vi.fn(async (id: SessionId) => {
      const row = rows.find(candidate => candidate.header.id === id)
      if (row === undefined) throw new Error(`unknown test Session ${id}`)
      return { header: row.header, events: [], inheritedEventCount: 0 }
    }),
    create: vi.fn(async () => {
      const header = makeHeader('session-created')
      rows = [...rows, { header, titleProjection: { status: 'absent' }, titleActions: { rename: true, refresh: true }, ...activity, blank: true }]
      listFrames.publish({ type: 'upsert', item: rows.at(-1)! })
      return { sessionId: header.id }
    }),
    renameTitle: vi.fn(async (id: SessionId, title: string) => {
      rows = rows.map(row => row.header.id === id ? { ...row, titleProjection: { status: 'resolved', title } } : row)
      const item = rows.find(row => row.header.id === id)!
      listFrames.publish({ type: 'upsert', item })
    }),
    refreshTitle: vi.fn(async (id: SessionId) => {
      rows = rows.map(row => row.header.id === id ? { ...row, titleProjection: { status: 'resolved', title: 'Refreshed Alpha' } } : row)
      const item = rows.find(row => row.header.id === id)!
      listFrames.publish({ type: 'upsert', item })
    }),
  }
  const client = clientMock as unknown as NativeSessionClient

  const container = document.createElement('div')
  document.body.append(container)
  const scope = new NativeScope()
  const host = new NativeHost(resolveInstallation([
    { plugin: sessionProvider(client, workspaceClient, directoryPicker), scope, config: undefined },
    { plugin: renderer, scope, config: undefined },
    { plugin: locale, scope, config: { locale: 'en' } },
    { plugin: theme, scope, config: undefined },
    { plugin: application, scope, config: { maxLiveTextChars: 1024, maxLiveEvents: 128 } },
    { plugin: sessionPresentation, scope, config: undefined },
    { plugin: layout, scope, config: undefined },
    { plugin: sidebar, scope, config: undefined },
    { plugin: rightbar, scope, config: undefined },
    { plugin: mountApplication(container), scope, config: undefined },
  ], 'client'))

  const originalLanguage = document.documentElement.lang
  try {
    await host.start()
    await screen.findByRole('treeitem', { name: 'Shared' })
    const workspaceRows = within(screen.getByRole('tree', { name: 'Workspaces' }))
    const alphaRow = workspaceRows.getByRole('treeitem', { name: /Alpha/ })
    expect(workspaceRows.getByRole('treeitem', { name: /Beta/ })).toBeTruthy()
    expect(document.head.querySelectorAll('style[data-plugin="@deepseek-ai/dsh-client-ui-theme"]')).toHaveLength(7)
    const activeRow = { ...rows.find(row => row.header.id === 'session-alpha')!, updatedAt: Date.now(), running: true,
      pendingInteraction: { kind: 'approval' as const } }
    rows = rows.map(row => row.header.id === activeRow.header.id ? activeRow : row)
    listFrames.publish({ type: 'upsert', item: activeRow })
    await within(alphaRow).findByText('now')
    expect(within(alphaRow).getByText('Waiting for approval')).toBeTruthy()
    expect(clientMock.list).not.toHaveBeenCalled()

    fireEvent.click(alphaRow)
    await waitFor(() => { expect(document.title).toBe('Alpha — Product') })
    expect(clientMock.history).toHaveBeenCalledWith('session-alpha', expect.any(AbortSignal))

    fireEvent.click(within(alphaRow).getByRole('button', { name: 'Session actions for Alpha' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Session title' }), { target: { value: 'Renamed Alpha' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('treeitem', { name: /Renamed Alpha/ })
    expect(clientMock.renameTitle).toHaveBeenCalledWith('session-alpha', 'Renamed Alpha', expect.any(AbortSignal))
    const renamedRow = screen.getByRole('treeitem', { name: /Renamed Alpha/ })
    fireEvent.click(within(renamedRow).getByRole('button', { name: 'Session actions for Renamed Alpha' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh title' }))
    await screen.findByRole('treeitem', { name: /Refreshed Alpha/ })
    expect(clientMock.refreshTitle).toHaveBeenCalledWith('session-alpha', expect.any(AbortSignal))

    fireEvent.click(screen.getByRole('button', { name: 'Session details' }))
    expect(screen.getByRole('complementary', { name: 'Session details' })).toBeTruthy()
    expect(screen.getByText('C:\\Work\\Shared')).toBeTruthy()
    fireEvent.click(screen.getByRole('treeitem', { name: /Beta/ }))
    await screen.findByText('C:\\Work\\Shared')
    await waitFor(() => { expect(document.title).toBe('Beta — Product') })

    const createButton = screen.getByText('New Session').closest('button')
    expect(createButton).not.toBeNull()
    fireEvent.click(createButton!)
    await screen.findByRole('treeitem', { name: /New Session/ })
    expect(clientMock.create).toHaveBeenCalledOnce()
    expect(clientMock.history).toHaveBeenLastCalledWith('session-created', expect.any(AbortSignal))

    fireEvent.click(screen.getByRole('button', { name: 'Search sessions' }))
    const search = screen.getByPlaceholderText('Search sessions…')
    fireEvent.change(search, { target: { value: 'Needle' } })
    const searchResult = await screen.findByRole('treeitem', { name: /Needle in transcript/ })
    expect(clientMock.search).toHaveBeenCalledWith('Needle', undefined, expect.any(AbortSignal))
    fireEvent.click(searchResult)
    await waitFor(() => { expect(clientMock.history).toHaveBeenLastCalledWith('session-alpha', expect.any(AbortSignal)) })
    await waitFor(() => { expect(screen.queryByRole('treeitem', { name: /Needle in transcript/ })).toBeNull() })

    const refreshedRow = await screen.findByRole('treeitem', { name: /Refreshed Alpha/ })
    fireEvent.click(within(refreshedRow).getByRole('button', { name: 'Session actions for Refreshed Alpha' }))
    expect(screen.queryByRole('menuitem', { name: 'Delete session' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive session' }))
    await waitFor(() => { expect(clientMock.archive).toHaveBeenCalledWith('session-alpha', expect.any(AbortSignal)) })
    await waitFor(() => { expect(screen.queryByRole('treeitem', { name: /Refreshed Alpha/ })).toBeNull() })

    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }))
    await waitFor(() => { expect(connectWorkspace).toHaveBeenCalledWith('workspace-new', expect.any(AbortSignal)) })
    expect(pickDirectory).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(createWorkspace).toHaveBeenCalledWith({ path: 'C:\\Work\\New' }, expect.any(AbortSignal))
    await waitFor(() => { expect(clientMock.history).toHaveBeenLastCalledWith('session-in-workspace', expect.any(AbortSignal)) })

    fireEvent.click(screen.getByRole('button', { name: 'Switch language' }))
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(screen.getByRole('button', { name: '会话详情' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '切换主题' }))
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    const settingsDialog = screen.getByRole('dialog', { name: '设置' })
    const settingsNav = within(settingsDialog).getByRole('navigation')
    expect(within(settingsNav).getAllByRole('button').map(button => button.textContent?.trim())).toEqual([
      '通用设置', '任务中心', '模型', '插件', 'Agent 预设',
    ])
    fireEvent.click(within(settingsDialog).getByRole('button', { name: '模型' }))
    expect(within(settingsDialog).getByRole('heading', { name: '模型' })).toBeTruthy()
    expect(within(settingsDialog).getByRole('button', { name: '模型' }).getAttribute('aria-current')).toBe('true')
    fireEvent.click(within(settingsDialog).getByRole('button', { name: '关闭设置' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(screen.getByRole('dialog', { name: '设置' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    await host.stop()
    expect(container.childElementCount).toBe(0)
    expect(document.head.querySelectorAll('style[data-plugin="@deepseek-ai/dsh-client-ui-theme"]')).toHaveLength(0)
    expect(document.head.querySelector('meta[name="theme-color"]')).toBeNull()
    expect(document.documentElement.lang).toBe(originalLanguage)
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    expect(document.body.style.getPropertyValue('--dsh-content-font-size')).toBe('')
    expect(mediaMock.removeEventListener).toHaveBeenCalledOnce()
    expect(languageListeners.size).toBe(0)
    expect(close).toHaveBeenCalledOnce()
    expect(host.diagnostics().every(item => item.state === 'disposed' && item.cleanup === 'complete')).toBe(true)
  } finally {
    await host.stop()
  }
})
