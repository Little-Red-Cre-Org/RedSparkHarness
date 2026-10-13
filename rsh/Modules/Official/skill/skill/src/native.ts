/** Native Host Definition and Provider for scoped skill discovery and loading. */
import { NativeContributions, type NativeContext, type NativePlugin, type NativeScope } from '@deepseek-ai/dsh-native-runtime'
import {
  isSkillName,
  normalizeProviderObservation,
  toSummary,
  validateCandidate,
  validateDefinition,
  validateRuntimeSkill,
} from './shared.ts'
import type {
  SkillCandidate,
  SkillCatalogSnapshot,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
  SkillRegistration,
  SkillSummary,
} from './types.ts'
import type {} from '@deepseek-ai/dsh-native-runtime'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { skills: NativeSkills }
  interface NativeEvents {
    /**
     * Notify Native consumers that a scoped skill catalog may have changed.
     * @mode parallel
     * @dshScopeScan unsupported
     */
    'skills/change': { mode: 'parallel'; args: []; result: void }
  }
}

/** Lookup context for one dynamic Agent scope. */
export interface NativeSkillLookupOptions extends SkillLookupOptions {
  /** Agent scope whose local and ancestor skills are visible. */
  readonly scope: NativeScope
}

/** Native skill catalog and provider registration service. */
export interface NativeSkills {
  /**
   * Register one provider in a Native scope.
   * @param scope - registration scope within this Provider realm.
   * @param create - provider factory receiving its exact lifecycle and invalidation control.
   * @returns exact idempotent removal that aborts and drains this registration's provider work.
   */
  registerProvider(scope: NativeScope, create: (control: SkillProviderControl) => SkillProvider): () => Promise<void>
  /**
   * Register an in-memory skill in a Native scope.
   * @param scope - registration scope within this Provider realm.
   * @param skill - skill definition; omitted invocation and provider values receive the legacy defaults.
   * @returns exact idempotent removal of this skill.
   */
  register(scope: NativeScope, skill: SkillRegistration): () => Promise<void>
  /**
   * List sorted invocation-neutral summaries from the selected scope ancestry.
   * @param options - dynamic scope, optional workspace root, and cancellation.
   * @returns the current winning summaries.
   */
  list(options: NativeSkillLookupOptions): Promise<SkillSummary[]>
  /**
   * Observe the winning catalog and whether every provider completed against a stable registry revision.
   * @param options - dynamic scope, optional workspace root, and cancellation.
   * @returns the current summaries and completeness state.
   */
  snapshot(options: NativeSkillLookupOptions): Promise<SkillCatalogSnapshot>
  /**
   * Load the winning definition for one skill name.
   * @param name - kebab-case skill name.
   * @param options - dynamic scope, optional workspace root, and cancellation.
   * @returns the full definition, or `undefined` when no provider owns the name.
   */
  get(name: string, options: NativeSkillLookupOptions): Promise<SkillDefinition | undefined>
  /** Close provider admission and drain outstanding list and get operations. @returns completion of registry disposal. */
  dispose(): Promise<void>
}

interface ProviderEntry {
  readonly id: string
  readonly scope: NativeScope
  readonly provider: SkillProvider
  readonly order: number
  readonly controller: AbortController
  readonly pending: Set<Promise<void>>
  readonly unregister: () => void
  closed: boolean
  disposal?: Promise<void>
}

interface RuntimeEntry {
  readonly scope: NativeScope
  readonly definition: SkillDefinition
}

interface IndexedCandidate {
  readonly candidate: SkillCandidate
  readonly provider: SkillProvider
  readonly registration?: ProviderEntry
  readonly providerOrder: number
  readonly localOrder: number
  readonly runtime?: true
}

interface CollectResult {
  readonly entries: Map<string, IndexedCandidate>
  readonly complete: boolean
}

const RUNTIME_PROVIDER = 'runtime'
const RUNTIME_RANK = 250
const MAX_COLLECT_ATTEMPTS = 2

/** Native scope-aware registry; each selected provider remains pinned through its pending calls. */
export class NativeSkillRegistry implements NativeSkills {
  private readonly providers: NativeContributions<ProviderEntry>
  private readonly runtime: NativeContributions<RuntimeEntry>
  private readonly providerNames = new Map<NativeScope, Set<string>>()
  private readonly entries = new Set<ProviderEntry>()
  private readonly cache = new Map<string, Map<string, IndexedCandidate>>()
  private readonly pendingLookups = new Set<Promise<void>>()
  private readonly scopeIds = new WeakMap<NativeScope, number>()
  private nextProviderOrder = 0
  private nextProviderId = 0
  private nextScopeId = 1
  private revision = 0
  private closed = false
  private disposal: Promise<void> | undefined

