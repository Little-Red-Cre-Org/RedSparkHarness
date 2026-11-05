/**
 * Native entry for the settings domain base: the namespace scope service and
 * the one Host document reader, over `clientNativeSession`.
 *
 * The Cordis half resolves the document through `ctx.remote.settings` and
 * publishes `ctx.settingsScope` as a Cordis service. A Native host has neither,
 * so this entry:
 *
 * * binds the SAME engine (`client/settings-engine.ts`) to the Native
 *   transport — `settingsDescribe` for the document, `settingsMutate` for the
 *   one revision-fenced write — so the read fold, the write queue and the
 *   per-namespace derivation cannot drift between the two clients;
 * * publishes `clientNativeSettings` instead of a Cordis service, because a
 *   Native consumer reaches an installed capability through
 *   `context.require`, not through a service proxy;
 * * follows `settingsEvents` for invalidations. Cordis subscribes to a
 *   forwarded `settings/document-updated` event and to `connection/reset`;
 *   the Native Host pushes the same facts on one notification stream, so that
 *   stream is the only invalidation this entry needs.
 *
 * Writes stay durable because the Native transport only reaches a Host-owned
 * settings document: the Cordis half withholds them for a non-loopback page by
 * keeping preferences process-local, a distinction the Native page does not
 * have — its `/api` carrier is the Host's own.
 */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type {} from '@redspark/rsh-client-native-session/native'
import type { NativeSettingsDescriptor } from '@redspark/rsh-client-native-session/native'
import { createSettingsSchemaOperations, type SettingsSchemaOperations } from './client/schema-operations.ts'
import {
  SettingsMirrorEngine, SettingsScopeEngine,
  type SettingsDescribeAnswer, type SettingsDescribeFaceOf, type SettingsMirrorFacts,
  type SettingsMutate, type SettingsNamespaceFacts,
} from './client/settings-engine.ts'
import type { SettingsScope, SettingsScopeSpec } from './client/settings-contract.ts'

export type { SettingsPathOpView, SettingsScope, SettingsScopeSnapshot, SettingsScopeSpec } from './client/settings-contract.ts'
export type { SchemaNode, SettingsSchemaOperations } from './client/schema-operations.ts'
export type {
  SettingsDescribeAnswer, SettingsDescribeFaceOf, SettingsMirrorFacts,
  SettingsMirrorSnapshot, SettingsNamespaceFacts,
} from './client/settings-engine.ts'
export type {
  SettingsGeneralItemOwnerProps, SettingsHeaderOwnerProps, SettingsOnboardingOwnerProps,
  SettingsPluginsTabOwnerProps, SettingsSectionOwnerProps, SettingsTriggerOwnerProps,
} from './client/contract/slots.ts'

/**
 * One namespace as the shared engine reads it.
 *
 * The Native RPC spells namespace identity `namespace`; the engine's document
 * model spells it `ns`, which is what the Cordis wire uses. Adapting here
 * keeps the engine on one spelling instead of making every consumer know both.
 */
export interface NativeSettingsNamespace extends SettingsNamespaceFacts {
  /** The Host's own redacted descriptor, kept for pages that render schema detail. */
  readonly descriptor: NativeSettingsDescriptor
}

/** The Host document as a Native settings consumer reads it. */
export type NativeSettingsView = SettingsMirrorFacts<NativeSettingsNamespace>

/**
 * Adapt one Host descriptor into the engine's document model.
 * @param descriptor - namespace view returned by `settingsDescribe` or `settingsMutate`.
 * @returns the namespace facts every scope derives from.
 */
export function toNamespace(descriptor: NativeSettingsDescriptor): NativeSettingsNamespace {
  return {
    ns: descriptor.namespace,
    schema: descriptor.schema,
    value: descriptor.value,
    base: descriptor.base,
    user: descriptor.user,
    revision: descriptor.revision,
    descriptor,
  }
}

