// @vitest-environment jsdom
/**
 * Native open-in-app.
 *
 * The Native entry reuses the browser controller and the shared split button;
 * what it owns is the seat (`native.conversation.actions` at order -10) and the
 * directory source (the selected Session header's `cwd`). This suite pins both,
 * plus the null cases a Native client can hit: no Session selected, a Session
 * with no directory, and a Host that named no installed application.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@redspark/rsh-client-test-runtime'
import { createSnapshotStore } from '@redspark/rsh-client-store'
import type { SessionHeader, SessionId } from '@redspark/rsh-session/types'
import { NativeOpenInApp, plugin } from '../src/native.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const SESSION = 'session' as SessionId
const t = makeTranslate(zh)

/** One injected face the slot renders with, over stores this suite drives. */
function face(over: { apps?: readonly string[] | null; choice?: string; cwd?: string | undefined } = {}) {
  const apps = createSnapshotStore<readonly string[] | null>(over.apps ?? null)
  const choice = createSnapshotStore<string>(over.choice ?? '')
  const launch = vi.fn(async () => {})
  const choose = vi.fn()
  function useOpenInAppApps<T>(select: (value: readonly string[] | null) => T): T { return select(apps.getSnapshot()) }
  function useOpenInAppChoice<T>(select: (value: string) => T): T { return select(choice.getSnapshot()) }
  function useWorkspacePath<T>(select: (value: string | undefined) => T): T { return select(over.cwd) }
  return {
    props: {
      useOpenInAppApps, useOpenInAppChoice, useWorkspacePath,
      launch, choose, iconUrl: (id: string) => `/open-in-app/icon/${id}`, t,
    },
    launch,
    choose,
  }
}

describe('native open-in-app split button', () => {
  it('renders the remembered application and opens the directory on click', async () => {
    const bench = face({ apps: ['cursor', 'vscode'], choice: 'vscode', cwd: '/work/project' })
    render(<NativeOpenInApp {...bench.props} />)
    fireEvent.click(screen.getByRole('button', { name: zh['open.title'].replace('{app}', 'VS Code') }))
    await waitFor(() => { expect(bench.launch).toHaveBeenCalledWith('vscode', '/work/project') })
  })

  it('lists every nameable installed application and launches the picked one', async () => {
    const bench = face({ apps: ['cursor', 'vscode'], cwd: '/work/project' })
    render(<NativeOpenInApp {...bench.props} />)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.toggle'] }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Cursor/ }))
    await waitFor(() => { expect(bench.choose).toHaveBeenCalledWith('cursor') })
    await waitFor(() => { expect(bench.launch).toHaveBeenCalledWith('cursor', '/work/project') })
  })

  it('renders nothing when the Session names no directory', () => {
    const bench = face({ apps: ['cursor'], cwd: undefined })
    const { container } = render(<NativeOpenInApp {...bench.props} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the Host named no installed application', () => {
    const bench = face({ apps: [], cwd: '/work/project' })
    const { container } = render(<NativeOpenInApp {...bench.props} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing while the availability read is unanswered', () => {
    const bench = face({ apps: null, cwd: '/work/project' })
    const { container } = render(<NativeOpenInApp {...bench.props} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('native open-in-app plugin', () => {
  it('declares the Native seat facts it reads', () => {
    expect(plugin.apiVersion).toBe(1)
    expect(plugin.targets).toEqual(['client'])
    expect(plugin.requires).toEqual(['clientSlots', 'clientLocale', 'clientNativeConversation'])
    expect(plugin.optional).toEqual([])
    expect(plugin.provides).toEqual([])
  })

  it('contributes one action into native.conversation.actions before the plan chip', () => {
    const registered: { name: string; id?: string | undefined; order?: number | undefined }[] = []
    const slots = {
      inject: (name: string, run: () => () => void) => { registered.push({ name }); run(); return () => {} },
      register: (options: { name: string; id?: string; order?: number }, _component: unknown) => {
        registered[registered.length - 1] = { name: options.name, id: options.id, order: options.order }
        return () => {}
      },
    }
    const locale = { register: () => () => {} }
    const conversation = {
      getSnapshot: () => ({ selected: SESSION, header: { cwd: '/work/project' } as unknown as SessionHeader }),
      subscribe: () => () => {},
    }
    const activation = plugin.resolve(undefined) as (context: {
      require: (name: string) => unknown
      own: (disposer: unknown) => void
      signal: AbortSignal
    }) => void
    activation({
      require: (name: string) => name === 'clientSlots' ? slots : name === 'clientLocale' ? locale : conversation,
      own: () => {},
      signal: new AbortController().signal,
    })
    expect(registered).toEqual([{ name: 'native.conversation.actions', id: 'open-in-app', order: -10 }])
  })
})
