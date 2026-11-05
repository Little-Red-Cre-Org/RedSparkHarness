/**
 * Transport-free settings state shared by the Cordis and Native browser halves.
 *
 * The Cordis build reaches the Host through `ctx.remote.settings`; a Native
 * client reaches the same Host through `clientNativeSession`. Both transports
 * answer the same two facts — one document of namespace views, and one
 * revision-fenced write — so the read fold, the write queue and the per-scope
 * derivation live here once, and each build supplies only
 * {@link SettingsDescribeFetch} and {@link SettingsMutate}.
 *
 * Nothing in this module may reference Cordis: both halves import it at
 * runtime.
 */

import { createSnapshotStore, type SnapshotStore } from '@redspark/rsh-client-store'
import type { JsonValue } from '@redspark/rsh-util-values'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import type {
  SettingsPathOpView, SettingsScope, SettingsScopeSnapshot, SettingsScopeSpec,
} from './settings-contract.ts'

/** One namespace description as far as a scope derives from it. */
export interface SettingsNamespaceFacts {
  /** Settings namespace identity. */
  readonly ns: string
  /** Serialized owner schema. */
  readonly schema: unknown
  /** Resolved section value. */
  readonly value: unknown
  /** Composition layer the Host resolved {@link value} over. */
  readonly base?: unknown
  /** Stored user layer, whose presence marks an override. */
  readonly user?: unknown
  /** Namespace revision fencing the next write. */
  readonly revision: number
}

/** The whole settings document as the mirror holds it. */
export interface SettingsMirrorFacts<Namespace extends SettingsNamespaceFacts> {
  /** Every namespace the Host reported, in Host order. */
  readonly namespaces: readonly Namespace[]
  /** Whether the Host accepts writes. */
  readonly writable: boolean
  /** Whether the Host has a local settings document it can open. */
  readonly hasDocument: boolean
}

/** Mirror state every derived settings surface renders from. */
export interface SettingsMirrorSnapshot<Namespace extends SettingsNamespaceFacts> {
  /**
   * `unavailable` is the terminal state of a transport that never syncs;
   * `ready` persists across later failed refreshes (the held view keeps
   * serving); `idle` means no answer is held and no read is running.
   */
  readonly status: 'idle' | 'loading' | 'ready' | 'unavailable'
  /** The last good answer; undefined until the first success. */
  readonly view: SettingsMirrorFacts<Namespace> | undefined
  /** The latest refresh failure message, cleared by the next success. */
  readonly error: string | null
}

/** One refresh outcome, already reduced from the transport's own error channel. */
export type SettingsDescribeAnswer<Namespace extends SettingsNamespaceFacts> =
  | { readonly view: SettingsMirrorFacts<Namespace> }
  | { readonly failure: string }

/** The one Host document read a settings client performs. */
export type SettingsDescribeFetch<Namespace extends SettingsNamespaceFacts> =
  () => Promise<SettingsDescribeAnswer<Namespace>>

/**
 * One revision-fenced namespace write.
 * @param namespace - registered Settings namespace the scope derives from.
 * @param ops - path-addressed edits already copied by the caller.
 * @param expectedRevision - revision the caller observed, or undefined before the first read.
 * @returns the accepted namespace view.
 * @throws when the Host refuses the write or the transport fails.
 */
export type SettingsMutate<Namespace extends SettingsNamespaceFacts> =
  (namespace: string, ops: readonly SettingsPathOpView[], expectedRevision: number | undefined) => Promise<Namespace>

/** The mirror face every derived settings surface consumes. */
export interface SettingsDescribeFaceOf<Namespace extends SettingsNamespaceFacts> {
  /** @returns the current sync snapshot (stable reference until the next change). */
  getSnapshot(): SettingsMirrorSnapshot<Namespace>
  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each snapshot change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void
  /**
   * Resolve once an answer is held (or the mirror is terminally unavailable),
   * reading only from `idle`.
   * @returns settlement of the current or newly started read, if any.
   */
  ensure(): Promise<void>
  /**
   * Fold one write answer's namespace view into the held view without a wire
   * read, invalidating any older read still in flight.
   * @param view - the namespace view a settings write answered with.
   */
  acceptView(view: Namespace): void
}

