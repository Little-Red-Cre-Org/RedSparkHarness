/**
 * Native entrypoint for the read-only plugin inventory tab.
 *
 * The Cordis half registers `settings.plugins.tab` and reads the Loader's
 * composition through `ctx.remote.pluginInventory`. A Native host has neither
 * that Remote namespace nor a Loader: the running profile reports its own
 * installation inventory through `clientNativeSession.pluginInventoryList`.
 *
 * Everything below the data port is the browser build's own component,
 * unchanged — {@link PluginInventorySettingsTab} already takes its catalog as
 * an injected `list` callback plus a `presetName` resolver. This entry binds
 * those two ports to the Native transport and adapts the installation rows
 * onto the snapshot the component renders.
 */

import type { ReactNode } from 'react'
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type {
  NativePluginInventory, NativePluginInventoryEntry, NativeSessionClient,
} from '@redspark/rsh-client-native-session/native'
import { brandString } from '@redspark/rsh-brand'
import type { PluginEntryId } from '@redspark/rsh-host-plugin-inventory/types'
import type { TranslateNS } from '@redspark/rsh-client-ui-slots'
import type {} from '@redspark/rsh-client-ui-renderer/native'
import type {} from '@redspark/rsh-client-locale/native'
import {
  PluginInventorySettingsTab,
  type PluginInventorySettingsTabInjected,
} from './client/PluginInventorySettingsTab.tsx'
import type { PluginInventorySnapshot } from '@redspark/rsh-host-plugin-inventory/types'
import { en, zh, type PluginInventoryLocaleKey } from './client/locales.ts'

/** Dictionary namespace owned by this plugin, shared with the browser half. */
const NS = 'settings.pluginInventory'

export { NS, en, zh, en as nativePluginInventoryEn, zh as nativePluginInventoryZh, type PluginInventoryLocaleKey }
export {
  PluginInventorySettingsTab,
  type PluginInventorySettingsTabInjected,
  type PluginInventorySettingsTabProps,
} from './client/PluginInventorySettingsTab.tsx'
export type { PluginInventorySnapshot } from '@redspark/rsh-host-plugin-inventory/types'

// The tab seat is declared by the Native settings shell. This package's own
// program cannot reach the Cordis contract module that declares it (that module
// belongs to a compatibility package with no Native entry), so the declaration
// is restated here with the same shape the shared contract uses: a root-scoped
// list whose owner supplies nothing.
declare module '@redspark/rsh-client-ui-slots' {
  interface SlotMap {
    /** One page inside the Plugins settings section. */
    'settings.plugins.tab': { kind: 'list'; scope: 'root'; owner: NativePluginsTabOwnerProps }
  }
}

/** Owner share of a Plugins tab (the section supplies nothing). */
export interface NativePluginsTabOwnerProps {
  /** Marker field: tab owner props are intentionally empty. */
  children?: never
}

type NativeInventoryClient = Pick<NativeSessionClient, 'pluginInventoryList'>

/**
 * Map one Native installation state onto the Loader root-fiber phase the
 * catalog renders. The two vocabularies describe the same lifecycle, so the
 * mapping is total over the wire union.
 * @param state - installation state reported by the running profile.
 * @returns the corresponding root-fiber phase, or null when no fiber stands.
 */
export function installationPhase(state: NativePluginInventoryEntry['state']): PluginInventorySnapshot['entries'][number]['fiberPhase'] {
  switch (state) {
    case 'planned': return 'pending'
    case 'activating': return 'loading'
    case 'ready': return 'active'
    case 'draining': return 'unloading'
    case 'failed': return 'failed'
    case 'disposed': return null
    /* v8 ignore next -- closed wire state union */
    default: return assertNever(state)
  }
}

/** Closed-union exhaustiveness fence for the installation state set. */
function assertNever(value: never): never {
  throw new Error(`unhandled native installation state: ${JSON.stringify(value)}`)
}

/**
 * Adapt the running profile's installation inventory onto the catalog snapshot.
 *
 * A Native profile installs the rows its composition names, so every reported
 * installation is enabled; `disposed` is the one state that has already left
 * the composition and is therefore reported as disabled rather than installed.
 * @param inventory - installation rows as the Host reports them.
 * @returns a snapshot carrying the global plane; no Agent-preset roster exists
 *   on the Native transport, so `agentPresets` stays absent.
 */
export function toSnapshot(inventory: NativePluginInventory): PluginInventorySnapshot {
  return {
    entries: inventory.entries.map(entry => ({
      entryId: brandString<PluginEntryId>(entry.id),
      moduleName: entry.name,
      enabled: entry.state !== 'disposed',
      fiberPhase: installationPhase(entry.state),
    })),
  }
}

/**
 * Bind the Native installation inventory as the catalog's read port.
 * @param client - the Native Session client selected by the browser composition.
 * @returns the injected face the tab component renders from.
 */
export function createInventoryPorts(
  client: NativeInventoryClient,
): Pick<PluginInventorySettingsTabInjected, 'list'> {
  return { list: async () => toSnapshot(await client.pluginInventoryList()) }
}

/** Native plugin inventory tab: the browser build's catalog over Native installation rows. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-client-ui-settings-plugin-inventory',
  targets: ['client'],
  requires: ['clientSlots', 'clientLocale', 'clientNativeSession'],
  optional: [],
  provides: [],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    const locale = context.require('clientLocale')
    const client = context.require('clientNativeSession')
    context.own(locale.register(NS, { en, zh }))
    const ports = createInventoryPorts(client)
    // The Native transport reports installations, not preset compositions, so
    // no preset roster reaches the catalog and this resolver never runs.
    const presetName: PluginInventorySettingsTabInjected['presetName'] = preset => preset.name ?? preset.id
    context.own(slots.inject('settings.plugins.tab', () => slots.register({
      name: 'settings.plugins.tab',
      id: 'all',
      order: 10,
      // The settings shell renders label and order from the ledger, so the tab
      // names itself in its own dictionary.
      label: () => locale.bind(NS)('tab'),
      locale: NS,
      inject: (): PluginInventorySettingsTabInjected => ({ list: ports.list, presetName }),
    }, ({ list, presetName: name, t }: PluginInventorySettingsTabInjected & {
      t: TranslateNS<typeof NS>
    }): ReactNode => <PluginInventorySettingsTab list={list} presetName={name} t={t} />)))
  },
}
