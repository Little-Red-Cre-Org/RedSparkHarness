// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { SESSION_FORMAT_VERSION, SessionSeq, type SessionEvent, type SessionHeader, type SessionId } from '@deepseek-ai/dsh-session/types'
import { NativeSessionRpcError } from '@deepseek-ai/dsh-client-native-session/native'
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
import { plugin as sessionPresentation, type NativeConversationService } from '../../ui-session/src/native.ts'
import { plugin as sidebar } from '../../ui-sidebar/src/native.ts'
import { plugin as rightbar } from '../../ui-sidebar-right/src/native.ts'
import { plugin as theme } from '../../ui-theme/src/native.ts'
import { PENDING_DEFAULT_KEY } from '../src/pending-default.ts'

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

const mountApplication = (container: HTMLElement, observeConversation: (service: NativeConversationService) => void): NativePlugin => ({
  apiVersion: 1,
  name: 'test-native-application-mount',
  targets: ['client'],
  requires: ['clientApplication', 'clientRenderer', 'clientNativeConversation'],
  provides: [],
  resolve: () => (context) => {
    observeConversation(context.require('clientNativeConversation'))
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

it.each([
  { scenario: 'without user action', initialLocale: 'zh', interleaveStartup: false, preferences: ['en', 'dark', 16] as const },
  { scenario: 'after a theme toggle', initialLocale: 'en', interleaveStartup: true, preferences: ['en', 'light', 14] as const },
])('installs modular Native navigation and applies startup preferences $scenario', async ({
  initialLocale, interleaveStartup, preferences,
}) => {
  localStorage.setItem('dsh.native.onboarding.welcome', '2026-08-13.1')
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
  const settingsEventFrames = frameChannel<NativeSettingsEvent>()
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
  let pendingWorkspaceConnection: ReturnType<typeof Promise.withResolvers<Awaited<ReturnType<NativeWorkspaceClient['connectWorkspace']>>>> | undefined
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
    const pending = pendingWorkspaceConnection
    pendingWorkspaceConnection = undefined
    return pending?.promise ?? { sessionId: sessionId as NativeSessionListItem['header']['id'] }
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
  const prompt = vi.fn<NativeSessionClient['prompt']>((_id, _text, _resume, signal, _observe, _images, _onFollowError, _lastSeq, detach) => {
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
  const sidebarStartupSettings = Promise.withResolvers<Awaited<ReturnType<NativeSessionClient['settingsDescribe']>>>()
  let settingsDescribeCalls = 0
  const settingsDescription = (localePreference = 'zh', themePreference = 'dark', fontSize = 15) => ({ hasDocument: false, namespaces: [
    { namespace: 'locale', schema: {}, value: { preference: localePreference }, base: {}, user: {},
      applies: 'live' as const, secrets: [], credentialRefs: [], revision: 1 },
    { namespace: 'ui-theme', schema: {}, value: { preference: themePreference, fontSize }, base: {}, user: {},
      applies: 'live' as const, secrets: [], credentialRefs: [], revision: 1 },
    { namespace: 'ui-conversation', schema: {}, value: { busyEnter: 'steer' }, base: {}, user: {},
      applies: 'live' as const, secrets: [], credentialRefs: [], revision: 1 },
  ], limits: { maxCredentialRefsPerRead: 1, maxSettingsOperations: 1 } })
  let betaHasConversation = true
  const betaPriorTurnStart = { type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 0 } } as unknown as SessionEvent
  const betaPriorStepStart = { type: 'step/start', seq: SessionSeq(1), time: 1, data: { turn: 0, step: 0 } } as unknown as SessionEvent
  const betaPriorAssistantMessage = {
    type: 'assistant/message', seq: SessionSeq(2), time: 2, surfaceOp: 'append',
    data: { turn: 0, step: 0, stream: [], usage: {
      inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    }, message: { id: 'beta-prior-reply', role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' },
      content: [{ type: 'text', text: 'Beta prior reply' }] } },
  } as unknown as SessionEvent
  const betaPriorTurnEnd = { type: 'turn/end', seq: SessionSeq(3), time: 3,
    data: { turn: 0, reason: { kind: 'completed' } } } as unknown as SessionEvent
  const betaTurnStart = { type: 'turn/start', seq: SessionSeq(4), time: 4, data: { turn: 1 } } as unknown as SessionEvent
  const betaStepStart = { type: 'step/start', seq: SessionSeq(5), time: 5, data: { turn: 1, step: 1 } } as unknown as SessionEvent
  const betaMessage = {
    type: 'user/message', seq: SessionSeq(6), time: 6, surfaceOp: 'append',
    data: { id: 'beta-message', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Beta task' }] },
  } as unknown as SessionEvent
  const betaAssistantMessage = {
    type: 'assistant/message', seq: SessionSeq(7), time: 1005, surfaceOp: 'append',
    data: { turn: 1, step: 1, stream: [], usage: {
      inputTokens: 1000, outputTokens: 141, totalTokens: 621000, cacheReadTokens: 8100, cacheWriteTokens: 900,
    }, message: { id: 'beta-reply', role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' },
      content: [{ type: 'text', text: 'Beta reply' }] } },
  } as unknown as SessionEvent
  const betaTurnEnd = { type: 'turn/end', seq: SessionSeq(8), time: 1006,
    data: { turn: 1, reason: { kind: 'completed' } } } as unknown as SessionEvent
  const betaHistory = [betaPriorTurnStart, betaPriorStepStart, betaPriorAssistantMessage, betaPriorTurnEnd,
    betaTurnStart, betaStepStart, betaMessage, betaAssistantMessage, betaTurnEnd]
  const clientMock = {
    close,
    settingsDescribe: vi.fn((_signal?: AbortSignal) => {
      settingsDescribeCalls++
      // The sidebar startup read is second and the composer preference read is third.
      if (settingsDescribeCalls === 2) return sidebarStartupSettings.promise
      return Promise.resolve(settingsDescription())
    }),
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
    agentPresetsList: vi.fn(async () => ({ default: 'standard', presets: [
      { id: 'standard', name: 'Standard', source: 'profile' as const, status: 'ready' as const },
      { id: 'minimal', name: 'Minimal', source: 'profile' as const, status: 'ready' as const },
      { id: 'legacy', name: 'Legacy', source: 'user' as const, status: 'needs-migration' as const },
      { id: 'damaged', name: 'Damaged', source: 'user' as const, status: 'invalid' as const },
    ] })),
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
    modeControls: vi.fn(async () => ({ current: 'standard', options: [
      { id: 'standard', name: 'Standard' }, { id: 'minimal', name: 'Minimal' },
    ], revision: null, locked: false, canSelect: true,
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
      return { header: row.header, events: id === 'session-beta' && betaHasConversation ? betaHistory : [], inheritedEventCount: 0 }
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
  let conversation: NativeConversationService | undefined
  const scope = new NativeScope()
  const host = new NativeHost(resolveInstallation([
    { plugin: sessionProvider(client, workspaceClient, directoryPicker), scope, config: undefined },
    { plugin: renderer, scope, config: undefined },
    { plugin: locale, scope, config: { locale: initialLocale } },
    { plugin: theme, scope, config: undefined },
    { plugin: application, scope, config: { maxLiveTextChars: 1024, maxLiveEvents: 128 } },
    { plugin: sessionPresentation, scope, config: undefined },
    { plugin: layout, scope, config: undefined },
    { plugin: sidebar, scope, config: undefined },
    { plugin: rightbar, scope, config: undefined },
    { plugin: mountApplication(container, (service) => { conversation = service }), scope, config: undefined },
  ], 'client'))

  const originalLanguage = document.documentElement.lang
  try {
    localStorage.setItem(PENDING_DEFAULT_KEY, 'queue')
    await host.start()
    await screen.findByRole('treeitem', { name: 'Shared' })
    await waitFor(() => { expect(clientMock.settingsDescribe).toHaveBeenCalledTimes(3) })
    if (interleaveStartup) {
      fireEvent.click(screen.getByRole('button', { name: 'Switch theme' }))
      expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true)
    }
    sidebarStartupSettings.resolve(settingsDescription(preferences[0], preferences[1], preferences[2]))
    await sidebarStartupSettings.promise
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('en')
      expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true)
      expect(document.body.style.getPropertyValue('--dsh-content-font-size')).toBe(interleaveStartup ? '14px' : '16px')
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    if (!interleaveStartup) {
      const modelReads = clientMock.modelControls.mock.calls.length
      settingsEventFrames.publish({ type: 'llm/adapters-updated' })
      await waitFor(() => { expect(clientMock.modelControls).toHaveBeenCalledTimes(modelReads + 1) })
    }
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveProperty('placeholder', 'Choose a workspace to start')
    expect(screen.queryByRole('button', { name: 'Session details' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Choose workspace' })).toHaveProperty('disabled', false)
    fireEvent.click(await screen.findByRole('button', { name: 'Standard' }))
    expect(await screen.findByRole('menuitem', { name: 'Minimal' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Legacy' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Damaged' })).toBeNull()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Minimal' }))
    const presetReads = clientMock.agentPresetsList.mock.calls.length
    settingsEventFrames.publish({ type: 'agent-presets/updated' })
    await waitFor(() => { expect(clientMock.agentPresetsList).toHaveBeenCalledTimes(presetReads + 1) })
    expect(screen.getByRole('button', { name: 'Minimal' })).toBeTruthy()
    const delayedConnection = Promise.withResolvers<Awaited<ReturnType<NativeWorkspaceClient['connectWorkspace']>>>()
    pendingWorkspaceConnection = delayedConnection
    fireEvent.click(screen.getByRole('button', { name: 'Choose workspace' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Shared' }))
    await waitFor(() => { expect(connectWorkspace).toHaveBeenCalledTimes(1) })
    fireEvent.click(screen.getByRole('treeitem', { name: /Beta/ }))
    await waitFor(() => { expect(document.title).toBe('Beta — Product') })
    const conversationTab = screen.getByRole('tab', { name: 'Conversation' })
    const trajectoryTab = screen.getByRole('tab', { name: 'Trajectory' })
    expect(conversationTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('2 turns · 2 steps · 141 tok/s · 621K tok · cache hit 81%')).toBeTruthy()
    fireEvent.keyDown(conversationTab, { key: 'ArrowRight' })
    expect([trajectoryTab.getAttribute('aria-selected'), document.activeElement]).toEqual(['true', trajectoryTab])
    fireEvent.click(trajectoryTab)
    expect(trajectoryTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Turn 1')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeTruthy()
    fireEvent.click(conversationTab)
    expect(clientMock.selectPreset).not.toHaveBeenCalled()
    const pendingStart = Promise.withResolvers<Awaited<ReturnType<NativeWorkspaceClient['connectWorkspace']>>>()
    pendingWorkspaceConnection = pendingStart
    const pendingMessageInput = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(pendingMessageInput, { target: { value: 'Do not send to Beta' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'New session' })[0]!)
    await waitFor(() => { expect(connectWorkspace).toHaveBeenCalledTimes(2) })
    expect(pendingMessageInput).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true)
    fireEvent.submit(pendingMessageInput.closest('form')!)
    expect(prompt).not.toHaveBeenCalled()
    pendingStart.resolve({ sessionId: 'session-alpha' as SessionId })
    await waitFor(() => {
      expect(connectWorkspace).toHaveBeenLastCalledWith(workspaceId, expect.any(AbortSignal))
      expect(clientMock.history).toHaveBeenLastCalledWith('session-alpha', expect.any(AbortSignal))
    })
    connectWorkspace.mockRejectedValueOnce(new Error('Workspace unavailable'))
    fireEvent.click(screen.getAllByRole('button', { name: 'New session' })[0]!)
    expect((await screen.findByRole('alert')).textContent).toContain('Workspace unavailable')
    const untrustedConnect = Promise.withResolvers<Awaited<ReturnType<NativeWorkspaceClient['connectWorkspace']>>>()
    pendingWorkspaceConnection = untrustedConnect
    const controlsRefresh = Promise.withResolvers<Awaited<ReturnType<typeof clientMock.modelControls>>>()
    const modelReads = clientMock.modelControls.mock.calls.length
    clientMock.modelControls.mockImplementationOnce(() => controlsRefresh.promise)
    const connectionCalls = connectWorkspace.mock.calls.length
    fireEvent.click(screen.getAllByRole('button', { name: 'New session' })[0]!)
    await waitFor(() => { expect(connectWorkspace).toHaveBeenCalledTimes(connectionCalls + 1) })
    settingsEventFrames.publish({ type: 'llm/adapters-updated' })
    await waitFor(() => { expect(clientMock.modelControls).toHaveBeenCalledTimes(modelReads + 1) })
    untrustedConnect.reject(new NativeSessionRpcError('native/workspace-untrusted', 'Workspace is untrusted', {
      path: 'C:\\Work\\Shared',
    }))
    await waitFor(() => {
      expect(conversation?.getSnapshot().state).toBe('loading')
      expect(conversation?.getSnapshot().navigationPending).toBe(true)
    })
    controlsRefresh.resolve({ catalog: null, canSelectModel: false, presets: [] })
    await waitFor(() => {
      expect(conversation?.getSnapshot()).toMatchObject({ state: 'ready', selected: undefined, navigationPending: false })
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveProperty('disabled', true)
    })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Switch theme' }))
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    const workspaceRows = within(screen.getByRole('tree', { name: 'Workspaces' }))
    let alphaRow = workspaceRows.getByRole('treeitem', { name: /Alpha/ })
    const betaRow = workspaceRows.getByRole('treeitem', { name: /Beta/ })
    expect(betaRow).toBeTruthy()
    expect(document.head.querySelectorAll('style[data-plugin="@deepseek-ai/dsh-client-ui-theme"]')).toHaveLength(7)
    fireEvent.click(betaRow)
    await waitFor(() => { expect(document.title).toBe('Beta — Product') })
    connectWorkspace.mockClear()
    const sharedRow = workspaceRows.getByRole('treeitem', { name: 'Shared' })
    expect(sharedRow.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(sharedRow)
    expect(sharedRow.getAttribute('aria-expanded')).toBe('false')
    expect(connectWorkspace).not.toHaveBeenCalled()
    expect(document.title).toBe('Beta — Product')
    fireEvent.click(sharedRow)
    expect(sharedRow.getAttribute('aria-expanded')).toBe('true')
    expect(connectWorkspace).not.toHaveBeenCalled()
    expect(document.title).toBe('Beta — Product')
    alphaRow = workspaceRows.getByRole('treeitem', { name: /Alpha/ })
    createWorkspace.mockRejectedValueOnce(Object.assign(new Error('Workspace is outside the configured allowed roots'),
      { code: 'native/workspace-untrusted', details: { path: 'C:\\Work\\Shared' } }))
    fireEvent.click(alphaRow)
    fireEvent.click(await screen.findByRole('button', { name: 'Trust' }))
    await waitFor(() => { expect(document.title).toBe('Alpha — Product') })
    betaHasConversation = false
    expect(createWorkspace).toHaveBeenLastCalledWith({ path: 'C:\\Work\\Shared', trust: true }, expect.any(AbortSignal))
    clientMock.history.mockClear()
    const betaHistory = Promise.withResolvers<undefined>()
    clientMock.history.mockImplementationOnce(async (id) => {
      await betaHistory.promise
      const row = rows.find(candidate => candidate.header.id === id)!
      return { header: row.header, events: [], inheritedEventCount: 0 }
    })
    fireEvent.click(workspaceRows.getByRole('treeitem', { name: /Beta/ }))
    await waitFor(() => { expect(clientMock.history).toHaveBeenCalledWith('session-beta', expect.any(AbortSignal)) })
    fireEvent.click(screen.getByRole('treeitem', { name: /Alpha/ }))
    betaHistory.resolve(undefined)
    await waitFor(() => {
      expect(clientMock.history).toHaveBeenLastCalledWith('session-alpha', expect.any(AbortSignal))
    })
    const activeRow = { ...rows.find(row => row.header.id === 'session-alpha')!, updatedAt: Date.now(), running: true,
      pendingInteraction: { kind: 'approval' as const } }
    rows = rows.map(row => row.header.id === activeRow.header.id ? activeRow : row)
    listFrames.publish({ type: 'upsert', item: activeRow })
    await within(alphaRow).findByText('now')
    expect(within(alphaRow).getByText('Waiting for approval')).toBeTruthy()
    expect(clientMock.list).not.toHaveBeenCalled()

    expect(screen.queryByRole('button', { name: 'Move session Alpha down' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sort by manual order' }))
    expect(screen.getByRole('button', { name: 'Move session Alpha up' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: 'Move session Alpha down' }))
    await waitFor(() => { expect(reorderSession).toHaveBeenCalledWith(workspaceId, 'session-alpha', undefined, expect.any(AbortSignal)) })
    await waitFor(() => { expect(screen.getByRole('treeitem', { name: /Beta/ }).compareDocumentPosition(screen.getByRole('treeitem', { name: /Alpha/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'Move session Alpha up' }))
    await waitFor(() => { expect(reorderSession).toHaveBeenLastCalledWith(workspaceId, 'session-alpha', 'session-beta', expect.any(AbortSignal)) })
    await waitFor(() => { expect(screen.getByRole('treeitem', { name: /Alpha/ }).compareDocumentPosition(screen.getByRole('treeitem', { name: /Beta/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy() })
    reorderSession.mockRejectedValueOnce(new Error('Order refused'))
    fireEvent.click(screen.getByRole('button', { name: 'Move session Alpha down' }))
    expect(await screen.findByText('Order refused')).toBeTruthy()
    expect(screen.getByRole('treeitem', { name: /Alpha/ }).compareDocumentPosition(screen.getByRole('treeitem', { name: /Beta/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Move session Alpha down' })).toHaveProperty('disabled', false) })
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    const betaDragRow = workspaceRows.getByRole('treeitem', { name: /Beta/ })
    const alphaDropRow = workspaceRows.getByRole('treeitem', { name: /Alpha/ })
    vi.spyOn(alphaDropRow, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 2 } as DOMRect)
    fireEvent.dragStart(betaDragRow, { dataTransfer })
    const dragOver = createEvent.dragOver(alphaDropRow, { dataTransfer })
    Object.defineProperty(dragOver, 'clientY', { value: 0 })
    fireEvent(alphaDropRow, dragOver)
    const drop = createEvent.drop(alphaDropRow, { dataTransfer })
    Object.defineProperty(drop, 'clientY', { value: 0 })
    fireEvent(alphaDropRow, drop)
    await waitFor(() => { expect(reorderSession).toHaveBeenLastCalledWith(workspaceId, 'session-beta', 'session-alpha', expect.any(AbortSignal)) })

    fireEvent.click(alphaRow)
    await waitFor(() => { expect(document.title).toBe('Alpha — Product') })
    expect(clientMock.history).toHaveBeenCalledWith('session-alpha', expect.any(AbortSignal))

    const messageInput = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(messageInput, { target: { value: 'Start work' } })
    await screen.findByRole('button', { name: 'Send' })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => { expect(prompt).toHaveBeenCalledOnce() })
    fireEvent.click(screen.getByRole('treeitem', { name: /Beta/ }))
    await waitFor(() => { expect(clientMock.history).toHaveBeenCalledWith('session-beta', expect.any(AbortSignal)) })
    fireEvent.click(screen.getByRole('treeitem', { name: /Alpha/ }))
    expect(prompt.mock.calls[0]?.[3]?.aborted).toBe(false)
    await waitFor(() => { expect(attach).toHaveBeenCalledWith('session-alpha', -1, expect.any(Function),
      expect.any(AbortSignal), expect.any(Function), expect.any(AbortSignal)) })
    expect(clientMock.history).toHaveBeenLastCalledWith('session-alpha', expect.any(AbortSignal))
    expect(messageInput).toHaveProperty('value', '')
    const validationJson = '[{"code":"too_big","maximum":10,"path":["prompt"],"message":"Too big"}]'
    queue.mockRejectedValueOnce(new Error(validationJson))
    fireEvent.change(messageInput, { target: { value: 'After this turn' } })
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    expect(await screen.findByText('The pending-message request failed. Check the text length and session state, then retry.')).toBeTruthy()
    expect(screen.queryByText(validationJson)).toBeNull()
    expect(screen.getByRole('button', { name: 'Refresh pending messages' })).toBeTruthy()
    expect(messageInput).toHaveProperty('value', 'After this turn')
    const refusedId = queue.mock.calls.at(-1)?.[2]
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
    const pendingPanel = await screen.findByRole('region', { name: 'Pending messages' })
    expect(await within(pendingPanel).findByText('After this turn')).toBeTruthy()
    expect(pendingPanel.compareDocumentPosition(messageInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const row = within(pendingPanel).getByRole('listitem')
    expect(within(row).getByText('Queued')).toBeTruthy()
    expect(within(row).getAllByRole('button').map(button => button.getAttribute('aria-label')))
      .toEqual(['Expand message', 'Edit pending message', 'Interject instead', 'Delete'])
    fireEvent.click(within(row).getByRole('button', { name: 'Expand message' }))
    expect(within(row).getByRole('button', { name: 'Collapse message' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(within(row).getByRole('button', { name: 'Collapse message' }))
    expect(within(row).getByRole('button', { name: 'Expand message' }).getAttribute('aria-expanded')).toBe('false')
    const editRequestId = pendingMessages[0]!.requestId
    editSubmission.mockResolvedValueOnce({ requestId: editRequestId, outcome: 'stale' })
    fireEvent.click(within(row).getByRole('button', { name: 'Edit pending message' }))
    const editInput = within(row).getByRole('textbox', { name: 'Edit pending message' })
    fireEvent.change(editInput, { target: { value: 'Edited pending text' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }))
    expect(await within(row).findByText('Could not edit this pending message. Your draft is still here; try again.')).toBeTruthy()
    expect(editInput).toHaveProperty('value', 'Edited pending text')
    expect(editSubmission).toHaveBeenNthCalledWith(1, 'session-alpha', editRequestId, 'Edited pending text', expect.any(AbortSignal))
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }))
    expect(await within(row).findByText('Edited pending text')).toBeTruthy()
    expect(within(row).queryByRole('textbox', { name: 'Edit pending message' })).toBeNull()
    expect(editSubmission).toHaveBeenNthCalledWith(2, 'session-alpha', editRequestId, 'Edited pending text', expect.any(AbortSignal))
    expect(queue.mock.calls.at(-1)?.[2]).toBe(refusedId)
    expect(queue).toHaveBeenCalledWith('session-alpha', 'After this turn', expect.any(String), expect.any(AbortSignal))
    fireEvent.click(within(pendingPanel).getByRole('button', { name: 'Interject instead' }))
    await waitFor(() => { expect(within(pendingPanel).getByRole('button', { name: 'Interject instead' })).toHaveProperty('disabled', true) })
    expect(within(pendingPanel).queryByText('Next step')).toBeNull()
    expect(promoteSubmission).toHaveBeenCalledWith('session-alpha', pendingMessages[0]!.requestId, expect.any(AbortSignal))
    fireEvent.click(within(pendingPanel).getByRole('button', { name: 'Delete' }))
    await waitFor(() => { expect(within(pendingPanel).queryByText('After this turn')).toBeNull() })
    expect(dequeue).toHaveBeenCalledOnce()
    fireEvent.change(messageInput, { target: { value: 'Use this direction' } })
    fireEvent.click(screen.getByRole('button', { name: 'Interject' }))
    expect(await within(pendingPanel).findByText('Use this direction')).toBeTruthy()
    expect(steer).toHaveBeenCalledWith('session-alpha', 'Use this direction', expect.any(String), expect.any(AbortSignal))
    const claimedRequestId = pendingMessages[0]!.requestId
    editSubmission.mockImplementationOnce(async (_id, requestId) => {
      pendingMessages = pendingMessages.filter(item => item.requestId !== requestId)
      inboxRevision++
      return { requestId, outcome: 'stale' }
    })
    fireEvent.click(within(pendingPanel).getByRole('button', { name: 'Edit pending message' }))
    fireEvent.change(within(pendingPanel).getByRole('textbox', { name: 'Edit pending message' }),
      { target: { value: 'Keep this claimed draft' } })
    fireEvent.click(within(pendingPanel).getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(within(pendingPanel).getByRole('status').textContent)
      .toBe(`Request (${claimedRequestId}) is no longer in the inbox. Your draft is still here; cancel to dismiss it.`) })
    expect(pendingMessages).toHaveLength(0)
    expect(within(pendingPanel).getByRole('textbox', { name: 'Edit pending message' }))
      .toHaveProperty('value', 'Keep this claimed draft')
    expect(within(pendingPanel).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)
    expect(editSubmission).toHaveBeenNthCalledWith(3, 'session-alpha', claimedRequestId, 'Keep this claimed draft', expect.any(AbortSignal))
    await waitFor(() => { expect(within(pendingPanel).getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', false) })
    fireEvent.click(within(pendingPanel).getByRole('button', { name: 'Cancel' }))
    expect(within(pendingPanel).queryByRole('listitem')).toBeNull()
    const queueCallsBeforeEnter = queue.mock.calls.length
    const steerCallsBeforeEnter = steer.mock.calls.length
    fireEvent.change(messageInput, { target: { value: 'Default steer by Enter' } })
    fireEvent.keyDown(messageInput, { key: 'Enter' })
    const enterSubmission = await within(pendingPanel).findByText('Default steer by Enter')
    await waitFor(() => { expect(steer).toHaveBeenCalledTimes(steerCallsBeforeEnter + 1) })
    expect(queue).toHaveBeenCalledTimes(queueCallsBeforeEnter)
    expect(steer).toHaveBeenLastCalledWith('session-alpha', 'Default steer by Enter', expect.any(String), expect.any(AbortSignal))
    expect(within(enterSubmission.closest('li')!).getByText('Interjecting')).toBeTruthy()
    fireEvent.click(within(enterSubmission.closest('li')!).getByRole('button', { name: 'Delete' }))
    await waitFor(() => { expect(within(pendingPanel).queryByRole('listitem')).toBeNull() })
    fireEvent.change(messageInput, { target: { value: 'Keep this next draft' } })
    promptSettlement.resolve({ exitCode: 0, answer: '' })
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull() })
    expect(messageInput).toHaveProperty('value', 'Keep this next draft')

    fireEvent.click(screen.getByRole('button', { name: 'Scheduled tasks' }))
    expect(await screen.findByRole('heading', { name: 'Scheduled tasks' })).toBeTruthy()
    expect(screen.getByText('No scheduled tasks.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to conversation' }))

    fireEvent.click(within(screen.getByRole('treeitem', { name: /Alpha/ })).getByRole('button', { name: 'Session actions for Alpha' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const titleInput = screen.getByRole('textbox', { name: 'Session title' })
    expect(document.activeElement).toBe(titleInput)
    fireEvent.keyDown(titleInput, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Session title' })).toBeNull()
    fireEvent.click(within(screen.getByRole('treeitem', { name: /Alpha/ })).getByRole('button', { name: 'Session actions for Alpha' }))
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
    expect(screen.getByTitle('C:\\Work\\Shared')).toBeTruthy()
    fireEvent.click(screen.getByRole('treeitem', { name: /Beta/ }))
    await screen.findByTitle('C:\\Work\\Shared')
    await waitFor(() => { expect(document.title).toBe('Beta — Product') })

    fireEvent.click(workspaceRows.getByRole('treeitem', { name: /Alpha/ }))
    await waitFor(() => { expect(conversation?.getSnapshot().selected).toBe('session-alpha') })
    const createButton = screen.getByText('New Session').closest('button')
    expect(createButton).not.toBeNull()
    const admission = Promise.withResolvers<Awaited<ReturnType<NativeWorkspaceClient['create']>>>()
    const admissionCalls = createWorkspace.mock.calls.length
    createWorkspace.mockImplementationOnce(() => admission.promise)
    fireEvent.click(workspaceRows.getByRole('treeitem', { name: /Beta/ }))
    const newSessionConnection = Promise.withResolvers<Awaited<ReturnType<NativeWorkspaceClient['connectWorkspace']>>>()
    pendingWorkspaceConnection = newSessionConnection
    const connections = connectWorkspace.mock.calls.length
    fireEvent.click(createButton!)
    await waitFor(() => {
      expect(connectWorkspace).toHaveBeenCalledTimes(connections + 1)
    })
    expect(conversation?.getSnapshot().navigationPending).toBe(true)
    newSessionConnection.resolve({ sessionId: 'session-alpha' as SessionId })
    await waitFor(() => {
      expect(conversation?.getSnapshot().selected).toBe('session-alpha')
      expect(conversation?.getSnapshot().state).toBe('ready')
    })
    admission.resolve({ workspace: workspaces[0]!, created: false })
    await admission.promise
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    await conversation?.idle()
    expect(conversation?.getSnapshot().selected).toBe('session-alpha')
    expect(clientMock.history).toHaveBeenLastCalledWith('session-alpha', expect.any(AbortSignal))
    expect(createWorkspace).toHaveBeenCalledTimes(admissionCalls + 1)
    fireEvent.click(workspaceRows.getByRole('treeitem', { name: /Beta/ }))
    await waitFor(() => { expect(conversation?.getSnapshot().selected).toBe('session-beta') })

    fireEvent.click(screen.getByRole('button', { name: 'Search sessions' }))
    const search = screen.getByPlaceholderText('Search sessions…')
    fireEvent.change(search, { target: { value: 'Needle' } })
    const searchResult = await screen.findByRole('treeitem', { name: /Needle in transcript/ })
    expect(clientMock.search).toHaveBeenCalledWith('Needle', undefined, expect.any(AbortSignal))
    let runningTurn: AbortSignal | undefined
    attach.mockImplementationOnce((_id, _lastSeq, _observe, signal, _onFollowError, detach) => {
      runningTurn = signal
      return new Promise((resolve) => { detach?.addEventListener('abort', () => { resolve(undefined) }, { once: true }) })
    })
    fireEvent.click(searchResult)
    await waitFor(() => { expect(clientMock.history).toHaveBeenLastCalledWith('session-alpha', expect.any(AbortSignal)) })
    await screen.findByRole('button', { name: 'Stop' })
    await waitFor(() => { expect(screen.queryByRole('treeitem', { name: /Needle in transcript/ })).toBeNull() })

    const refreshedRow = await screen.findByRole('treeitem', { name: /Refreshed Alpha/ })
    fireEvent.click(within(refreshedRow).getByRole('button', { name: 'Session actions for Refreshed Alpha' }))
    expect(screen.getByRole('menuitem', { name: 'Archive session' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete session' }))
    const deleteDialog = await screen.findByRole('dialog', { name: 'Delete session' })
    const historyCallsBeforeArchive = clientMock.history.mock.calls.length
    fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Delete session' }))
    await waitFor(() => { expect(clientMock.archive).toHaveBeenCalledWith('session-alpha', expect.any(AbortSignal)) })
    await waitFor(() => { expect(screen.queryByRole('treeitem', { name: /Refreshed Alpha/ })).toBeNull() })
    await waitFor(() => { expect(clientMock.history.mock.calls.length).toBeGreaterThan(historyCallsBeforeArchive) })
    expect(clientMock.history.mock.calls.at(-1)?.[0]).toBe('session-beta')
    expect(runningTurn?.aborted).toBe(false)

    fireEvent.click(within(screen.getByRole('treeitem', { name: /Beta/ }))
      .getByRole('button', { name: 'Session actions for Beta' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete session' }))
    const betaDeleteDialog = await screen.findByRole('dialog', { name: 'Delete session' })
    fireEvent.click(within(betaDeleteDialog).getByRole('button', { name: 'Delete session' }))
    await waitFor(() => { expect(clientMock.archive).toHaveBeenCalledWith('session-beta', expect.any(AbortSignal)) })
    await waitFor(() => { expect(screen.queryByRole('treeitem', { name: /Beta/ })).toBeNull() })
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Choose workspace' })).toHaveProperty('disabled', false) })
    const connectionCountBeforeHeroStart = connectWorkspace.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Choose workspace' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Shared' }))
    await waitFor(() => { expect(connectWorkspace).toHaveBeenCalledTimes(connectionCountBeforeHeroStart + 1) })
    await waitFor(() => { expect(clientMock.history).toHaveBeenLastCalledWith('session-alpha', expect.any(AbortSignal)) })
    expect(clientMock.selectPreset).not.toHaveBeenCalled()
    delayedConnection.resolve({ sessionId: 'session-alpha' as SessionId })

    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }))
    await screen.findByRole('dialog', { name: 'Select Workspace Directory' })
    createWorkspace.mockRejectedValueOnce(Object.assign(new Error('Workspace is a protected system directory'),
      { code: 'native/workspace-forbidden', details: {} }))
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByText(/^System directories cannot be added/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => { expect(connectWorkspace).toHaveBeenCalledWith('workspace-new', expect.any(AbortSignal)) })
    expect(listDirectory).toHaveBeenCalledWith(undefined, expect.any(AbortSignal))
    expect(createWorkspace).toHaveBeenCalledWith({ path: 'C:\\Work\\New' }, expect.any(AbortSignal))
    await waitFor(() => { expect(clientMock.history).toHaveBeenLastCalledWith('session-in-workspace', expect.any(AbortSignal)) })

    const composerConnection = Promise.withResolvers<Awaited<ReturnType<NativeWorkspaceClient['connectWorkspace']>>>()
    pendingWorkspaceConnection = composerConnection
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Wait for workspace' } })
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', false)
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Shared' }))
    await waitFor(() => { expect(connectWorkspace).toHaveBeenLastCalledWith(workspaceId, expect.any(AbortSignal)) })
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true)
    composerConnection.reject(new Error('Workspace unavailable'))
    await screen.findByRole('alert')
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', false) })

    fireEvent.click(screen.getByRole('button', { name: 'Move workspace New up' }))
    await waitFor(() => { expect(reorderWorkspace).toHaveBeenCalledWith('workspace-new', workspaceId, expect.any(AbortSignal)) })
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Move workspace New up' })).toHaveProperty('disabled', true) })
    fireEvent.click(screen.getByRole('button', { name: 'Move workspace New down' }))
    await waitFor(() => { expect(reorderWorkspace).toHaveBeenLastCalledWith('workspace-new', undefined, expect.any(AbortSignal)) })

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
    expect(mediaMock.removeEventListener).toHaveBeenCalledTimes(mediaMock.addEventListener.mock.calls.length)
    expect(languageListeners.size).toBe(0)
    expect(close).toHaveBeenCalledOnce()
    expect(host.diagnostics().every(item => item.state === 'disposed' && item.cleanup === 'complete')).toBe(true)
  } finally {
    localStorage.removeItem(PENDING_DEFAULT_KEY)
    await host.stop()
  }
}, 20_000)