  /**
   * @param root - Provider scope containing every skill contribution and lookup scope.
   * @param cacheEntries - maximum completed catalogs retained.
   * @param events - Host event dispatcher used for scoped catalog invalidation.
   */
  constructor(
    private readonly root: NativeScope,
    private readonly cacheEntries: number,
    private readonly events: NativeContext['events'],
  ) {
    this.providers = new NativeContributions(root)
    this.runtime = new NativeContributions(root)
    assertPositiveInteger('collectCacheMaxEntries', cacheEntries)
  }

  /** @inheritdoc */
  registerProvider(scope: NativeScope, create: (control: SkillProviderControl) => SkillProvider): () => Promise<void> {
    this.assertOpen()
    let entry: ProviderEntry | undefined
    const controller = new AbortController()
    const control: SkillProviderControl = {
      signal: controller.signal,
      invalidate: () => {
        if (entry !== undefined && !entry.closed && this.providers.visible(scope).get(entry.id) === entry) this.invalidate(scope)
      },
    }
    try {
      const provider = create(control)
      if (provider.name === RUNTIME_PROVIDER) throw new Error(`"${RUNTIME_PROVIDER}" is reserved for runtime skill registrations`)
      const names = this.providerNames.get(scope)
      if (names?.has(provider.name) === true) throw new Error(`a skill provider named "${provider.name}" is already registered in this scope`)
      const id = `provider:${this.nextProviderId}`
      const order = this.nextProviderOrder
      let remove = (): void => {}
      const exactEntry: ProviderEntry = {
        id, scope, provider, order, controller, pending: new Set(), unregister: () => { remove() }, closed: false,
      }
      entry = exactEntry
      remove = this.providers.register(id, exactEntry, scope)
      this.nextProviderId += 1
      this.nextProviderOrder += 1
      const layerNames = names ?? new Set<string>()
      layerNames.add(provider.name)
      this.providerNames.set(scope, layerNames)
      this.entries.add(exactEntry)
      this.invalidate(scope)
      let completion: Promise<void> | undefined
      return () => completion ??= this.closeProvider(exactEntry)
    } catch (error) {
      controller.abort(error)
      throw error
    }
  }

  /** @inheritdoc */
  register(scope: NativeScope, skill: SkillRegistration): () => Promise<void> {
    this.assertOpen()
    validateRuntimeSkill(skill)
    const existing = this.runtime.visible(scope).get(skill.name)
    if (existing?.scope === scope) {
      console.warn(`runtime skill "${skill.name}" ignored because it is already registered`)
      return () => Promise.resolve()
    }
    const definition: SkillDefinition = {
      ...skill,
      invocation: skill.invocation ?? { modelInvocable: true, userInvocable: true },
      provider: skill.provider ?? RUNTIME_PROVIDER,
    }
    const entry = { scope, definition }
    const unregister = this.runtime.register(skill.name, entry, scope)
    this.invalidate(scope)
    let completion: Promise<void> | undefined
    return () => completion ??= Promise.resolve().then(() => {
      unregister()
      this.invalidate(scope)
    })
  }

  /** @inheritdoc */
  list(options: NativeSkillLookupOptions): Promise<SkillSummary[]> {
    return this.withLookup(async () => (await this.snapshotInternal(options)).skills)
  }

  /** @inheritdoc */
  snapshot(options: NativeSkillLookupOptions): Promise<SkillCatalogSnapshot> {
    return this.withLookup(() => this.snapshotInternal(options))
  }

  private async snapshotInternal(options: NativeSkillLookupOptions): Promise<SkillCatalogSnapshot> {
    const collected = await this.collect(options)
    return {
      skills: [...collected.entries.values()]
        .map(entry => toSummary(entry.candidate))
        .sort((left, right) => compareText(left.name, right.name)),
      complete: collected.complete,
    }
  }

  /** @inheritdoc */
  get(name: string, options: NativeSkillLookupOptions): Promise<SkillDefinition | undefined> {
    return this.withLookup(async () => {
      if (!isSkillName(name)) return undefined
      const collected = await this.collect(options)
      options.signal?.throwIfAborted()
      const entry = collected.entries.get(name)
      if (entry === undefined) return undefined
      let definition: SkillDefinition | undefined
      if (entry.runtime === true) definition = entry.candidate.locator as SkillDefinition
      else {
        const registration = entry.registration
        if (registration === undefined) return undefined
        definition = await this.runProvider(registration, options.signal,
          signal => registration.provider.get(entry.candidate, { ...options, signal }))
      }
      options.signal?.throwIfAborted()
      if (definition === undefined) return undefined
      validateDefinition(definition)
      if (definition.name !== entry.candidate.name) {
        if (entry.registration !== undefined) this.invalidate(entry.registration.scope)
        return undefined
      }
      return definition
    })
  }

