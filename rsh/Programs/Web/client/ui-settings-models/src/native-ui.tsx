/**
 * Native entrypoint for the Models settings page.
 *
 * The browser half registers into three Settings slots and drives the Host
 * through `ctx.remote`. A Native host has neither the Loader nor those Remote
 * namespaces, so this entry binds the same page to the Native transport and
 * registers {@link ModelsSection} into `settings.section` once the Native
 * settings host declares that slot.
 *
 * Reuse, not a second implementation: `ModelsSection`, `ModelsSettingsStore`,
 * `createModelsOperations` and every provider card are the browser build's own
 * modules. The only substitution is the transport — `createNativeModelsFace`
 * and `createNativeDescribeFace` answer the same carrier envelopes from
 * `clientNativeSession`.
 */

import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type {} from './native-services.ts'
import type {} from '@redspark/rsh-client-native-session/native'
import type {} from '@redspark/rsh-client-locale/native'
import type {} from '@redspark/rsh-client-ui-renderer/native'
// Type-only: pulls this package's SlotMap rows for the section's child seats.
import type {} from './client/slot-contract.ts'
import { ModelsSection } from './client/ModelsSection.tsx'
import { ModelsSettingsStore, type ModelsSettingsState, type ProviderDirectoryEntry, type ProviderRow } from './client/store.ts'
import { createModelsOperations, type ModelsOperations, type ModelDiscoveryOutcome, type SettingsWriteOutcome } from './client/operations.ts'
import type { SettingsSchemaOperations } from './client/schema-operations.ts'
import { resolveNativeSchema, type NativeSettingsSchemaSource } from './native-schema.ts'
import {
  createNativeModelsFace, followInvalidations, toCredentialFacts, toNamespaceView,
  type NativeModelsClient,
} from './native-ports.ts'
import { createNativeDescribeFace, type NativeDescribeClient } from './native-describe.ts'
import type { ModelsDescribeFace, ModelsDescribeSnapshot, ModelsRemoteFace, ModelsRemoteHost } from './client/ports.ts'
import { en, zh, type ModelsKey } from './client/locales.ts'

/** Dictionary namespace owned by this plugin, shared with the browser half. */
const NS = 'settings.models'

export { NS, en, zh, en as nativeModelsEn, zh as nativeModelsZh }
export type { ModelsKey } from './client/locales.ts'
export {
  ModelsSettingsStore, createModelsOperations,
  createNativeModelsFace, createNativeDescribeFace, followInvalidations,
  toCredentialFacts, toNamespaceView,
}
export type { ModelsOperations, SettingsSchemaOperations, SettingsWriteOutcome, ModelDiscoveryOutcome }
export { resolveNativeSchema }
export type { NativeSettingsSchemaSource }
export type { NativeModelsClient } from './native-ports.ts'
export type { NativeDescribeClient } from './native-describe.ts'
export type { ModelsSettingsState, ProviderDirectoryEntry, ProviderRow }
export type { ModelsDescribeFace, ModelsDescribeSnapshot, ModelsRemoteFace, ModelsRemoteHost }
export type { ModelsSectionInjected, ModelsSectionProps } from './client/ModelsSection.tsx'
export type { ModelsFooterOwnerProps, ProviderCardExtrasOwnerProps } from './client/slot-contract.ts'
export type { DeepSeekOnboardingInjected } from './client/DeepSeekOnboardingDialog.tsx'
export type { WelcomeNoticeInjected } from './client/WelcomeNotice.tsx'

/**
 * The Models page as a Native composition binds it: one transport-bound store,
 * the card operations, and the schema callbacks.
 */
export interface NativeModelsPage {
  /** The page's join store, loaded on first use. */
  readonly controller: ModelsSettingsStore
  /** Host operations the section and its provider cards invoke. */
  readonly operations: ModelsOperations
  /** Settings schema reads and immutable draft edits. */
  readonly schema: SettingsSchemaOperations
  /** Feature copy in the active language. */
  readonly t: (key: ModelsKey) => string
  /** Release the invalidation follow this page owns. */
  dispose(): Promise<void>
}

/**
 * Bind the Models page to the Native transport.
 * @param client - the Native Session client selected by the browser composition.
 * @param schema - the settings domain base's Native schema port.
 * @param translate - feature copy in the active language.
 * @param signal - the composition's lifetime.
 * @returns the page binding, including the invalidation follow's release.
 */
export function createNativeModelsPage(
  client: NativeModelsClient & NativeDescribeClient,
  schema: SettingsSchemaOperations,
  translate: (key: ModelsKey) => string,
  signal: AbortSignal,
): NativeModelsPage {
  const face: ModelsRemoteFace = createNativeModelsFace(client, signal)
  const host: ModelsRemoteHost = { remote: face }
  const operations = createModelsOperations(host)
  const describe: ModelsDescribeFace = createNativeDescribeFace(client, signal)
  const controller = new ModelsSettingsStore(host, schema, describe)
  const follow = (async () => {
    try {
      for await (const _event of followInvalidations(client, signal)) {
        if (controller.store.getSnapshot().status !== 'idle') await controller.load()
      }
    } catch (error: unknown) {
      if (!signal.aborted) console.error('native models settings: invalidation follow failed', error)
    }
  })()
  return {
    controller,
    operations,
    schema,
    t: translate,
    dispose: async () => { await follow },
  }
}

/** Native Models settings: the browser page over the Native Session transport. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-client-ui-settings-models',
  targets: ['client'],
  requires: ['clientSlots', 'clientLocale', 'clientNativeSession'],
  optional: ['clientNativeSettings'],
  provides: [],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    const locale = context.require('clientLocale')
    const client = context.require('clientNativeSession')
    const schema = resolveNativeSchema(context.optional('clientNativeSettings'))
    if (schema === undefined) {
      throw new Error('native models settings: the settings domain base (clientNativeSettings) must be installed')
    }
    context.own(locale.register(NS, { en, zh }))
    const page = createNativeModelsPage(client, schema, key => locale.bind(NS)(key), context.signal)
    context.own(async () => { await page.dispose() })
    context.own(slots.inject('settings.section', () => slots.register({
      name: 'settings.section',
      id: 'models',
      order: 10,
      label: () => locale.bind(NS)('nav'),
      inject: () => ({
        controller: page.controller,
        hooks: { snapshot: page.controller.store },
        operations: page.operations,
        schema: page.schema,
        t: page.t,
      }),
      children: {
        'settings.models.provider-card': { kind: 'keyed', scope: 'root' },
        'settings.models.footer': { kind: 'list', scope: 'root' },
      },
    }, ModelsSection)))
  },
}
