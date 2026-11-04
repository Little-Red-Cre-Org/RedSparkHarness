// @vitest-environment jsdom
/**
 * Native half lifecycle over the real Native runtime: the plugin assembles
 * against real `clientSlots` / `clientLocale` providers, waits for the Plugins
 * tab seat, and contributes the catalog over the Host installation inventory.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import type { NativePluginInventory } from '@redspark/rsh-client-native-session/native'
import { plugin as renderer } from '../../ui-renderer/src/native.ts'
import { plugin as locale } from '../../locale/src/native.ts'
import { plugin } from '../src/native.ts'

/** Stand-in for the Native Session client: this plugin reads only its inventory. */
function inventoryProvider(inventory: NativePluginInventory): NativePlugin {
  return {
    apiVersion: 1,
    name: 'test-client-native-session-stub',
    targets: ['client'],
    requires: [],
    provides: ['clientNativeSession'],
    resolve: () => (context) => { context.provide('clientNativeSession', { pluginInventoryList: async () => inventory } as never) },
  }
}

/**
 * Declare `settings.plugins.tab` the way the Native settings shell does. This
 * package's `slots.inject` waits for the declaration, so a bench without it
 * observes no contribution.
 */
const tabDeclaration: NativePlugin = {
  apiVersion: 1,
  name: 'test-client-native-plugins-tab-declaration',
  targets: ['client'],
  requires: ['clientSlots'],
  provides: [],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    context.own(slots.register({
      name: 'root',
      children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
    } as never, () => null))
  },
}

const started: NativeHost[] = []

/** One assembled bench: the real providers, this plugin, and a slot probe. */
async function start(options: {
  readonly inventory?: NativePluginInventory
  readonly declareTab: boolean
  readonly seen: { entries(key: string): { options: { id?: string } }[] }[]
}): Promise<NativeHost> {
  const scope = new NativeScope()
  const host = new NativeHost(resolveInstallation([
    { plugin: renderer, scope, config: undefined },
    { plugin: locale, scope, config: undefined },
    { plugin: inventoryProvider(options.inventory ?? EMPTY), scope, config: undefined },
    { plugin: probePlugin(options.seen), scope, config: undefined },
    ...(options.declareTab ? [{ plugin: tabDeclaration, scope, config: undefined }] : []),
    { plugin, scope, config: undefined },
  ], 'client'))
  await host.start()
  started.push(host)
  return host
}

/** Read the entries this plugin contributed to the Plugins tab seat. */
function contributed(seen: { entries(key: string): { options: { id?: string } }[] }[]): (string | undefined)[] {
  return seen[0]?.entries('settings.plugins.tab').map(entry => entry.options.id) ?? []
}

const EMPTY: NativePluginInventory = { entries: [] }

/** Probe that captures the live slot runtime the plugin registered into. */
function probePlugin(seen: { entries(key: string): { options: { id?: string } }[] }[]): NativePlugin {
  return {
    apiVersion: 1,
    name: 'test-client-native-plugin-inventory-probe',
    targets: ['client'],
    requires: ['clientSlots'],
    provides: [],
    resolve: () => (context) => { seen.push(context.require('clientSlots') as never) },
  }
}

afterEach(async () => {
  while (started.length > 0) await started.pop()?.stop()
  vi.unstubAllGlobals()
})

describe('plugin inventory native half', () => {
  it('declares the services it binds and the target it serves', () => {
    expect(plugin.apiVersion).toBe(1)
    expect(plugin.name).toBe('@redspark/rsh-client-ui-settings-plugin-inventory')
    expect(plugin.targets).toEqual(['client'])
    expect(plugin.requires).toEqual(['clientSlots', 'clientLocale', 'clientNativeSession'])
    expect(plugin.provides).toEqual([])
  })

  it('contributes the catalog once the Plugins tab seat is declared', async () => {
    const seen: { entries(key: string): { options: { id?: string } }[] }[] = []
    await start({ declareTab: true, seen })
    expect(contributed(seen)).toEqual(['all'])
  })

  it('contributes nothing while the seat is undeclared', async () => {
    const seen: { entries(key: string): { options: { id?: string } }[] }[] = []
    await start({ declareTab: false, seen })
    expect(contributed(seen)).toEqual([])
  })

  it('teardown removes the contribution (reload safety)', async () => {
    const seen: { entries(key: string): { options: { id?: string } }[] }[] = []
    const host = await start({ declareTab: true, seen })
    expect(contributed(seen)).toHaveLength(1)
    await host.stop()
    expect(contributed(seen)).toHaveLength(0)
  })
})