  /** @inheritdoc */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.closed = true
    const entries = [...this.entries]
    this.cache.clear()
    return this.disposal = Promise.all([
      ...entries.map(entry => this.closeProvider(entry)),
      ...this.pendingLookups,
    ]).then(() => {
      this.providers.clear()
      this.runtime.clear()
      this.providerNames.clear()
    })
  }

  private async collect(options: NativeSkillLookupOptions): Promise<CollectResult> {
    this.assertOpen()
    this.providers.visible(options.scope)
    options.signal?.throwIfAborted()
    let attempt = 0
    while (true) {
      const revision = this.revision
      const key = this.cacheKey(options, revision)
      const cached = this.cache.get(key)
      if (cached !== undefined) return { entries: cached, complete: true }
      const result = await this.collectFresh(options)
      options.signal?.throwIfAborted()
      if (revision !== this.revision) {
        attempt += 1
        if (attempt < MAX_COLLECT_ATTEMPTS) continue
        return { ...result, complete: false }
      }
      if (result.complete) {
        this.cache.set(key, result.entries)
        if (this.cache.size > this.cacheEntries) {
          const oldest = this.cache.keys().next() as IteratorYieldResult<string>
          this.cache.delete(oldest.value)
        }
      }
      return result
    }
  }

  private async collectFresh(options: NativeSkillLookupOptions): Promise<CollectResult> {
    const chain = this.scopeChain(options.scope)
    const visibleProviders = [...this.providers.visible(options.scope).values()]
    const visibleRuntime = this.runtime.visible(options.scope)
    const merged = new Map<string, IndexedCandidate>()
    let complete = true
    for (const scope of chain) {
      const candidates: IndexedCandidate[] = []
      let localOrder = 0
      for (const entry of visibleRuntime.values()) {
        if (entry.scope !== scope) continue
        candidates.push({
          candidate: runtimeCandidate(entry.definition), provider: RUNTIME_SKILL_PROVIDER,
          providerOrder: -1, localOrder, runtime: true,
        })
        localOrder += 1
      }
      for (const entry of visibleProviders) {
        if (entry.scope !== scope || entry.closed) continue
        let output: readonly SkillCandidate[] | { readonly candidates: readonly SkillCandidate[]; readonly complete: boolean } | undefined
        try {
          output = await this.runProvider(entry, options.signal, signal => entry.provider.list({ ...options, signal }))
        } catch (error: unknown) {
          if (options.signal?.aborted === true) throw toError(options.signal.reason)
          if (!entry.controller.signal.aborted) console.warn(`skill provider "${entry.provider.name}" skipped: ${errorMessage(error)}`)
          complete = false
        }
        if (output === undefined) continue
        const observation = normalizeProviderObservation(output, entry.provider.name)
        if (!observation.complete) complete = false
        let providerLocalOrder = 0
        for (const candidate of observation.candidates) {
          validateCandidate(candidate, entry.provider.name)
          candidates.push({
            candidate, provider: entry.provider, registration: entry,
            providerOrder: entry.order, localOrder: providerLocalOrder,
          })
          providerLocalOrder += 1
        }
      }
      candidates.sort(compareCandidates)
      const seen = new Set<string>()
      for (const candidate of candidates) {
        if (seen.has(candidate.candidate.name)) {
          console.warn(`skill "${candidate.candidate.name}" from ${candidate.candidate.source} ignored because a higher-priority skill already exists`)
          continue
        }
        seen.add(candidate.candidate.name)
        merged.set(candidate.candidate.name, candidate)
      }
    }
    return { entries: merged, complete }
  }

  private runProvider<Result>(
    entry: ProviderEntry,
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> {
    if (entry.closed || this.closed) return Promise.reject(new Error(`skill provider "${entry.provider.name}" is disposed`))
    const completion = Promise.withResolvers<void>()
    entry.pending.add(completion.promise)
    const combined = signal === undefined ? entry.controller.signal : AbortSignal.any([signal, entry.controller.signal])
    const work = Promise.resolve().then(() => operation(combined))
    const finish = (): void => {
      entry.pending.delete(completion.promise)
      completion.resolve()
    }
    void work.then(finish, finish)
    return waitWithAbort(work, combined)
  }

  private async closeProvider(entry: ProviderEntry): Promise<void> {
    if (entry.disposal !== undefined) {
      await entry.disposal
      return
    }
    entry.closed = true
    entry.unregister()
    entry.controller.abort(new Error(`skill provider "${entry.provider.name}" disposed`))
    const names = this.providerNames.get(entry.scope)
    names?.delete(entry.provider.name)
    if (names?.size === 0) this.providerNames.delete(entry.scope)
    this.invalidate(entry.scope)
    const disposal = Promise.allSettled([...entry.pending]).then(() => { this.entries.delete(entry) })
    entry.disposal = disposal
    await disposal
  }

  private scopeChain(scope: NativeScope): NativeScope[] {
    const chain: NativeScope[] = []
    for (let current: NativeScope | undefined = scope; current !== undefined; current = current.parent) {
      chain.push(current)
      if (current === this.root) return chain.reverse()
    }
    throw new Error('native-runtime: contribution scope is outside the Provider realm')
  }

  private cacheKey(options: NativeSkillLookupOptions, revision: number): string {
    return JSON.stringify({
      cwd: options.cwd,
      scopes: this.scopeChain(options.scope).map(scope => this.scopeId(scope)),
      revision,
    })
  }

  private scopeId(scope: NativeScope): number {
    let id = this.scopeIds.get(scope)
    if (id === undefined) {
      id = this.nextScopeId
      this.nextScopeId += 1
      this.scopeIds.set(scope, id)
    }
    return id
  }

  private invalidate(scope: NativeScope): void {
    this.revision += 1
    this.cache.clear()
    void this.events.parallel(scope, 'skills/change').catch((error: unknown) => {
      console.warn(`skills/change listener rejected: ${errorMessage(error)}`)
    })
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('skill: registry is disposed')
  }

  private withLookup<Result>(operation: () => Promise<Result>): Promise<Result> {
    this.assertOpen()
    const completion = Promise.withResolvers<void>()
    this.pendingLookups.add(completion.promise)
    const work = Promise.resolve().then(operation)
    const finish = (): void => {
      this.pendingLookups.delete(completion.promise)
      completion.resolve()
    }
    void work.then(finish, finish)
    return work
  }
}