/**
 * Serializes every Host describe read behind one snapshot store. Concurrent
 * {@link SettingsMirrorEngine.load} calls fold into the in-flight read plus one
 * rerun, so an invalidation arriving mid-read is never lost and never
 * duplicated.
 */
export class SettingsMirrorEngine<Namespace extends SettingsNamespaceFacts = SettingsNamespaceFacts>
implements SettingsDescribeFaceOf<Namespace> {
  private readonly store: SnapshotStore<SettingsMirrorSnapshot<Namespace>>
  private inFlight: Promise<void> | undefined
  private rerun = false
  private generation = 0
  private readonly enabled: boolean

  /**
   * @param fetch - the transport's document read.
   * @param persistence - whether this page syncs with the Host document or keeps preferences process-local.
   */
  constructor(
    private readonly fetch: SettingsDescribeFetch<Namespace>,
    persistence: 'host' | 'memory' = 'host',
  ) {
    this.enabled = persistence === 'host'
    this.store = createSnapshotStore<SettingsMirrorSnapshot<Namespace>>({
      status: persistence === 'host' ? 'idle' : 'unavailable',
      view: undefined,
      error: null,
    })
  }

  /** @returns the current sync snapshot (stable reference until the next change). */
  getSnapshot(): SettingsMirrorSnapshot<Namespace> {
    return this.store.getSnapshot()
  }

  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each snapshot change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  /**
   * Refresh from the Host. A call during an in-flight read marks one rerun
   * after it settles instead of racing a second read.
   * @returns settlement after this call's freshness is reflected.
   */
  load(): Promise<void> {
    if (!this.enabled) return Promise.resolve()
    if (this.inFlight !== undefined) {
      this.rerun = true
      return this.inFlight
    }
    // Own the slot before the loading publication can synchronously reenter load().
    const run = Promise.resolve().then(() => this.run())
    this.inFlight = run
    return run
  }

  /**
   * Resolve once an answer is held (or the mirror is terminally unavailable),
   * reading only from `idle`. The cheap idempotent entry for surfaces that
   * render on first use.
   * @returns settlement of the current or newly started read, if any.
   */
  ensure(): Promise<void> {
    if (!this.enabled) return Promise.resolve()
    if (this.inFlight !== undefined) return this.inFlight
    if (this.getSnapshot().status === 'idle') return this.load()
    return Promise.resolve()
  }

  /**
   * Fold one write answer's namespace view into the held view without a read,
   * and invalidate any read still in flight. With no held document, the answer
   * is not published as a partial document; an in-flight read reruns so it
   * cannot publish a document fetched before the write committed.
   * @param view - the namespace view a settings write answered with.
   */
  acceptView(view: Namespace): void {
    const before = this.store.getSnapshot()
    this.generation += 1
    if (this.inFlight !== undefined) this.rerun = true
    if (before.view === undefined) return
    const namespaces = before.view.namespaces.some(row => row.ns === view.ns)
      ? before.view.namespaces.map(row => row.ns === view.ns ? view : row)
      : [...before.view.namespaces, view]
    this.store.set({ ...before, view: { ...before.view, namespaces } })
  }

  /**
   * Convenience row lookup on the held view.
   * @param ns - namespace identity.
   * @returns the namespace view, or undefined while unanswered or unregistered.
   */
  namespace(ns: string): Namespace | undefined {
    return this.store.getSnapshot().view?.namespaces.find(row => row.ns === ns)
  }

  private async run(): Promise<void> {
    // The in-flight slot must clear in the same synchronous segment that
    // observes `rerun` false (and on abrupt exit): a `.finally()` on the
    // returned promise runs one microtask later, and a `load()` landing in
    // that gap would mark a rerun nobody reads, losing the read.
    try {
      do {
        const before = this.store.getSnapshot()
        if (before.status === 'idle') this.store.set({ ...before, status: 'loading' })
        // Cleared immediately before the read goes out: a load() marked earlier
        // (including one reentering from the loading publish above) is covered
        // by this very read, while one landing after needs the rerun.
        this.rerun = false
        const generation = ++this.generation
        let outcome: SettingsDescribeAnswer<Namespace>
        try {
          outcome = await this.fetch()
        } catch (error) {
          outcome = { failure: error instanceof Error ? error.message : String(error) }
        }
        // A write answer invalidates a document read before that write committed.
        if (generation !== this.generation) continue
        if ('view' in outcome) {
          this.store.set({ status: 'ready', view: outcome.view, error: null })
        } else {
          const held = this.store.getSnapshot()
          // No answer yet: fall back to idle so `ensure` retries; with one, the
          // held view keeps serving and only the error field reports the miss.
          this.store.set({
            status: held.view === undefined ? 'idle' : 'ready',
            view: held.view,
            error: outcome.failure,
          })
        }
      // load() and mutate() set rerun from outside this function while the read is in flight.
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- cross-method write during await.
      } while (this.rerun)
    } finally {
      this.inFlight = undefined
    }
  }
}

