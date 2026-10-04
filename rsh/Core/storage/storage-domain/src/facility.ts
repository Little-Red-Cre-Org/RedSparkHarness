/** Shared domain facility preserves schema validation, exact backend units and the existing write-chain runtime. */
import type { BackendRegistry } from '@deepseek-ai/dsh-storage/backend'
import { DomainError } from './error.ts'
import { descriptorOf, type DomainSpec } from './spec.ts'
import { DomainImpl, type Domain, type DomainRuntimeEffects } from './domain.ts'

/** Explicit default medium and per-domain route overrides. */
export interface DomainFacilityConfiguration {
  readonly backend: string
  readonly routes?: Readonly<Record<string, string>>
}

/** Facility diagnostics extend the same per-domain post-durability observer. */
export interface DomainFacilityEffects extends DomainRuntimeEffects {
  /** Report a backed-up invalid record. @param message - durable backup location and schema failure. */
  error(message: string): void
}

/**
 * The mounted domain facility. Opens declared domains over routed backends;
 * one facility instance owns the open-domain table and enforces single-open
 * per domain name.
 */
export class DomainFacilityCore {
  private readonly domains = new Map<string, DomainImpl>()
  /** Names reserved by an in-flight or completed open, so concurrent opens of one name fail loud. */
  private readonly reserved = new Set<string>()
  private readonly opening = new Set<Promise<unknown>>()
  private stopping = false
  private disposal: Promise<void> | undefined
  private readonly cleanupFailures: unknown[] = []

  /**
   * @param backends - selected named backend registry.
   * @param effects - durable change notifications and concrete observer/schema failure reporting.
   * @param config - Validated plugin config.
   * @param lifetime - optional native Provider cancellation; compatibility ownership closes the facility directly.
   */
  constructor(
    private readonly backends: BackendRegistry,
    private readonly effects: DomainFacilityEffects,
    private readonly config: DomainFacilityConfiguration,
    private readonly lifetime?: AbortSignal,
  ) {}

  private resolveBackend(name: string): string {
    const route = this.config.routes?.[name]
    return route === undefined ? this.config.backend : route
  }

  /**
   * Open one declared domain. Steps, each failing the whole call: reject a
   * name that is already open (`already-open`); resolve the backend route
   * (`backend-not-found` passes through from the hub); require its `kv` facet
   * (`facet-unsupported`); open the unit projected from the spec (backend
   * `version-mismatch`/`malformed-medium` pass through); load and validate
   * every stored record against the spec's zod schemas (`invalid-record`
   * with the offending table and key — unless the spec declares
   * `invalidRecords: 'backup-and-skip'` and the unit can move documents aside, in
   * which case the failing record is backed up, logged, and skipped);
   * construct the domain.
   *
   * Lifecycle: the CALLER owns the returned handle and closes it via
   * `Domain.close()` (typically as its own `ctx.effect` disposer) — the
   * facility does not tie the domain to any consumer fiber. Domains still
   * open when the facility unmounts are closed by the plugin disposer.
   * @param spec - The domain declaration, typically from `defineDomain`.
   * @returns the opened domain handle, typed by the spec.
   */
  async open<S extends DomainSpec>(spec: S): Promise<Domain<S>> {
    if (this.stopping) throw new DomainError('closed', 'domain facility is closing')
    this.lifetime?.throwIfAborted()
    const task = this.openDomain(spec)
    this.opening.add(task)
    const settled = (): void => { this.opening.delete(task) }
    void task.then(settled, settled)
    return task
  }

