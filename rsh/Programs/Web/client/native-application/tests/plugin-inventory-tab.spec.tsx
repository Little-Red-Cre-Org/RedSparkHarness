// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { NativePluginInventory, NativeSessionClient } from '@deepseek-ai/dsh-client-native-session/native'
import { en } from '../src/locales.ts'
import { PluginInventoryTab } from '../src/plugin-inventory-tab.tsx'

afterEach(cleanup)

const inventory: NativePluginInventory = { entries: [
  { id: 'plugin.alpha', name: 'cordis-plugin-alpha', scope: 'root', state: 'ready' },
  { id: 'plugin.beta', name: 'dsh-client-tool-beta', scope: 'root', state: 'failed', failure: 'activation' },
  { id: 'plugin.gamma', name: 'gamma', scope: 'global', state: 'disposed' },
] }

function renderTab(pluginInventoryList: NativeSessionClient['pluginInventoryList'], active = true) {
  const actions = { pluginInventoryList }
  return render(<PluginInventoryTab actions={actions} t={key => en[key]} active={active} />)
}

it('loads on first display and renders scope groups with lifecycle tags', async () => {
  const pluginInventoryList = vi.fn<NativeSessionClient['pluginInventoryList']>(async () => inventory)
  const view = renderTab(pluginInventoryList, false)
  expect(pluginInventoryList).not.toHaveBeenCalled()

  view.rerender(<PluginInventoryTab actions={{ pluginInventoryList }} t={key => en[key]} active />)

  expect(await screen.findByText('alpha')).toBeTruthy()
  expect(screen.getByText(en.settingsPluginListHostScope)).toBeTruthy()
  expect(screen.getByText(en.settingsPluginListGlobalScope)).toBeTruthy()
  expect(screen.getByText(en.settingsPluginListReady)).toBeTruthy()
  expect(screen.getByText(`${en.settingsPluginListFailed} · ${en.settingsPluginListFailureActivation}`)).toBeTruthy()
  expect(screen.getByText(en.settingsPluginListDisposed)).toBeTruthy()
})

it('filters plugin names and ids without case sensitivity', async () => {
  renderTab(vi.fn<NativeSessionClient['pluginInventoryList']>(async () => inventory))

  await screen.findByText('alpha')
  fireEvent.change(screen.getByRole('searchbox', { name: en.settingsPluginListSearch }), { target: { value: 'PLUGIN.BETA' } })

  expect(screen.getByText('tool-beta')).toBeTruthy()
  expect(screen.queryByText('alpha')).toBeNull()
  expect(screen.queryByText('gamma')).toBeNull()
})

it('shows a retry after a failed read and renders the returned inventory', async () => {
  const pluginInventoryList = vi.fn<NativeSessionClient['pluginInventoryList']>()
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce(inventory)
  renderTab(pluginInventoryList)

  fireEvent.click(await screen.findByRole('button', { name: en.settingsPluginListRetry }))

  expect(await screen.findByText('alpha')).toBeTruthy()
  expect(pluginInventoryList).toHaveBeenCalledTimes(2)
})