/** A bound namespace scope and the disposer that releases it. */
export interface NativeSettingsBinding<T> {
  /** The derived scope a preference row or domain store consumes. */
  readonly scope: SettingsScope<T>
  /** Release the scope and wait for the write already crossing the transport. */
  dispose(): Promise<void>
}

/**
 * Settings-namespace scopes for Native Client consumers.
 *
 * This is the Native face of the Cordis `ctx.settingsScope` service: the same
 * derivation and write rules, reached through `require` instead of a service
 * proxy.
 */
export interface NativeSettingsService {
  /**
   * Bind one namespace scope.
   * @param spec - domain-owned namespace contract.
   * @returns the bound scope and its disposer.
   */
  bind<T>(spec: SettingsScopeSpec<T>): NativeSettingsBinding<T>
  /**
   * The shared document's read/fold face for cross-namespace surfaces.
   * @returns the describe face over the shared mirror.
   */
  describe(): SettingsDescribeFaceOf<NativeSettingsNamespace>
  /** Settings-owned schema operations, the Native counterpart of `ctx.settingsSchema`. */
  readonly schema: SettingsSchemaOperations
}

declare module '@redspark/rsh-native-runtime' {
  interface NativeServices {
    /** Settings-namespace scopes over the selected Native Session transport. */
    clientNativeSettings: NativeSettingsService
  }
}

/**
 * Native settings Provider: one document mirror, one schema operation set, and
 * one scope per consumer namespace.
 */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-client-ui-settings',
  targets: ['client'],
  requires: ['clientNativeSession'],
  provides: ['clientNativeSettings'],
  resolve(input) {
    if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length > 0)) throw new TypeError('native settings: this provider takes no configuration')
    return (context) => {
      const client = context.require('clientNativeSession')
      const schema = createSettingsSchemaOperations()
      // The Native transport reports a refusal as a rejection, so this adapter
      // is the whole difference from the Cordis carrier fold.
      const fetch = async (): Promise<SettingsDescribeAnswer<NativeSettingsNamespace>> => {
        try {
          const described = await client.settingsDescribe(context.signal)
          return { view: {
            namespaces: described.namespaces.map(toNamespace),
            // A namespace is writable exactly when the Host exposed one: the
            // Native Host refuses a write to a namespace it does not serve.
            writable: described.namespaces.length > 0,
            hasDocument: described.hasDocument,
          } }
        } catch (error: unknown) {
          return { failure: error instanceof Error ? error.message : String(error) }
        }
      }
      const mirror = new SettingsMirrorEngine<NativeSettingsNamespace>(fetch)
      const write: SettingsMutate<NativeSettingsNamespace> = async (namespace, ops, expectedRevision) =>
        toNamespace(await client.settingsMutate(namespace, [...ops], expectedRevision ?? 0, context.signal))

      // One notification stream carries every invalidation the Cordis half
      // receives as separate events: a settings document commit, a
      // reconnection, and the credential, model and preset changes settings
      // pages reread for.
      void mirror.ensure()
      const notifications = (async () => {
        try {
          for await (const _frame of client.settingsEvents(context.signal)) {
            await mirror.load()
          }
        } catch (error: unknown) {
          if (!context.signal.aborted) console.error('native settings: settings events failed', error)
        }
      })()
      context.effect(async () => { await notifications })

      const scopes = new Set<SettingsScopeEngine<unknown, NativeSettingsNamespace>>()
      context.own(async () => {
        await Promise.all([...scopes].map(scope => scope.dispose()))
        scopes.clear()
      })

      const service: NativeSettingsService = {
        bind<T>(spec: SettingsScopeSpec<T>): NativeSettingsBinding<T> {
          const scope = new SettingsScopeEngine<T, NativeSettingsNamespace>(spec, mirror, 'host', schema, write)
          const owned = scope as SettingsScopeEngine<unknown, NativeSettingsNamespace>
          scopes.add(owned)
          return {
            scope,
            dispose: async () => {
              scopes.delete(owned)
              await scope.dispose()
            },
          }
        },
        describe: () => mirror,
        schema,
      }
      context.provide('clientNativeSettings', service)
    }
  },
}
