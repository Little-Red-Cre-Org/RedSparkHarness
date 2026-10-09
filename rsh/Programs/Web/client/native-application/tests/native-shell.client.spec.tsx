// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { SESSION_FORMAT_VERSION, type SessionHeader, type SessionId } from '@deepseek-ai/dsh-session/types'
import type { NativeSessionClient, NativeSessionListItem } from '@deepseek-ai/dsh-client-native-session/native'
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

const sessionProvider = (client: NativeSessionClient): NativePlugin => ({
  apiVersion: 1,
  name: 'test-native-session-provider',
  targets: ['client'],
  requires: [],
  provides: ['clientNativeSession'],
  resolve: () => (context) => {
    context.provide('clientNativeSession', client)
    context.own(() => client.close())
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

  let rows: NativeSessionListItem[] = [
    { header: makeHeader('session-alpha', 'C:\\Work\\Alpha'), titleProjection: { status: 'resolved', title: 'Alpha' },
      titleActions: { rename: true, refresh: true } },
    { header: makeHeader('session-beta', 'C:\\Work\\Beta'), titleProjection: { status: 'resolved', title: 'Beta' },
      titleActions: { rename: true, refresh: true } },
  ]
  const close = vi.fn(async () => undefined)
  const clientMock = {
    close,
    settingsDescribe: vi.fn(),
    settingsMutate: vi.fn(),
    credentialsDescribe: vi.fn(),
    authorizationList: vi.fn(async () => []), authorizationBegin: vi.fn(), authorizationFrames: vi.fn(),
    authorizationAnswer: vi.fn(), authorizationDecline: vi.fn(), authorizationCancel: vi.fn(),
    credentialsSet: vi.fn(),
    credentialsUnset: vi.fn(),
    list: vi.fn(async () => rows),
    modelControls: vi.fn(async () => ({ catalog: null, canSelectModel: false, presets: [] })),
    history: vi.fn(async (id: SessionId) => {
      const row = rows.find(candidate => candidate.header.id === id)
      if (row === undefined) throw new Error(`unknown test Session ${id}`)
      return { header: row.header, events: [], inheritedEventCount: 0 }
    }),
    create: vi.fn(async () => {
      const header = makeHeader('session-created')
      rows = [...rows, { header, titleProjection: { status: 'absent' }, titleActions: { rename: true, refresh: true } }]
      return { sessionId: header.id }
    }),
    renameTitle: vi.fn(async (id: SessionId, title: string) => {
      rows = rows.map(row => row.header.id === id ? { ...row, titleProjection: { status: 'resolved', title } } : row)
    }),
    refreshTitle: vi.fn(async (id: SessionId) => {
      rows = rows.map(row => row.header.id === id ? { ...row, titleProjection: { status: 'resolved', title: 'Refreshed Alpha' } } : row)
    }),
  }
  const client = clientMock as unknown as NativeSessionClient

  const container = document.createElement('div')
  document.body.append(container)
  const scope = new NativeScope()
  const host = new NativeHost(resolveInstallation([
    { plugin: sessionProvider(client), scope, config: undefined },
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
    await screen.findByRole('button', { name: 'Alpha' })
    expect(document.head.querySelectorAll('style[data-plugin="@deepseek-ai/dsh-client-ui-theme"]')).toHaveLength(7)

    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
    await waitFor(() => { expect(document.title).toBe('Alpha — Product') })
    expect(clientMock.history).toHaveBeenCalledWith('session-alpha', expect.any(AbortSignal))

    const alphaRow = screen.getByRole('button', { name: 'Alpha' }).parentElement!
    fireEvent.click(within(alphaRow).getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Session title' }), { target: { value: 'Renamed Alpha' } })
    fireEvent.click(within(alphaRow).getByRole('button', { name: 'Save' }))
    await screen.findByRole('button', { name: 'Renamed Alpha' })
    expect(clientMock.renameTitle).toHaveBeenCalledWith('session-alpha', 'Renamed Alpha', expect.any(AbortSignal))
    const renamedRow = screen.getByRole('button', { name: 'Renamed Alpha' }).parentElement!
    fireEvent.click(within(renamedRow).getByRole('button', { name: 'Refresh title' }))
    await screen.findByRole('button', { name: 'Refreshed Alpha' })
    expect(clientMock.refreshTitle).toHaveBeenCalledWith('session-alpha', expect.any(AbortSignal))

    fireEvent.click(screen.getByRole('button', { name: 'Session details' }))
    expect(screen.getByRole('complementary', { name: 'Session details' })).toBeTruthy()
    expect(screen.getByText('C:\\Work\\Alpha')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }))
    await screen.findByText('C:\\Work\\Beta')
    await waitFor(() => { expect(document.title).toBe('Beta — Product') })

    const createButton = screen.getByText('New Session').closest('button')
    expect(createButton).not.toBeNull()
    fireEvent.click(createButton!)
    await screen.findByRole('button', { name: 'session-created' })
    expect(await screen.findAllByText('session-created')).toHaveLength(2)
    expect(clientMock.create).toHaveBeenCalledOnce()
    expect(clientMock.history).toHaveBeenLastCalledWith('session-created', expect.any(AbortSignal))

    fireEvent.click(screen.getByRole('button', { name: 'Language' }))
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(screen.getByRole('button', { name: '会话详情' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '切换主题' }))
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true)

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
