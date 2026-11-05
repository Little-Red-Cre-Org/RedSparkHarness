// @vitest-environment jsdom
/**
 * The Native settings host declares the slots feature packages register into,
 * and the page renders those registrations.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { PropsRenderSlots } from '@redspark/rsh-client-ui-slots'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import { NativeHost, NativeScope, resolveInstallation } from '@redspark/rsh-native-runtime'
import type { NativeDirectoryPickerClient, NativeSessionClient } from '@redspark/rsh-client-native-session/native'
import type { NativeWorkspaceClient } from '@redspark/rsh-client-native-session/workspaces'
import { plugin as application } from '../src/native.ts'
import { plugin as locale } from '../../locale/src/native.ts'
import { plugin as renderer } from '../../ui-renderer/src/native.ts'
import { plugin as theme } from '../../ui-theme/src/native.ts'
import { plugin as sessionPresentation } from '../../ui-session/src/native.ts'

function untilAbort(signal?: AbortSignal): Promise<void> {
  if (signal === undefined) return new Promise<void>(() => {})
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
}

function sessionClient(): NativeSessionClient {
  const described = {
    hasDocument: false,
    namespaces: [],
    limits: { maxCredentialRefsPerRead: 64, maxSettingsOperations: 512 },
  }
  return {
    settingsDescribe: async () => described,
    settingsMutate: async () => { throw new Error('unused') },
    settingsOpenDocument: async () => {},
    credentialsDescribe: async () => ({}),
    credentialsSet: async () => {},
    credentialsUnset: async () => {},
    modelsListProviders: async () => [],
    modelsListConfigurableProviders: async () => [],
    modelsDiscover: async () => [],
    settingsEvents: async function* (signal?: AbortSignal) { await untilAbort(signal) },
    modelCatalog: async () => null,
    pluginInventoryList: async () => ({ entries: [] }),
    agentPresetsList: async () => ({ presets: [], directory: '' }),
    agentPresetRead: async () => { throw new Error('unused') },
    agentPresetCopy: async () => { throw new Error('unused') },
    agentPresetDelete: async () => {},
    agentPresetsCanOpenDirectory: async () => false,
    agentPresetOpenDirectory: async () => {},
    modelControls: async () => ({ catalog: null, canSelectModel: false, presets: [] }),
    follow: async function* () { yield { type: 'baseline', items: [] } },
    close: () => {},
  } as unknown as NativeSessionClient
}

const services: NativePlugin = {
  apiVersion: 1,
  name: 'test-native-settings-slot-services',
  targets: ['client'],
  requires: [],
  provides: ['clientNativeSession', 'clientNativeWorkspace', 'clientNativeDirectoryPicker'],
  resolve: () => (context) => {
    const client = sessionClient()
    context.provide('clientNativeSession', client)
    context.provide('clientNativeWorkspace', { close: () => {} } as NativeWorkspaceClient)
    context.provide('clientNativeDirectoryPicker', { close: () => {} } as unknown as NativeDirectoryPickerClient)
    context.own(() => { void client.close() })
  },
}

/** Registrations that stand in for the feature packages. */
const probes: NativePlugin = {
  apiVersion: 1,
  name: 'test-native-settings-slot-probes',
  targets: ['client'],
  requires: ['clientSlots'],
  provides: [],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    context.own(slots.inject('settings.plugins.tab', () => slots.register({
      name: 'settings.plugins.tab',
      id: 'probe',
      order: 0,
      label: () => 'Plugin list',
    }, () => <p>plugins-slot-probe</p>)))
    context.own(slots.inject('settings.section', () => slots.register({
      name: 'settings.section',
      id: 'models',
      order: 0,
      label: () => 'Models',
    }, () => <p>models-slot-probe</p>)))
  },
}

function SettingsHost({ renderSlot }: PropsRenderSlots<'sidebar.settings'>) {
  return renderSlot('sidebar.settings', { wide: false })
}

/** Declare the sidebar seat the application fills, then mount that tree. */
const shell: NativePlugin = {
  apiVersion: 1,
  name: 'test-native-settings-slot-shell',
  targets: ['client'],
  requires: ['clientSlots', 'clientRenderer', 'clientApplication'],
  provides: [],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    context.own(slots.register({
      name: 'root',
      children: { 'sidebar.settings': { kind: 'single', scope: 'root' } },
    }, SettingsHost))
    const container = document.createElement('div')
    document.body.append(container)
    context.own(context.require('clientRenderer').mount(container, {
      render: () => slots.renderSlot('root', {}),
    }, context.signal))
  },
}

const started: NativeHost[] = []

afterEach(async () => {
  cleanup()
  document.body.replaceChildren()
  while (started.length > 0) await started.pop()?.stop()
})

it('shows a registration in the plugins tab and the models section', async () => {
  const scope = new NativeScope()
  const host = new NativeHost(resolveInstallation([
    { plugin: services, scope, config: undefined },
    { plugin: renderer, scope, config: undefined },
    { plugin: locale, scope, config: { locale: 'en' } },
    { plugin: theme, scope, config: undefined },
    { plugin: application, scope, config: { maxLiveTextChars: 1024, maxLiveEvents: 32 } },
    { plugin: sessionPresentation, scope, config: undefined },
    { plugin: probes, scope, config: undefined },
    { plugin: shell, scope, config: undefined },
  ], 'client'))
  await host.start()
  started.push(host)

  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Plugins' }))
  fireEvent.click(await screen.findByRole('tab', { name: 'Plugin list' }))
  expect(await screen.findByText('plugins-slot-probe')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Models' }))
  expect(await screen.findByText('models-slot-probe')).toBeTruthy()
  expect(screen.queryByText('plugins-slot-probe')).toBeNull()
})
