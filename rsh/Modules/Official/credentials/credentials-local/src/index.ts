/**
 * File-backed credentials provider over `$DSH_HOME/.credentials.yaml`, layered
 * against the environment by how much each layer is trusted:
 *
 * ```text
 * inherited process environment      (read-only, wins)
 * > $DSH_HOME/.credentials.yaml      (provider-managed, writable)
 * > <invocation cwd>/.env            (read-only fallback)
 * > $DSH_HOME/.env                   (read-only fallback)
 * ```
 *
 * The inherited environment wins because `DEEPSEEK_API_KEY=… dsh`, a CI
 * secret, or a container `-e` is this run's explicit intent; it cannot be
 * edited from inside, so it must be *visibly* read-only rather than silently
 * shadow writes. Everything below it loses to the managed store, so a key the
 * Models page writes takes effect immediately even when an older key sits in
 * the user's `.env`.
 *
 * The invoking project may supply a key, because the product trusts the
 * project it is launched in. It ranks below the managed store, so a key stored
 * through the Models page is never displaced by one a checkout happens to carry.
 *
 * The file is the provider-managed writable source: every write re-reads the
 * document under a cross-process writer lock before patching only its own key
 * — comments and the formatting of every untouched entry survive — external
 * edits hot-publish through the seam, and each reload replaces the snapshot
 * wholesale so a deleted entry never lingers in memory.
 *
 * The document holds nothing but credentials, which is why it is a strict
 * `CredentialRef`-to-string mapping rather than a dotenv file: a store the
 * Harness owns and never materializes into the environment cannot also serve
 * as the user's environment layer; a store that doubled as the environment
 * layer would shadow non-secret entries behind its precedence, making them
 * silently unreachable.
 * @module @deepseek-ai/dsh-credentials-local
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialKey, CredentialRecord, CredentialRecordEntry, CredentialRecordInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { NativeLocalCredentialProvider } from './backend.ts'
import type { Config } from './document.ts'

export { CREDENTIALS_FILENAME, DOCUMENT_VERSION, parseCredentialsDocument, renderFlatLayoutMigration, resolveSpec } from './document.ts'
export type { Config, CredentialsDocument } from './document.ts'

/** Cordis service adapter over the local credential backend. */
export class LocalCredentialProvider extends CredentialProvider {
  static Config: z<Config> = z.object({
    path: z.string(),
    dshHome: z.string(),
    watch: z.boolean().default(true),
    debounceMs: z.number().min(0).default(100),
  })
  private readonly backend: NativeLocalCredentialProvider

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.backend = new NativeLocalCredentialProvider({
      environment: () => launchEnvironmentOf(ctx),
      logger: {
        info: (message, ...args) => { ctx.logger.info(message, ...args) },
        warn: (message, ...args) => { ctx.logger.warn(message, ...args) },
        error: (message, ...args) => { ctx.logger.error(message, ...args) },
      },
      referenceUpdated: (ref) => { this.notifyUpdated(ref) },
      recordUpdated: (key) => { this.notifyRecordUpdated(key) },
    }, config)
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    yield () => this.backend.dispose()
    await this.backend.start()
  }

  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> { return this.backend.resolve(ref) }
  override describe(ref: CredentialRef): Promise<CredentialInfo> { return this.backend.describe(ref) }
  override set(ref: CredentialRef, value: string): Promise<void> { return this.backend.set(ref, value) }
  override unset(ref: CredentialRef): Promise<void> { return this.backend.unset(ref) }
  override readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> { return this.backend.readRecord(key) }
  override describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> { return this.backend.describeRecord(key) }
  override listRecords(): Promise<readonly CredentialRecordEntry[]> { return this.backend.listRecords() }
  override modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    return this.backend.modifyRecord(key, mutate)
  }
  override deleteRecord(key: CredentialKey): Promise<void> { return this.backend.deleteRecord(key) }
}

export default LocalCredentialProvider
