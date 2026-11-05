/**
 * Cordis-side settings document mirror.
 *
 * The read fold, the rerun guard and the write fold live in
 * {@link SettingsMirrorEngine}; this module supplies only the transport — one
 * `ctx.remote.settings.describe` read whose carrier envelope becomes a
 * {@link SettingsDescribeAnswer}. The Native half binds the same engine to
 * `clientNativeSession`.
 */

import type { Context as ClientContext } from '@redspark/cordis'
import type { SettingsNamespaceView } from '@redspark/rsh-api-remotes/client'
import { SettingsMirrorEngine, type SettingsDescribeFaceOf } from './settings-engine.ts'

export type {
  SettingsDescribeAnswer, SettingsDescribeFaceOf, SettingsMirrorFacts, SettingsNamespaceFacts,
} from './settings-engine.ts'
import type { SettingsMirrorSnapshot as MirrorSnapshot } from './settings-engine.ts'

/**
 * Mirror state over the Cordis wire's namespace view.
 *
 * The engine's snapshot is generic in the namespace row because a Native
 * transport reports descriptor fields the Cordis wire does not; this alias
 * keeps the Cordis-facing name as narrow as it always was.
 */
export type SettingsMirrorSnapshot = MirrorSnapshot<SettingsNamespaceView>

/** The generic snapshot, for consumers that also read another transport's rows. */
export type SettingsMirrorSnapshotOf<Namespace extends import('./settings-engine.ts').SettingsNamespaceFacts> =
  MirrorSnapshot<Namespace>

/** The full describe answer the mirror serves: the Host's namespaces and its write capability. */
export interface SettingsDescribeView {
  /** Every namespace a live Host plugin registered, as the Host reported it. */
  namespaces: readonly SettingsNamespaceView[]
  /** Whether the settings provider accepts writes. */
  readonly writable: boolean
  /** Whether a native settings document exists for the Host to open. */
  readonly hasDocument: boolean
}

/** The mirror as cross-namespace surfaces consume it, typed over the wire's namespace view. */
export type SettingsDescribeFace = SettingsDescribeFaceOf<SettingsNamespaceView>

/**
 * Serializes every Host `settings.describe` read behind one snapshot store.
 * Concurrent {@link SettingsDescribeMirror.load} calls fold into the in-flight
 * read plus one rerun, so an invalidation arriving mid-read is never lost and
 * never duplicated.
 */
export class SettingsDescribeMirror extends SettingsMirrorEngine<SettingsNamespaceView> {
  /**
   * @param ctx - the providing plugin's context, whose `remote.settings`
   * namespace answers the describe read.
   * @param persistence - client-selected Host persistence; non-loopback pages may remain process-local.
   */
  constructor(
    ctx: ClientContext,
    persistence: 'host' | 'memory' = 'host',
  ) {
    super(async () => {
      try {
        const response = await ctx.remote.settings.describe()
        return response.ok
          ? { view: response.value }
          : { failure: response.error.message }
      } catch (error) {
        return { failure: error instanceof Error ? error.message : String(error) }
      }
    }, persistence)
  }
}