  private async openDomain<S extends DomainSpec>(spec: S): Promise<Domain<S>> {
    if (this.reserved.has(spec.name)) {
      throw new DomainError('already-open', `domain '${spec.name}' is already open`)
    }
    this.reserved.add(spec.name)
    try {
      const backendName = this.resolveBackend(spec.name)
      const backend = this.backends.get(backendName)
      if (!backend.kv) {
        throw new DomainError(
          'facet-unsupported',
          `backend '${backendName}' routed for domain '${spec.name}' has no kv facet`,
        )
      }
      const unit = await backend.kv.open(descriptorOf(spec))
      try {
        const snapshot = await unit.loadAll()
        const tables = new Map<string, Map<string, unknown>>()
        for (const [table, tableSpec] of Object.entries(spec.tables)) {
          const records = new Map<string, unknown>()
          for (const [key, raw] of Object.entries(snapshot.tables[table] ?? {})) {
            let parsed: unknown
            try {
              parsed = parseRecord(spec.name, table, key, () => tableSpec.valueSchema.parse(raw))
            } catch (error) {
              // Backup-and-skip policy (disposable derived data): move the record's
              // document aside, log the concrete failure, and open without the
              // record. Backends that cannot move a document keep the loud path.
              if (spec.invalidRecords !== 'backup-and-skip' || unit.backupRecord === undefined) throw error
              const moved = await unit.backupRecord(table, key)
              // parseRecord always wraps the zod failure as the cause.
              this.effects.error(
                `domain '${spec.name}': stored record '${key}' in table '${table}' failed schema validation; `
                + `moved to '${moved}' and treated as absent. Cause: ${String((error as DomainError).cause)}`,
              )
              continue
            }
            records.set(key, parsed)
          }
          tables.set(table, records)
        }
        // A null stored global means "never written": serve `initial` without
        // materializing it — the first `set` writes.
        const globalSpec = spec.global
        const globalValue = globalSpec === undefined
          ? undefined
          : snapshot.global === null
            ? globalSpec.initial
            : parseRecord(spec.name, '', '', () => globalSpec.schema.parse(snapshot.global))
        if (this.stopping) throw new DomainError('closed', 'domain facility closed during its accepted open')
        this.lifetime?.throwIfAborted()
        // The onClosed hook runs strictly after teardown completes: writes
        // landing during the drain still emit domain/changed, and the domain
        // stays resolvable (the package invariant cross-checks each event)
        // until fully closed — only then does the name free up for reopening.
        const domain: DomainImpl = new DomainImpl(this.effects, spec, unit, tables, globalValue, () => {
          this.domains.delete(spec.name)
          this.reserved.delete(spec.name)
        })
        this.domains.set(spec.name, domain)
        // The single type-erasure point: DomainImpl is the untyped runtime,
        // Domain<S> the spec-typed view; the unknown hop is required because
        // S's conditional global-handle type stays unresolved here.
        return domain as unknown as Domain<S>
      } catch (error) {
        try { await unit.close() } catch (cleanup: unknown) {
          this.cleanupFailures.push(cleanup)
          throw new AggregateError([error, cleanup], 'Domain open and unit cleanup failed')
        }
        throw error
      }
    } catch (error) {
      // Any failure means the domain never registered (nothing can throw
      // after it), so releasing the name reservation is unconditional.
      this.reserved.delete(spec.name)
      throw error
    }
  }

  /**
   * Look up an open domain by name, untyped. Diagnostic surface (the package
   * invariant cross-checks change events against live domain state); typed
   * consumers hold the handle returned by {@link open}.
   * @param name - Domain name.
   * @returns the open domain runtime, or `undefined` when not open.
   */
  get(name: string): DomainImpl | undefined {
    return this.domains.get(name)
  }

  /**
   * Close every domain still open on this facility. The unmount path for
   * consumers that never called `Domain.close()` themselves; closing is
   * idempotent, so double-closing an already-closed domain is harmless.
   * @returns resolution after every unit cleanup is attempted; rejects with actual cleanup failures, including failed opens.
   */
  closeAll(): Promise<void> {
    this.stopping = true
    return this.disposal ??= (async () => {
      await Promise.allSettled([...this.opening])
      const results = await Promise.allSettled([...this.domains.values()].map(domain => domain.close()))
      const failures = [...this.cleanupFailures,
        ...results.filter(result => result.status === 'rejected').map(result => result.reason as unknown)]
      if (failures.length > 0) throw new AggregateError(failures, 'Domain facility cleanup failed')
    })()
  }
}

/** Run one zod parse, translating failure to `invalid-record` with its location. */
function parseRecord<T>(domain: string, table: string, key: string, parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    const slot = table === '' ? 'global' : `record '${key}' in table '${table}'`
    throw new DomainError(
      'invalid-record',
      `domain '${domain}': stored ${slot} does not match its schema`,
      { detail: { table, key }, cause: error },
    )
  }
}
