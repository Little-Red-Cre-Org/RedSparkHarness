/** File-backed credential implementation shared by native and Cordis entry points. */
import { watch as chokidarWatch } from 'chokidar'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { canonicalizeWatchPath } from '@deepseek-ai/dsh-home-paths'
import type { LaunchEnvironmentEntry, LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment/native'
import { credentialRef, parseCredentialKey, type CredentialInfo, type CredentialKey, type CredentialRecord, type CredentialRef, type NativeCredentialRecordEntry, type NativeCredentialRecordInfo, type NativeCredentials, type NativeCredentialDeleteOptions, type NativeCredentialWriteOptions, type NativeResolvedCredential } from '@deepseek-ai/dsh-credentials/native'
import { assertJsonValue, assertOwnerOnly, assertStorableApiKey, DOCUMENT_LOCK_WAIT_MS, DOCUMENT_VERSION, isENOENT, parseCredentialsDocument, renderFlatLayoutMigration, renderRecord, renderRef, resolveSpec, sameJsonValue, type Config, type ResolvedSpec } from './document.ts'

/** Host resources and notifications supplied by the selected application runtime. */
export interface NativeCredentialRuntime {
  environment(): LaunchEnvironmentSnapshot
  readonly logger: {
    info(message: string, ...args: unknown[]): void
    warn(message: unknown, ...args: unknown[]): void
    error(message: unknown, ...args: unknown[]): void
  }
  referenceUpdated(ref: CredentialRef): void
  recordUpdated(key: CredentialKey): void
}

/** File-backed credentials provider (`$DSH_HOME/.credentials.yaml`). */
export class NativeLocalCredentialProvider implements NativeCredentials {
  private readonly spec: ResolvedSpec
  /**
   * Raw text of the last read or persisted document; `undefined` while the
   * file is absent. Watcher events whose content equals this cache are no-ops,
   * which is also the self-write suppression.
   */
  private text: string | undefined
  /** Parsed reference snapshot; replaced wholesale on every reload. */
  private values = new Map<string, string>()
  /** Parsed record snapshot; replaced wholesale on every reload. */
  private records = new Map<string, CredentialRecord>()
  /**
   * Single exclusive operation chain: watcher reloads and line edits run one
   * at a time in queue order (settled tail), so an edit can never render from
   * text a concurrent reload is busy replacing.
   */
  private operations: Promise<void> = Promise.resolve()
  /** Set at dispose: refuse new writes and let in-flight work no-op. */
  private closed = false
  private watcher?: ReturnType<typeof chokidarWatch>

  /** Opaque read of {@link closed}: control flow cannot narrow it across awaits. */
  private isClosed(): boolean {
    return this.closed
  }
  /* jscpd:ignore-end */

  constructor(private readonly runtime: NativeCredentialRuntime, public config: Config) {
    // Programmatic construction may bypass Schemastery normalization; resolve
    // the same defaults in one explicit step either way.
    this.spec = resolveSpec(config)
  }

  /** The inherited-environment value for a reference, or `undefined` when empty or unset. */
  private inherited(ref: CredentialRef): string | undefined {
    const entry = this.runtime.environment().getFrom(ref, ['process'])
    return entry !== undefined && entry.value.length > 0 ? entry.value : undefined
  }

  /**
   * The `.env` fallback for a reference — below the managed store, never above
   * it. The invoking project ranks over the user's home file, matching the
   * environment layering: the more specific location wins.
   */
  private dotenvFallback(ref: CredentialRef): LaunchEnvironmentEntry | undefined {
    const entry = this.runtime.environment().getFrom(ref, ['project-env', 'user-env'])
    return entry !== undefined && entry.value.length > 0 ? entry : undefined
  }

  /**
   * Load the initial document and start watching it when configured.
   * @returns completion after the initial read and watcher setup.
   */
  async start(): Promise<void> {
    await this.loadInitial()
    if (!this.spec.watch) return
    /* jscpd:ignore-start -- same watcher discipline as settings-file by design:
       the serialized-refresh and quiesce-on-dispose shape is the reviewed
       lifecycle contract, not accidental repetition. */
    const watcher = chokidarWatch(await canonicalizeWatchPath(this.spec.filename), {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: this.spec.debounceMs,
        pollInterval: Math.max(1, Math.min(this.spec.debounceMs, 10)),
      },
    })
    watcher.on('all', () => {
      if (this.closed) return
      this.queueRefresh()
    })
    watcher.on('ready', () => {
      // The initial load raced the watcher's own setup: a change written
      // between that read and the watcher becoming active never fires an
      // event. One reconcile at ready closes the gap.
      if (this.closed) return
      this.queueRefresh()
    })
    watcher.on('error', (error) => {
      this.runtime.logger.warn('credentials-local: watcher error on %s', this.spec.filename)
      this.runtime.logger.warn(error)
    })
    this.watcher = watcher
    /* jscpd:ignore-end */
  }

  /** Refuse new work, close the watcher, then drain queued operations. */
  async dispose(): Promise<void> {
    this.closed = true
    await this.watcher?.close()
    await this.operations
  }

  resolve(ref: CredentialRef): Promise<NativeResolvedCredential | undefined> {
    const inherited = this.inherited(ref)
    if (inherited !== undefined) return Promise.resolve({ value: inherited, source: 'env' })
    const stored = this.values.get(ref)
    if (stored !== undefined) return Promise.resolve({ value: stored, source: 'file' })
    const fallback = this.dotenvFallback(ref)
    if (fallback !== undefined) return Promise.resolve({ value: fallback.value, source: fallback.source })
    return Promise.resolve(undefined)
  }

  describe(ref: CredentialRef): Promise<CredentialInfo> {
    // Only the inherited environment is unwritable: it is the one layer this
    // process cannot edit. A user `.env` value is writable in the sense that
    // matters — storing a key replaces it as the effective one.
    if (this.inherited(ref) !== undefined) {
      return Promise.resolve({ configured: true, source: 'env', writable: false })
    }
    const stored = this.values.get(ref)
    if (stored !== undefined) return Promise.resolve({ configured: true, source: 'file', writable: true })
    const fallback = this.dotenvFallback(ref)
    if (fallback !== undefined) return Promise.resolve({ configured: true, source: fallback.source, writable: true })
    return Promise.resolve({ configured: false, writable: true })
  }

  async set(ref: CredentialRef, value: string): Promise<void> {
    if (value.length === 0) {
      throw new Error(`credentials-local: an empty value cannot be stored for "${ref}"; use unset`)
    }
    await this.write(ref, value)
  }

  async unset(ref: CredentialRef): Promise<void> {
    await this.write(ref, undefined)
  }

  readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(this.records.get(key))
  }

  describeRecord(key: CredentialKey): Promise<NativeCredentialRecordInfo> {
    const stored = this.records.get(key)
    // Presence is the whole fact here: no layer ranks above this document for
    // a record, so nothing can shadow one, and an api-key record carrying
    // neither a key nor environment values is a deliberate statement rather
    // than a blank.
    if (stored === undefined) return Promise.resolve({ configured: false, writable: true })
    return Promise.resolve({ configured: true, kind: stored.kind, writable: true })
  }

  listRecords(): Promise<readonly NativeCredentialRecordEntry[]> {
    return Promise.resolve([...this.records].map(([key, record]) => ({
      // The parser has already proven every stored key addressable.
      key: parseCredentialKey(key),
      kind: record.kind,
    })))
  }

  async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
    options?: NativeCredentialWriteOptions,
  ): Promise<CredentialRecord | undefined> {
    if (this.isClosed()) throw new Error(`credentials-local is disposed: cannot modify "${key}"`)
    return this.enqueue(async () => {
      options?.signal?.throwIfAborted()
      if (this.isClosed()) {
        throw new Error(`credentials-local was disposed before the queued "${key}" modify ran`)
      }
      await mkdir(dirname(this.spec.filename), { recursive: true, mode: 0o700 })
      return withFileLock(this.spec.filename, async () => {
        // Read-modify-write: `mutate` must decide against the record as it
        // stands now, not as this process last saw it — another process may
        // have rotated it since.
        await this.reconcileFromDisk()
        const current = this.records.get(key)
        const next = await mutate(current)
        // Once mutate starts, commit even if the caller aborts: it may have rotated a refresh token.
        if (next === undefined) return current
        // Admitted before it is rendered: what the read path would refuse is
        // refused here first, so a caller can never persist a document the
        // next boot rejects, and a value refused here has not been stored.
        if (next.kind === 'grant') assertJsonValue(`record "${key}" payload`, next.payload, new Set())
        else assertStorableApiKey(key, next)
        const nextText = renderRecord(this.text, key, next)
        // 0600: a document holding secrets is never world-readable.
        await writeFileAtomic(this.spec.filename, nextText, { mode: 0o600, dirMode: 0o700 })
        this.text = nextText
        this.records.set(key, next)
        // After the commit, on the same terms as a reference write.
        this.runtime.recordUpdated(key)
        return next
      }, { waitMs: DOCUMENT_LOCK_WAIT_MS })
    })
  }

  async deleteRecord(key: CredentialKey, options?: NativeCredentialDeleteOptions): Promise<void> {
    if (this.isClosed()) throw new Error(`credentials-local is disposed: cannot delete "${key}"`)
    await this.enqueue(async () => {
      options?.signal?.throwIfAborted()
      if (this.isClosed()) {
        throw new Error(`credentials-local was disposed before the queued "${key}" delete ran`)
      }
      await mkdir(dirname(this.spec.filename), { recursive: true, mode: 0o700 })
      await withFileLock(this.spec.filename, async () => {
        await this.reconcileFromDisk()
        const current = this.records.get(key)
        if (current === undefined || options?.when?.(current) === false) return
        options?.signal?.throwIfAborted()
        const nextText = renderRecord(this.text, key, undefined)
        await writeFileAtomic(this.spec.filename, nextText, { mode: 0o600, dirMode: 0o700 })
        this.text = nextText
        this.records.delete(key)
        this.runtime.recordUpdated(key)
      }, { waitMs: DOCUMENT_LOCK_WAIT_MS })
    })
  }

  /* jscpd:ignore-start -- the operation-chain and reload lifecycle is the same
     reviewed contract as settings-file, deliberately mirrored (prefer symmetry
     for parallel values); the two providers own different documents and
     failure policies, so extracting a shared helper would couple their teardown
     semantics across packages for a handful of lines. */
  /** Queue one exclusive document operation behind every earlier one. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.operations.then(operation)
    this.operations = task.then(() => undefined, () => undefined)
    return task
  }

  /** Queue a reload; only an invariant violation escaping the fan-out can reject it. */
  private queueRefresh(): void {
    void this.enqueue(() => this.refresh()).catch((error: unknown) => {
      // Only an invariant violation escaping the update fan-out can reject a
      // refresh; keep the operation queue alive and surface it as an error so
      // one poisoned commit cannot silently end hot reloading forever.
      this.runtime.logger.error('credentials-local: reload commit failed at %s', this.spec.filename)
      this.runtime.logger.error(error)
    })
  }
  /* jscpd:ignore-end */

  /** Queue one line edit; entry checks reject early, the queue re-judges them at run time. */
  private async write(ref: CredentialRef, value: string | undefined): Promise<void> {
    const verb = value === undefined ? 'unset' : 'set'
    if (this.isClosed()) {
      throw new Error(`credentials-local is disposed: cannot ${verb} "${ref}"`)
    }
    this.assertUnshadowed(ref, verb)
    return this.enqueue(async () => {
      if (this.isClosed()) {
        throw new Error(`credentials-local was disposed before the queued "${ref}" ${verb} ran`)
      }
      // Re-judged at run time: the environment may have changed while queued.
      this.assertUnshadowed(ref, verb)
      // The writer lock's exclusive create needs the parent to exist; 0700
      // because the harness home holds user-private data.
      await mkdir(dirname(this.spec.filename), { recursive: true, mode: 0o700 })
      await withFileLock(this.spec.filename, async () => {
        // Read-modify-write: fold in any on-disk state this process has not
        // observed yet — an external edit still inside the watcher debounce
        // window, a change the watcher missed, or another process's write —
        // so the line edit below can never resurrect a stale document.
        await this.reconcileFromDisk()
        const existing = this.values.get(ref)
        if (value === undefined && existing === undefined) return
        const nextText = renderRef(this.text, ref, value)
        // 0600: a document holding secrets is never world-readable.
        await writeFileAtomic(this.spec.filename, nextText, { mode: 0o600, dirMode: 0o700 })
        this.text = nextText
        if (value === undefined) this.values.delete(ref)
        else this.values.set(ref, value)
        // After the commit: a broken observer must never make the durable
        // write look failed (an INVARIANT failure still rethrows).
        this.runtime.referenceUpdated(ref)
      }, { waitMs: DOCUMENT_LOCK_WAIT_MS })
    })
  }

  /**
   * Reject a write the inherited environment would shadow into apparent
   * no-effect. Only that layer can shadow a write: everything else this
   * provider resolves ranks below the document being written.
   */
  private assertUnshadowed(ref: CredentialRef, verb: 'set' | 'unset'): void {
    if (this.inherited(ref) !== undefined) {
      throw new Error(
        `credentials-local: "${ref}" is supplied read-only by the launching environment, so ${verb} would be`
        + ' shadowed; unset it in the shell you start dsh from instead',
      )
    }
  }

  /**
   * Boot read: an absent file is an empty store; an invalid one fails the
   * plugin's activation, because a credentials document that exists but
   * cannot be trusted must never be treated as "no credentials stored". The
   * one exception is the recognized pre-release flat layout, which is
   * upgraded in place first — a key stored by an earlier build must survive
   * the layout change without a hand edit.
   */
  private async loadInitial(): Promise<void> {
    await assertOwnerOnly(this.spec.filename)
    let text: string
    try {
      text = await readFile(this.spec.filename, 'utf8')
    } catch (error) {
      if (!isENOENT(error)) throw error
      return
    }
    if (renderFlatLayoutMigration(text) !== undefined) text = await this.migrateFlatDocument()
    const document = parseCredentialsDocument(text, this.spec.filename)
    this.values = document.refs
    this.records = document.records
    this.text = text
  }

  /**
   * One-shot upgrade of the recognized pre-release flat layout, before the
   * watcher exists. The rewrite runs under the document's writer lock and
   * re-reads first — a concurrent boot may have migrated already — and
   * whatever the re-read finds that is not the flat layout is returned
   * untouched for the ordinary parse. Values are carried verbatim; only the
   * enclosing layout changes. Remove with the pre-release stance at the
   * first tagged release.
   * @returns the document text this boot should parse.
   */
  private async migrateFlatDocument(): Promise<string> {
    return withFileLock(this.spec.filename, async () => {
      const current = await readFile(this.spec.filename, 'utf8')
      const migrated = renderFlatLayoutMigration(current)
      /* v8 ignore next 2 -- the losing side of the cross-process migration race:
         another boot rewrote the document between the unlocked recognize and
         this lock. That interleaving cannot be scheduled deterministically
         through a whole boot (migration.spec drives it best-effort); the
         decision itself is the recognizer's covered versioned-document decline. */
      if (migrated === undefined) return current
      // 0600: a document holding secrets is never world-readable.
      await writeFileAtomic(this.spec.filename, migrated, { mode: 0o600, dirMode: 0o700 })
      this.runtime.logger.info(
        'credentials-local: migrated %s to the version %d layout; values are unchanged',
        this.spec.filename,
        DOCUMENT_VERSION,
      )
      return migrated
    }, { waitMs: DOCUMENT_LOCK_WAIT_MS })
  }

  /* jscpd:ignore-start -- same deliberate mirror of settings-file's reload and
     reconcile policy: warn-and-keep on a reload, throw on a write, invariant
     failures propagate. */
  /**
   * Re-read the document after a watcher event. Unchanged content (including
   * this provider's own writes) is a no-op; an unreadable document keeps the
   * last good snapshot and warns — a live hot-reload must never take the
   * process down. An invariant violation escaping the fan-out is not a reload
   * failure and propagates to the queue's error surface.
   */
  private async refresh(): Promise<void> {
    if (this.closed) return
    try {
      await this.reconcileFromDisk()
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'INVARIANT') throw error
      this.runtime.logger.warn('credentials-local: reload failed at %s; keeping the last good document', this.spec.filename)
      this.runtime.logger.warn(error)
    }
  }

  /**
   * Compare the on-disk text against the cache and publish any difference
   * into the seam. Absence publishes the empty store; an unreadable or
   * invalid document throws, so each caller picks its policy — a reload warns
   * and keeps the last good snapshot, a write fails loud rather than
   * overwriting a document it could not understand.
   */
  private async reconcileFromDisk(): Promise<void> {
    // Re-checked on every reload and before every write: an external editor or
    // a restored backup can loosen the mode after boot.
    await assertOwnerOnly(this.spec.filename)
    let text: string | undefined
    try {
      text = await readFile(this.spec.filename, 'utf8')
    } catch (error) {
      if (!isENOENT(error)) throw error
      text = undefined
    }
    if (text === this.text || this.isClosed()) return
    const next = text === undefined
      ? { refs: new Map<string, string>(), records: new Map<string, CredentialRecord>() }
      : parseCredentialsDocument(text, this.spec.filename)
    const changedRefs = this.changedRefs(this.values, next.refs)
    const changedRecords = this.changedRecords(this.records, next.records)
    this.text = text
    this.values = next.refs
    this.records = next.records
    for (const ref of changedRefs) this.runtime.referenceUpdated(ref)
    for (const key of changedRecords) this.runtime.recordUpdated(key)
  }
  /* jscpd:ignore-end */

  /** Entries whose stored value changed; the parser has already proven every key addressable. */
  private changedRefs(prev: Map<string, string>, next: Map<string, string>): CredentialRef[] {
    const changed: CredentialRef[] = []
    for (const key of new Set([...prev.keys(), ...next.keys()])) {
      if (prev.get(key) === next.get(key)) continue
      changed.push(credentialRef(key))
    }
    return changed
  }

  /** Records whose stored value changed; the parser has already proven every key addressable. */
  private changedRecords(
    prev: Map<string, CredentialRecord>,
    next: Map<string, CredentialRecord>,
  ): CredentialKey[] {
    const changed: CredentialKey[] = []
    for (const key of new Set([...prev.keys(), ...next.keys()])) {
      if (sameJsonValue(prev.get(key), next.get(key))) continue
      changed.push(parseCredentialKey(key))
    }
    return changed
  }
}