/**
 * One namespace's derived view over a shared mirror, plus that namespace's
 * serialized writes. Writes carry the latest known namespace revision, fold
 * their answers back into the mirror, and teardown waits for the operation
 * already crossing the transport.
 */
export class SettingsScopeEngine<T, Namespace extends SettingsNamespaceFacts = SettingsNamespaceFacts>
implements SettingsScope<T> {
  private readonly store: SnapshotStore<SettingsScopeSnapshot<T>>
  private tail: Promise<void> = Promise.resolve()
  private writeGeneration = 0
  private disposed = false
  private readonly unsubscribe: (() => void) | undefined
  /**
   * Revision answered by a superseded write still ahead of the mirror: the
   * mirror only folds the LATEST settlement in, so a queued successor takes
   * its fence from here first.
   */
  private pendingRevision: number | undefined

  /**
   * @param spec - namespace identity and optional narrowing decoder.
   * @param mirror - the shared describe mirror this scope derives from.
   * @param persistence - whether this page syncs with the Host document or keeps preferences process-local.
   * @param schema - settings-owned schema operations.
   * @param write - the transport's revision-fenced namespace write.
   */
  constructor(
    private readonly spec: SettingsScopeSpec<T>,
    private readonly mirror: SettingsMirrorEngine<Namespace>,
    private readonly persistence: 'host' | 'memory',
    private readonly schema: SettingsSchemaOperations,
    private readonly write: SettingsMutate<Namespace>,
  ) {
    this.store = createSnapshotStore<SettingsScopeSnapshot<T>>({
      status: persistence === 'host' ? 'loading' : 'unavailable',
      value: undefined,
      base: undefined,
      user: undefined,
      revision: undefined,
      writable: false,
      mode: persistence,
    })
    if (persistence === 'host') {
      this.unsubscribe = mirror.subscribe(() => { this.derive() })
      this.derive()
    }
  }

  /** @returns the current sync snapshot (stable reference until the next change). */
  getSnapshot(): SettingsScopeSnapshot<T> {
    return this.store.getSnapshot()
  }

  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each snapshot change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  /**
   * Queue one field write; see {@link SettingsScope.set} for the ordering,
   * revision, and recovery contract.
   * @param field - scalar field inside the namespace section.
   * @param value - JSON-shaped value selected by the user.
   * @returns settlement after the write and any latest-write recovery read.
   */
  set(field: string, value: unknown): Promise<void> {
    return this.mutate([{ op: 'set', path: [field], value: value as JsonValue }])
  }

  /**
   * Queue one field clear; see {@link SettingsScope.unset} for the ordering,
   * revision, and recovery contract.
   * @param field - scalar field inside the namespace section.
   * @returns settlement after the clear and any latest-write recovery read.
   */
  unset(field: string): Promise<void> {
    return this.mutate([{ op: 'unset', path: [field] }])
  }

  /**
   * Queue one atomic namespace mutation; see {@link SettingsScope.mutate}.
   * @param ops - ordered field operations copied when queued.
   * @param expectedRevision - optional fixed revision read by the domain editor.
   * @returns settlement after the mutation and any latest-write recovery read.
   */
  mutate(ops: readonly SettingsPathOpView[], expectedRevision?: number): Promise<void> {
    const ownedOps = structuredClone(ops) as SettingsPathOpView[]
    const generation = ++this.writeGeneration
    return this.enqueue(async () => {
      const revision = expectedRevision ?? this.pendingRevision ?? this.getSnapshot().revision
      let accepted: Namespace | undefined
      try {
        accepted = await this.write(this.spec.namespace, ownedOps, revision)
      } catch {
        // A refused or failed write is reported by the following recovery read,
        // which republishes the Host's actual state.
        accepted = undefined
      }
      if (accepted === undefined) {
        await this.recover(generation)
        return
      }
      if (this.disposed) return
      if (generation === this.writeGeneration) {
        this.pendingRevision = undefined
        this.mirror.acceptView(accepted)
      } else {
        this.pendingRevision = accepted.revision
      }
    })
  }

  /** Reload Host state for the latest failed write; superseded failures leave recovery to it. */
  private async recover(generation: number): Promise<void> {
    if (this.disposed || generation !== this.writeGeneration) return
    this.pendingRevision = undefined
    await this.mirror.load()
  }

  /**
   * Stop queued operations, stop deriving, and wait for the current write to
   * settle.
   * @returns settlement after the controller reaches quiescence.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    this.writeGeneration += 1
    this.unsubscribe?.()
    await this.tail
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    if (this.persistence === 'memory' || this.disposed) return Promise.resolve()
    const task = this.tail.then(async () => {
      if (this.disposed) return
      await operation()
    })
    // The returned task carries its own settlement to the caller; the queue
    // tail is kept fulfilled so one failed subscriber cannot strand later operations.
    this.tail = task.catch(() => {})
    return task
  }

  private derive(): void {
    if (this.disposed) return
    const mirrored = this.mirror.getSnapshot()
    if (mirrored.view === undefined) return
    const { writable } = mirrored.view
    const view = mirrored.view.namespaces.find(candidate => candidate.ns === this.spec.namespace)
    if (view === undefined) {
      this.store.update((draft) => {
        draft.status = 'unavailable'
        draft.writable = writable
      })
      return
    }
    const decoded = this.decode(view)
    this.store.update((draft) => {
      draft.revision = view.revision
      draft.base = view.base
      draft.user = view.user
      draft.writable = writable
      if (decoded === undefined) return
      draft.status = 'ready'
      draft.value = decoded
    })
  }

  private decode(view: Namespace): T | undefined {
    if (this.spec.decode !== undefined) return this.spec.decode(view.value)
    // Sections are plain objects by construction; schemastery alone would
    // resolve null or an array through object defaults instead of refusing.
    if (typeof view.value !== 'object' || view.value === null || Array.isArray(view.value)) return undefined
    let failure: string | undefined
    try {
      failure = this.schema.validate(this.schema.rehydrate(view.schema), view.value)
    } catch (_malformedSchemaEnvelope) {
      // A schema envelope this client cannot rehydrate vouches for no section;
      // the value is treated exactly like a schema-invalid one.
      return undefined
    }
    return failure === undefined ? view.value as T : undefined
  }
}
