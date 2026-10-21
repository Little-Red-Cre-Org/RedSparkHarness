// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { NativePluginInventory, NativeSessionClient } from '@deepseek-ai/dsh-client-native-session/native'
import { en } from '../src/locales.ts'
import { PluginInventoryTab } from '../src/plugin-inventory-tab.tsx'

afterEach(cleanup)

const inventory: NativePluginInventory = { entries: [
  { id: '8cbde858-aadc-4a3f-b4f0-1276c0ce066d', name: 'cordis-plugin-alpha', scope: '05b294cc-89d7-494b-b1aa-ebb945ab3443', state: 'ready' },
  { id: 'cc2ef3a5-110c-4f67-8b89-2a945cd5f2fc', name: 'dsh-client-tool-beta', scope: '05b294cc-89d7-494b-b1aa-ebb945ab3443', state: 'failed', failure: 'activation' },
  { id: '9a56c8ad-5877-46b2-9a7f-9ba0bd90e754', name: 'cleanup-error', scope: '05b294cc-89d7-494b-b1aa-ebb945ab3443', state: 'failed', failure: 'cleanup' },
  { id: 'cd247758-bbba-4355-bef2-e1f3b5be0a1c', name: 'gamma', scope: '734a848e-ff23-48a3-8dc4-780ff89393de', state: 'disposed' },
] }

function renderTab(pluginInventoryList: NativeSessionClient['pluginInventoryList'], active = true) {
  const actions = { pluginInventoryList }
  return render(<PluginInventoryTab actions={actions} t={key => en[key]} active={active} />)
}

it('loads and protects inventory responses while exposing scope and plugin details', async () => {
  let finishFirst!: (value: NativePluginInventory) => void
  const firstRequest = vi.fn<NativeSessionClient['pluginInventoryList']>(() => new Promise((resolve) => {
    finishFirst = resolve
  }))
  const retryRequest = vi.fn<NativeSessionClient['pluginInventoryList']>()
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce(inventory)
  const view = renderTab(firstRequest, false)
  expect(firstRequest).not.toHaveBeenCalled()

  view.rerender(<PluginInventoryTab actions={{ pluginInventoryList: firstRequest }} t={key => en[key]} active />)
  expect(await screen.findByRole('status')).toHaveProperty('textContent', en.settingsPluginListLoading)
  view.rerender(<PluginInventoryTab actions={{ pluginInventoryList: retryRequest }} t={key => en[key]} active />)
  fireEvent.click(await screen.findByRole('button', { name: en.settingsPluginListRetry }))

  expect(await screen.findByText('alpha')).toBeTruthy()
  await act(async () => {
    finishFirst({ entries: [
      { id: 'stale', name: 'stale-response', scope: 'stale-scope', state: 'ready' },
    ] })
  })
  expect(screen.queryByText('stale-response')).toBeNull()
  expect(screen.getByText('Scope 05b294cc')).toBeTruthy()
  expect(screen.getAllByText(en.settingsPluginListScopeSubtitle, { exact: false })).toHaveLength(2)
  expect(screen.getByText('Scope 734a848e', { exact: false })).toBeTruthy()
  expect(screen.getByText('cordis-plugin-alpha')).toBeTruthy()
  expect([...view.container.querySelectorAll('[data-plugin-scope]')].map(group => group.getAttribute('data-plugin-scope')))
    .toEqual(['05b294cc-89d7-494b-b1aa-ebb945ab3443', '734a848e-ff23-48a3-8dc4-780ff89393de'])
  expect(screen.getByText(en.settingsPluginListReady)).toBeTruthy()
  expect(screen.getByText(`${en.settingsPluginListFailed} · ${en.settingsPluginListFailureActivation}`)).toBeTruthy()
  expect(screen.getByText(`${en.settingsPluginListFailed} · ${en.settingsPluginListFailureCleanup}`)).toBeTruthy()
  expect(screen.getByText(en.settingsPluginListDisposed)).toBeTruthy()

  const scopeButton = screen.getByRole('button', { name: /Scope 05b294cc/ })
  fireEvent.click(scopeButton)
  expect(scopeButton.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByText('alpha')).toBeNull()
  fireEvent.click(scopeButton)
  expect(scopeButton.getAttribute('aria-expanded')).toBe('true')
  const failedCard = screen.getByText('dsh-client-tool-beta').closest('li')!
  fireEvent.click(failedCard.querySelector('button')!)
  expect(within(failedCard).getByText(en.settingsPluginListFailure)).toBeTruthy()
  expect(within(failedCard).getByText(en.settingsPluginListFailureActivation)).toBeTruthy()

  const emptyRequest = vi.fn<NativeSessionClient['pluginInventoryList']>(async () => ({ entries: [] }))
  view.rerender(<PluginInventoryTab actions={{ pluginInventoryList: emptyRequest }} t={key => en[key]} active />)
  expect(await screen.findByText(en.settingsPluginListEmpty)).toBeTruthy()
  view.rerender(<PluginInventoryTab actions={{ pluginInventoryList: async () => inventory }} t={key => en[key]} active />)
  expect(await screen.findByText('alpha')).toBeTruthy()
  fireEvent.change(screen.getByRole('searchbox', { name: en.settingsPluginListSearch }), { target: { value: 'no match' } })
  expect(screen.getByText(en.settingsPluginListEmptySearch)).toBeTruthy()
})

it.each(['CC2EF3A5', 'DSh-CLIENT-TOOL-BETA'])('filters plugin names and ids without case sensitivity: %s', async (query) => {
  renderTab(vi.fn<NativeSessionClient['pluginInventoryList']>(async () => inventory))

  await screen.findByText('alpha')
  fireEvent.change(screen.getByRole('searchbox', { name: en.settingsPluginListSearch }), { target: { value: query } })

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
