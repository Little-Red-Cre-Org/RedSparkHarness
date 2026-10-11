// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type {
  NativeModeControls, NativePermissionControls, NativeSessionClient,
} from '@deepseek-ai/dsh-client-native-session/native'
import { SESSION_FORMAT_VERSION, type SessionId } from '@deepseek-ai/dsh-session/types'
import { NativeConversationController } from '../src/controller.ts'
import { ModelControls } from '../src/model-controls.tsx'
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
  const client = {
    async modelControls() { return { catalog: null, canSelectModel: false, presets: [] } },
    async modeControls() { return mode },
    async permissionControls() { return permission },
    selectPreset: vi.fn(async ({ preset }: { preset: string }) => {
      mode = { ...mode, current: preset, revision: 8 }
    }),
    selectPlanMode: vi.fn(async (_id: SessionId, active: boolean) => ({
      active: false, pending: active, outcome: 'queued' as const,
    })),
    selectPermissionPreset: vi.fn(async (_id: SessionId, preset: string) => {
      permission = { ...permission, currentValue: preset }
    }),
    async *follow() { yield { type: 'baseline' as const, items: [] } },
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
    selectModel={controller.selectModel.bind(controller)} selectPreset={controller.selectPreset.bind(controller)}
    selectPlanMode={controller.selectPlanMode.bind(controller)}
    selectPermissionPreset={controller.selectPermissionPreset.bind(controller)}
    refreshModelControls={controller.refreshModelControls.bind(controller)} t={key => en[key]} />)
  return { client, controller }
}

it.each(['mode', 'plan', 'permission'] as const)('routes the %s composer control through the Host Client', async (control) => {
  const { client, controller } = await renderControls()

  if (control === 'mode') {
    fireEvent.change(screen.getByRole('combobox', { name: en.mode }), { target: { value: 'minimal' } })
    await waitFor(() => expect(client.selectPreset).toHaveBeenCalledWith({
      id: 'session-alpha', preset: 'minimal', expectedRevision: 7,
    }, expect.any(AbortSignal)))
    expect(controller.getSnapshot().modeControls?.current).toBe('minimal')
  } else if (control === 'plan') {
    fireEvent.click(screen.getByRole('button', { name: en.planModeOff }))
    await waitFor(() => expect(client.selectPlanMode).toHaveBeenCalledWith(
      'session-alpha', true, expect.any(AbortSignal)))
    expect(controller.getSnapshot().modeControls?.planMode).toEqual({ available: true, active: false, pending: true })
  } else {
    fireEvent.change(screen.getByRole('combobox', { name: en.permission }), { target: { value: 'read-only' } })
    await waitFor(() => expect(client.selectPermissionPreset).toHaveBeenCalledWith(
      'session-alpha', 'read-only', expect.any(AbortSignal)))
    expect(controller.getSnapshot().permissionControls?.currentValue).toBe('read-only')
  }
})
