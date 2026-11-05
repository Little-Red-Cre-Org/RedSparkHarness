/**
 * Host transport for the settings-namespace scope contract. This file owns the
 * per-namespace derivation over the shared {@link SettingsDescribeMirror} and
 * the Cordis spelling of the serialized write path. Reads never touch the wire
 * here: the mirror is the one `settings.describe` reader, and every scope is a
 * selector over its snapshot.
 *
 * The derivation, queueing and recovery rules live in
 * {@link SettingsScopeEngine}; this module supplies the write transport and the
 * service identity a Cordis plugin needs. The Native half binds the same
 * engine to `clientNativeSession`.
 */

import { Service } from '@redspark/cordis'
import type { Context } from '@redspark/cordis'
import type { SettingsNamespaceView } from '@redspark/rsh-api-remotes/client'
// Type-only, and deliberately NOT `@redspark/rsh-api-remotes/client` alone: this
// package is reachable from the Host build graph through its feature-package
// callers, and api-remotes' Client face imports a Host-tsdown-generated
// `/remote` artifact, which would deadlock the Host tsc phase. The allowlist's
// `types` subpath is a pure-type source file, so the pair supplies `$on` and
// its key face without dragging a build artifact in. The runtime `remote`
// injection belongs to the providing plugin's apply.
import type {} from '@redspark/rsh-api-remotes/types'
// The forwarded event's own declaration: `$on`'s key face is
// `Extract<keyof Events, keyof Selection>`, so the allowlist alone resolves to
// never — the owning package's client-safe, type-only subpath supplies the
// cordis `Events` entry (and with it the branded `SettingsNamespace`).
import type {} from '@redspark/rsh-compat-settings-definition/events'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import type { SettingsScope, SettingsScopeSpec } from './settings-contract.ts'
import { SettingsScopeEngine } from './settings-engine.ts'
import { SettingsDescribeMirror } from './settings-mirror.ts'

export type {
  SettingsPathOpView, SettingsScope, SettingsScopeSnapshot, SettingsScopeSpec,
} from './settings-contract.ts'

/**
 * One namespace's derived view over the shared describe mirror, plus that
 * namespace's serialized Host writes over `ctx.remote.settings.mutate`.
 */
export class SettingsScopeController<T> extends SettingsScopeEngine<T, SettingsNamespaceView> {
  /**
   * @param ctx - the providing plugin's context, whose `remote.settings`
   * namespace carries this scope's writes (reads ride the mirror).
   * @param spec - namespace identity and optional narrowing decoder.
   * @param mirror - the shared describe mirror this scope derives from.
   * @param persistence - client-selected Host persistence; non-loopback pages may remain process-local.
   * @param schema - settings-owned schema operations.
   */
  constructor(
    ctx: Context,
    spec: SettingsScopeSpec<T>,
    mirror: SettingsDescribeMirror,
    persistence: 'host' | 'memory',
    schema: SettingsSchemaOperations,
  ) {
    super(spec, mirror, persistence, schema, async (namespace, ops, expectedRevision) => {
      const response = await ctx.remote.settings.mutate(namespace, [...ops], expectedRevision)
      if (!response.ok) throw new Error(`settings.mutate failed: ${response.error.code}: ${response.error.message}`)
      return response.value
    })
  }
}

declare module '@redspark/cordis' {
  interface Context {
    settingsScope: SettingsScopeBinder
  }
}

/**
 * The settings domain's base service. Features that own a preference reach the
 * settings transport through this service rather than a shared function: the
 * client bundle purity gate forbids cross-plugin value imports and directs
 * cross-plugin collaboration through cordis services
 * (`rsh/Programs/Web/client/tsdown.client.ts`).
 */
export class SettingsScopeBinder extends Service {
  private readonly mirror: SettingsDescribeMirror
  private readonly schema: SettingsSchemaOperations
  private readonly persistence: 'host' | 'memory'
  /**
   * The PROVIDING fiber, kept because a Service reads `ctx` as its *consumer's*
   * fiber: letting a bound scope write through the caller's context would make
   * every caller declare `remote.settings` in its own `inject`.
   */
  private readonly owner: Context

  /**
   * @param ctx - the providing plugin's context.
   * @param config - the shared describe mirror every bound scope derives from,
   * the settings-owned schema operations, and the Host persistence the provider
   * resolved from `remote.$host`.
   */
  constructor(ctx: Context, config: {
    mirror: SettingsDescribeMirror
    schema: SettingsSchemaOperations
    persistence: 'host' | 'memory'
  }) {
    super(ctx, 'settingsScope')
    this.mirror = config.mirror
    this.schema = config.schema
    this.persistence = config.persistence
    this.owner = ctx
  }

  /**
   * The shared mirror's read/fold face for cross-namespace surfaces (schema
   * introspection, the served-namespace directory). Per-namespace consumers
   * use {@link bind}; both derive from the same snapshot, so they can never
   * disagree about the document.
   * @returns the describe face over the shared mirror.
   */
  describe(): SettingsDescribeMirror {
    return this.mirror
  }

  /**
   * Bind one namespace scope on the CALLER's plugin lifecycle — the service
   * proxy binds `this.ctx` to the caller at call time, so the scope's disposer
   * belongs to the calling fiber. The scope derives from the shared mirror
   * (whose invalidation subscriptions live with the providing plugin), so
   * binding adds no wire read of its own and activation never blocks on the
   * settings transport.
   * @param spec - domain-owned namespace contract.
   * @returns the bound scope consumed by the domain's services and rows.
   */
  bind<T>(spec: SettingsScopeSpec<T>): SettingsScope<T> {
    const ctx = this.ctx
    const controller = new SettingsScopeController<T>(
      this.owner,
      spec,
      this.mirror,
      this.persistence,
      this.schema,
    )
    ctx.effect(() => {
      void this.mirror.ensure()
      return async () => {
        await controller.dispose()
      }
    }, `ui-settings: ${spec.namespace} settings scope`)
    return controller
  }
}
