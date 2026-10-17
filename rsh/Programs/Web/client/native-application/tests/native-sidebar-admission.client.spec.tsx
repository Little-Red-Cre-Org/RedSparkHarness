// @vitest-environment jsdom
/** Sidebar Session admission against newer navigation, cancelled trust prompts, and a late Workspace baseline. */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { SESSION_FORMAT_VERSION, SessionSeq, type SessionHeader, type SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  NativePendingSubmission, NativeSubmissionsSnapshot, NativeScheduleClient, NativeSessionClient,
  NativeSessionListFrame, NativeSessionListItem, NativeSettingsEvent,
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
import { en } from '../../ui-sidebar/src/locales.ts'
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
  provides: ['clientNativeSession', 'clientNativeSchedule', 'clientNativeWorkspace', 'clientNativeDirectoryPicker'],
  resolve: () => (context) => {
    const schedules: NativeScheduleClient = {
      list: async () => [],
      follow: async function* () { yield { type: 'baseline', jobs: [] } },
    }
    context.provide('clientNativeSession', client)
    context.provide('clientNativeSchedule', schedules)
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
  localStorage.clear()
  document.head.querySelectorAll('style[data-plugin="@deepseek-ai/dsh-client-ui-theme"], meta[name="theme-color"]')
    .forEach((element) => { element.remove() })
  document.documentElement.removeAttribute('lang')
  document.documentElement.style.removeProperty('color-scheme')
  document.body.removeAttribute('data-ds-dark-theme')
  document.body.style.removeProperty('--dsh-content-font-size')
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** Mount the native shell over three Sessions in one Workspace; the Workspace baseline waits for `baselineGate`. */
async function harness(baselineGate: Promise<void> = Promise.resolve()) {
  localStorage.setItem('dsh.native.onboarding.welcome', '2026-08-13.1')
  vi.stubEnv('DSH_CLIENT_TITLE', 'Product')
  vi.stubGlobal('innerWidth', 1280)
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  const media = {
    matches: false, media: '(prefers-color-scheme: dark)', onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } as unknown as MediaQueryList
  vi.stubGlobal('matchMedia', vi.fn(() => media))
  const activity = { updatedAt: 0, blank: false, running: false, completed: false, runningSubagentCount: 0, hasActiveSchedule: false }
  let rows: NativeSessionListItem[] = [
    { header: makeHeader('session-alpha', 'C:\\Work\\Shared'), titleProjection: { status: 'resolved', title: 'Alpha' },
      titleActions: { rename: true, refresh: true }, ...activity, workspaceId: 'workspace-shared' as NativeWorkspace['workspaceId'] },
    { header: makeHeader('session-beta', 'C:\\Work\\Shared'), titleProjection: { status: 'resolved', title: 'Beta' },
      titleActions: { rename: true, refresh: true }, ...activity, workspaceId: 'workspace-shared' as NativeWorkspace['workspaceId'] },
    { header: makeHeader('session-gamma', 'C:\\Work\\Shared'), titleProjection: { status: 'resolved', title: 'Gamma' },
      titleActions: { rename: true, refresh: true }, ...activity, workspaceId: 'workspace-shared' as NativeWorkspace['workspaceId'] },
  ]
  const listFrames = frameChannel<NativeSessionListFrame>()
  const settingsEventFrames = frameChannel<NativeSettingsEvent>()
  const workspaceFrames = frameChannel<NativeWorkspaceFrame>()
  const workspaceId = 'workspace-shared' as NativeWorkspace['workspaceId']
  let workspaces: NativeWorkspace[] = [{
    workspaceId, path: 'C:\\Work\\Shared', title: 'Shared', createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z', sessionIds: ['session-alpha' as SessionId, 'session-beta' as SessionId, 'session-gamma' as SessionId],
  }]
  let archivedSessionIds: NativeWorkspaceBaseline['archivedSessionIds'] = []
  const workspaceBaseline = (): NativeWorkspaceBaseline => ({ workspaces, archivedSessionIds })
  const createWorkspace = vi.fn(async (input: Parameters<NativeWorkspaceClient['create']>[0]) => {
    const { path } = input
    const existing = workspaces.find(item => item.path === path)
    if (existing !== undefined) return { workspace: existing, created: false }
    const workspace: NativeWorkspace = {
      workspaceId: 'workspace-new' as NativeWorkspace['workspaceId'], path, title: 'New',
      createdAt: '2026-10-11T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z', sessionIds: [],
    }
    workspaces = [...workspaces, workspace]
    workspaceFrames.publish({ type: 'upsert', workspace })
    return { workspace, created: true }
  })
  const connectWorkspace = vi.fn(async (id: Parameters<NativeWorkspaceClient['connectWorkspace']>[0]) => {
    const sessionId = 'session-in-workspace'
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
  const listDirectory = vi.fn(async () => ({
    path: 'C:\\Work\\New', home: 'C:\\Work\\New', entries: [], crumbs: [
      { name: 'C:', path: 'C:\\' }, { name: 'Work', path: 'C:\\Work' }, { name: 'New', path: 'C:\\Work\\New' },
    ],
  }))
  const reorderWorkspace = vi.fn(async (
    id: NativeWorkspace['workspaceId'], before?: NativeWorkspace['workspaceId'],
  ) => {
    const moved = workspaces.find(item => item.workspaceId === id)!
    const remaining = workspaces.filter(item => item.workspaceId !== id)
    const index = before === undefined ? remaining.length : remaining.findIndex(item => item.workspaceId === before)
    remaining.splice(index, 0, moved)
    workspaces = remaining
    const workspaceIds = remaining.map(item => item.workspaceId)
    workspaceFrames.publish({ type: 'order', workspaceIds })
    return workspaceIds
  })
  const reorderSession = vi.fn(async (
    id: NativeWorkspace['workspaceId'], sessionId: SessionId, before?: SessionId,
  ) => {
    const workspace = workspaces.find(item => item.workspaceId === id)!
    const sessionIds = workspace.sessionIds.filter(item => item !== sessionId)
    const index = before === undefined ? sessionIds.length : sessionIds.indexOf(before)
    sessionIds.splice(index, 0, sessionId)
    const updated = { ...workspace, sessionIds }
    workspaces = workspaces.map(item => item.workspaceId === id ? updated : item)
    workspaceFrames.publish({ type: 'upsert', workspace: updated })
    return updated
  })
  const workspaceClient: NativeWorkspaceClient = {
    async list() { return workspaceBaseline() },
    async *follow(signal) {
      await baselineGate
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
    reorder: reorderWorkspace,
    reorderSession,
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
    pick: vi.fn(), list: listDirectory, createDirectory: vi.fn(),
  }
  const close = vi.fn(async () => undefined)
  const promptSettlement = Promise.withResolvers<{ exitCode: number; answer: string }>()
  let turnStarted = false
  const prompt = vi.fn<NativeSessionClient['prompt']>((_id, _text, _resume, signal, _observe, _images, _onFollowError, _lastSeq, detach, onAccepted) => {
    onAccepted?.()
    turnStarted = true
    signal?.addEventListener('abort', () => { promptSettlement.resolve({ exitCode: 130, answer: '' }) }, { once: true })
    const detached = new Promise<never>((_resolve, reject) => {
      detach?.addEventListener('abort', () => { reject(new Error('detached')) }, { once: true })
    })
    return Promise.race([promptSettlement.promise, detached])
  })
  const attach = vi.fn<NativeSessionClient['attach']>((id, _lastSeq, _observe, _signal, _onFollowError, detach) => {
    if (id !== 'session-alpha' || !turnStarted) return Promise.resolve(undefined)
    const detached = new Promise<never>((_resolve, reject) => {
      detach?.addEventListener('abort', () => { reject(new Error('detached')) }, { once: true })
    })
    return Promise.race([promptSettlement.promise, detached])
  })
  let pendingMessages: NativePendingSubmission[] = []
  let inboxRevision = 0
  const pendingSnapshot = (): NativeSubmissionsSnapshot => ({ throughSeq: SessionSeq(inboxRevision), submissions: pendingMessages })
  const queue = vi.fn<NativeSessionClient['queue']>(async (_id, text, requestId) => {
    pendingMessages = [...pendingMessages, { requestId, placement: 'queued', status: 'accepted', message: {
      id: String(requestId) as NativePendingSubmission['message']['id'], role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }],
    } }]
    inboxRevision++
    return { requestId, placement: 'queued', status: 'accepted' }
  })
  const steer = vi.fn<NativeSessionClient['steer']>(async (_id, text, requestId) => {
    pendingMessages = [...pendingMessages, { requestId, placement: 'steering', status: 'accepted', message: {
      id: String(requestId) as NativePendingSubmission['message']['id'], role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }],
    } }]
    inboxRevision++
    return { requestId, placement: 'steering', status: 'accepted' }
  })
  const dequeue = vi.fn<NativeSessionClient['dequeue']>(async (_id, requestId) => {
    pendingMessages = pendingMessages.filter(item => item.requestId !== requestId)
    inboxRevision++
  })
  const promoteSubmission = vi.fn<NativeSessionClient['promoteSubmission']>(async (_id, requestId) => {
    pendingMessages = pendingMessages.map(item => item.requestId === requestId ? { ...item, placement: 'steering' } : item)
    inboxRevision++
    return { requestId, outcome: 'promoted' }
  })
  const editSubmission = vi.fn<NativeSessionClient['editSubmission']>(async (_id, requestId, text) => {
    pendingMessages = pendingMessages.map(item => item.requestId === requestId ? { ...item, message: {
      ...item.message, content: [{ type: 'text', text }],
    } } : item)
    inboxRevision++
    return { requestId, outcome: 'updated' }
  })
  const settingsDescription = (themePreference = 'dark', fontSize = 15) => ({ hasDocument: false, namespaces: [
    { namespace: 'locale', schema: {}, value: { preference: 'en' }, base: {}, user: {},
      applies: 'live' as const, secrets: [], credentialRefs: [], revision: 1 },
    { namespace: 'ui-theme', schema: {}, value: { preference: themePreference, fontSize }, base: {}, user: {},
      applies: 'live' as const, secrets: [], credentialRefs: [], revision: 1 },
    { namespace: 'ui-conversation', schema: {}, value: { busyEnter: 'steer' }, base: {}, user: {},
      applies: 'live' as const, secrets: [], credentialRefs: [], revision: 1 },
  ], limits: { maxCredentialRefsPerRead: 1, maxSettingsOperations: 1 } })
  const clientMock = {
    close,
    settingsDescribe: vi.fn(async () => settingsDescription()),
    settingsOpenDocument: vi.fn(),
    settingsMutate: vi.fn(),
    credentialsDescribe: vi.fn(),
    authorizationList: vi.fn(async () => []), authorizationBegin: vi.fn(), authorizationFrames: vi.fn(),
    authorizationAnswer: vi.fn(), authorizationDecline: vi.fn(), authorizationCancel: vi.fn(),
    accountsList: vi.fn(), accountsUsage: vi.fn(), accountsBalance: vi.fn(), accountsSignOut: vi.fn(),
    modelsListProviders: vi.fn(async () => []), modelsListConfigurableProviders: vi.fn(async () => []),
    modelsDiscover: vi.fn(async () => []), modelCatalog: vi.fn(async () => null),
    pluginInventoryList: vi.fn(async () => ({ entries: [] })), settingsEvents: async function* (signal: AbortSignal) {
      while (true) {
        const event = await settingsEventFrames.take(signal)
        if (event === undefined) return
        yield event
      }
    },
    agentPresetsList: vi.fn(async () => ({ default: null, presets: [] })),
    agentPresetRead: vi.fn(async (id: string) => ({ id, source: 'profile' as const, status: 'ready' as const, name: id })),
    agentPresetCopy: vi.fn(async () => ({ updated: true as const })),
    agentPresetDelete: vi.fn(async () => ({ updated: true as const })),
    agentPresetsCanOpenDirectory: vi.fn(async () => false),
    agentPresetOpenDirectory: vi.fn(async (id: string) => ({ opened: false as const, path: `/presets/${id}` })),
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
    modeControls: vi.fn(async () => ({ current: null, options: [], revision: null, locked: false, canSelect: false,
      planMode: { available: false, active: false } })),
    selectPlanMode: vi.fn(async () => ({ active: false, outcome: 'noop' as const })),
    permissionControls: vi.fn(async () => ({ available: false, currentValue: null, options: [] })),
    selectPermissionPreset: vi.fn(async () => undefined),
    selectPreset: vi.fn(async () => undefined),
    submissions: vi.fn(async () => pendingSnapshot()),
    prompt, attach, queue, steer, dequeue, promoteSubmission, editSubmission,
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
  await host.start()
  return { host, rows: () => rows, listFrames, workspaceFrames, createWorkspace, connectWorkspace, clientMock }
}

const untrusted = (): Error => Object.assign(new Error('Workspace is not trusted'),
  { code: 'native/workspace-untrusted', details: { path: 'C:\\Work\\Shared' } })
const row = (name: RegExp): HTMLElement => screen.getByRole('treeitem', { name })

it('falls back to the neighbouring row when the archived Session had a cancelled admission', async () => {
  const { host, createWorkspace, clientMock } = await harness()
  try {
    fireEvent.click(await screen.findByRole('treeitem', { name: /Alpha/ }))
    await waitFor(() => { expect(document.title).toBe('Alpha — Product') })
    createWorkspace.mockRejectedValueOnce(untrusted())
    fireEvent.click(row(/Gamma/))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await clientMock.archive('session-alpha' as NativeSessionListItem['header']['id'])
    await waitFor(() => { expect(document.title).toBe('Beta — Product') })
    expect(screen.queryByRole('dialog')).toBeNull()
  } finally { await host.stop() }
}, 20_000)

it('drops a pending Session admission once a new Session starts inside a Workspace', async () => {
  const { host, createWorkspace, clientMock } = await harness()
  try {
    fireEvent.click(await screen.findByRole('treeitem', { name: /Alpha/ }))
    await waitFor(() => { expect(document.title).toBe('Alpha — Product') })
    const admission = Promise.withResolvers<{ workspace: NativeWorkspace; created: boolean }>()
    createWorkspace.mockImplementationOnce(() => admission.promise)
    const created = Promise.withResolvers<undefined>()
    clientMock.history.mockImplementationOnce(async (id) => {
      await created.promise
      return { header: makeHeader(id, 'C:\\Work\\Shared'), events: [], inheritedEventCount: 0 }
    })
    fireEvent.click(row(/Beta/))
    fireEvent.click(screen.getByRole('button', { name: 'New session in Shared' }))
    await waitFor(() => { expect(clientMock.history).toHaveBeenLastCalledWith('session-in-workspace', expect.any(AbortSignal)) })
    admission.resolve({ workspace: (await clientMock.list())[0] as never, created: false })
    await admission.promise
    created.resolve(undefined)
    await waitFor(() => { expect(document.title).toBe('Shared — Product') })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(clientMock.history).not.toHaveBeenCalledWith('session-beta', expect.any(AbortSignal))
  } finally { await host.stop() }
}, 20_000)

it('waits for the Workspace baseline before admitting a Session so an untrusted Workspace still asks', async () => {
  const baseline = Promise.withResolvers<undefined>()
  const { host, createWorkspace, clientMock } = await harness(baseline.promise)
  try {
    createWorkspace.mockRejectedValueOnce(untrusted())
    fireEvent.click(await screen.findByRole('treeitem', { name: /Alpha/ }))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(clientMock.history).not.toHaveBeenCalledWith('session-alpha', expect.any(AbortSignal))
    baseline.resolve(undefined)
    expect(await screen.findByRole('button', { name: 'Trust' })).toBeTruthy()
    expect(createWorkspace).toHaveBeenCalledWith({ path: 'C:\\Work\\Shared' }, expect.any(AbortSignal))
  } finally { await host.stop() }
}, 20_000)

it('reports a stalled Workspace baseline instead of waiting forever, and a later open still waits for it', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const baseline = Promise.withResolvers<undefined>()
  const { host, clientMock } = await harness(baseline.promise)
  try {
    fireEvent.click(await screen.findByRole('treeitem', { name: /Alpha/ }))
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await screen.findByText(en.workspaceListTimeout)).toBeTruthy()
    expect(clientMock.history).not.toHaveBeenCalledWith('session-alpha', expect.any(AbortSignal))
    baseline.resolve(undefined)
    fireEvent.click(screen.getByRole('treeitem', { name: /Alpha/ }))
    await waitFor(() => { expect(clientMock.history).toHaveBeenCalledWith('session-alpha', expect.any(AbortSignal)) })
  } finally { vi.useRealTimers(); await host.stop() }
}, 20_000)