/** Native Host Definition for the scoped skill registry. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-skill',
  targets: ['host'],
  requires: [],
  provides: ['skills'],
  resolve(input) {
    const cacheEntries = resolveCacheEntries(input)
    return (context: NativeContext) => {
      const registry = new NativeSkillRegistry(context.scope, cacheEntries, context.events)
      context.own(() => registry.dispose())
      context.provide('skills', registry)
    }
  },
}

const RUNTIME_SKILL_PROVIDER: SkillProvider = {
  name: RUNTIME_PROVIDER,
  list: () => Promise.resolve([]),
  get: candidate => Promise.resolve(candidate.locator as SkillDefinition),
}

function runtimeCandidate(skill: SkillDefinition): SkillCandidate {
  return {
    name: skill.name,
    description: skill.description,
    ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
    invocation: skill.invocation,
    source: skill.source,
    provider: skill.provider,
    ...skill.resourceBase === undefined ? {} : { resourceBase: skill.resourceBase },
    rank: RUNTIME_RANK,
    locator: skill,
    ...skill.path === undefined ? {} : { path: skill.path },
    ...skill.metadata === undefined ? {} : { metadata: skill.metadata },
  }
}

function compareCandidates(left: IndexedCandidate, right: IndexedCandidate): number {
  return left.candidate.rank - right.candidate.rank
    || left.providerOrder - right.providerOrder
    || left.localOrder - right.localOrder
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`skill: ${name} must be an integer greater than or equal to 1`)
}

function resolveCacheEntries(input: unknown): number {
  if (input === undefined) return 128
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('skill: configuration must be an object')
  const fields = input as Record<string, unknown>
  if (Object.keys(fields).some(key => key !== 'collectCacheMaxEntries')) throw new Error('skill: unknown configuration field')
  const value = fields.collectCacheMaxEntries === undefined ? 128 : fields.collectCacheMaxEntries
  if (typeof value !== 'number') throw new Error('skill: collectCacheMaxEntries must be an integer greater than or equal to 1')
  assertPositiveInteger('collectCacheMaxEntries', value)
  return value
}

function waitWithAbort<Result>(work: Promise<Result>, signal: AbortSignal): Promise<Result> {
  if (signal.aborted) return Promise.reject(toError(signal.reason))
  return new Promise((resolve, reject) => {
    const cleanup = (): void => { signal.removeEventListener('abort', onAbort) }
    const onAbort = (): void => { cleanup(); reject(toError(signal.reason)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void work.then((value) => { cleanup(); resolve(value) }, (error: unknown) => { cleanup(); reject(toError(error)) })
  })
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(errorMessage(error))
}

function errorMessage(error: unknown): string {
  try { return String(error) } catch { return '[unrenderable thrown value]' }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
