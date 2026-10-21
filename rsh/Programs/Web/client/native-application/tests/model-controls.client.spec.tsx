// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type {
  NativeModeControls, NativePermissionControls, NativeSessionClient,
} from '@deepseek-ai/dsh-client-native-session/native'
import { SESSION_FORMAT_VERSION, type SessionId } from '@deepseek-ai/dsh-session/types'
import { NativeConversationController, type ConversationSnapshot } from '../src/controller.ts'
import type { ConversationLocaleKey } from '../src/locales.ts'
import { ModelControls, ModelPickerControl } from '../src/model-controls.tsx'
import { en } from '../src/locales.ts'

const controllers: NativeConversationController[] = []

afterEach(async () => {
  cleanup()
  await Promise.all(controllers.splice(0).map(controller => controller.close()))
})

async function renderControls() {
  let mode: NativeModeControls = {
    current: 'standard', options: [{ id: 'standard', name: 'Standard' }, { id: 'minimal', name: 'Minimal' }],
    revision: 7, locked: false, canSelect: true, planMode: { available: true, active: false },
  }
  let permission: NativePermissionControls = {
    available: true, currentValue: 'workspace-write', options: [
      { value: 'read-only', name: 'Read Only' }, { value: 'workspace-write', name: 'Workspace Write' },
    ],
  }
  const selectPreset = vi.fn(async ({ preset }: { preset: string }) => {
    mode = { ...mode, current: preset, revision: 8 }
  })
  const selectPlanMode = vi.fn(async (_id: SessionId, active: boolean) => ({
    active: false, pending: active, outcome: 'queued' as const,
  }))
  const selectPermissionPreset = vi.fn(async (_id: SessionId, preset: string) => {
    permission = { ...permission, currentValue: preset }
  })
  const client = {
    async modelControls() { return { catalog: null, canSelectModel: false, presets: [] } },
    async modeControls() { return mode },
    async permissionControls() { return permission },
    selectPreset,
    selectPlanMode,
    selectPermissionPreset,
    async *follow() { yield { type: 'baseline' as const, items: [] } },
    async submissions() { return { throughSeq: -1, submissions: [] } },
    async history(id: SessionId) {
      return { header: { version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false },
        events: [], inheritedEventCount: 0 }
    },
  } as unknown as NativeSessionClient
  const controller = new NativeConversationController(client, { maxLiveTextChars: 100, maxLiveEvents: 10 })
  controllers.push(controller)
  await controller.load()
  await controller.select('session-alpha' as SessionId)
  render(<ModelControls snapshot={controller.getSnapshot()}
    selectPreset={controller.selectPreset.bind(controller)}
    selectPlanMode={controller.selectPlanMode.bind(controller)}
    selectPermissionPreset={controller.selectPermissionPreset.bind(controller)}
    t={key => en[key]} />)
  return { controller, selectPreset, selectPlanMode, selectPermissionPreset }
}

it.each(['mode', 'plan', 'permission'] as const)('routes the %s composer control through the Host Client', async (control) => {
  const { controller, selectPreset, selectPlanMode, selectPermissionPreset } = await renderControls()

  if (control === 'mode') {
    fireEvent.change(screen.getByRole('combobox', { name: en.mode }), { target: { value: 'minimal' } })
    await waitFor(() => {
      expect(selectPreset).toHaveBeenCalledWith({
        id: 'session-alpha', preset: 'minimal', expectedRevision: 7,
      }, expect.any(AbortSignal))
    })
    expect(controller.getSnapshot().modeControls?.current).toBe('minimal')
  } else if (control === 'plan') {
    fireEvent.click(screen.getByRole('button', { name: en.planModeOff }))
    await waitFor(() => {
      expect(selectPlanMode).toHaveBeenCalledWith('session-alpha', true, expect.any(AbortSignal))
    })
    expect(controller.getSnapshot().modeControls?.planMode).toEqual({ available: true, active: false, pending: true })
  } else {
    fireEvent.change(screen.getByRole('combobox', { name: en.permission }), { target: { value: 'read-only' } })
    await waitFor(() => {
      expect(selectPermissionPreset).toHaveBeenCalledWith('session-alpha', 'read-only', expect.any(AbortSignal))
    })
    expect(controller.getSnapshot().permissionControls?.currentValue).toBe('read-only')
  }
})

it.each([{ catalogError: 'catalog offline' }])('keeps catalog failures retryable and locks loaded rows without a Session ($catalogError)', async ({ catalogError }) => {
  const snapshot: ConversationSnapshot = {
    sessions: [], events: [], state: 'ready', error: catalogError,
  }
  const refreshModelControls = vi.fn(async () => undefined)
  const selectModel = vi.fn(async () => undefined)
  const t = (key: ConversationLocaleKey, params?: Record<string, unknown>): string =>
    key === 'error.action' ? `Failed: ${String(params?.message)}` : key

  const view = render(<ModelPickerControl snapshot={snapshot} selectModel={selectModel}
    refreshModelControls={refreshModelControls} t={t} />)

  const trigger = screen.getByRole<HTMLButtonElement>('button', { name: 'trigger.selectAria' })
  expect(trigger.disabled).toBe(false)
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('menuitem', { name: /menu\.model/ }))
  expect(await screen.findByText('Failed: catalog offline')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'retry' }))

  expect(refreshModelControls).toHaveBeenCalledTimes(2)
  view.rerender(<ModelPickerControl snapshot={{ ...snapshot, state: 'sending', error: undefined }}
    selectModel={selectModel} refreshModelControls={refreshModelControls} t={t} />)
  expect(screen.getByRole('menu')).toBeTruthy()
  expect(screen.getByText('status.loading')).toBeTruthy()

  view.rerender(<ModelPickerControl snapshot={{ ...snapshot, error: undefined, modelControls: {
    canSelectModel: true, presets: [], catalog: {
      default: { provider: 'fixture', model: 'one' }, routableProviders: ['fixture'], failures: [], groups: [{ id: 'fixture', name: 'Fixture', models: [
        { id: 'one', name: 'One', reasoning: { defaultEffort: 'high', efforts: [{ id: 'high', name: 'High' }] } },
        { id: 'two', name: 'Two' },
      ] }],
    },
  } }} selectModel={selectModel} refreshModelControls={refreshModelControls} t={t} />)
  const model = screen.getByRole<HTMLButtonElement>('menuitemradio', { name: 'Two' })
  expect.soft(model.disabled).toBe(true)
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  fireEvent.click(screen.getByRole('menuitem', { name: /menu\.effort/ }))
  expect(screen.getByRole<HTMLButtonElement>('menuitemradio', { name: 'High' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'High' }))
  expect(selectModel).not.toHaveBeenCalled()
})
