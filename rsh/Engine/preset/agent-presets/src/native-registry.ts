/** Exact standing generations with cancellation-before-drain on removal. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type { NativeAgentPresetOperations, NativeAgentPresetLease, NativePresetComposition,
  NativePresetGeneration, NativeResolvedAgentPreset } from './native-definition.ts'
import type { NativeAgentPresetFacts } from './selection.ts'
import type { NativePresetFolderSummary } from './native-storage.ts'
import { copyNativePreset, deleteNativePreset, nativePresetDirectory, nativePresetFolder,
  NativeAgentPresetError, readNativePresetComposition, scanNativePresetFolders } from './native-storage.ts'
import type { PresetRoot } from './preset.ts'
import { PRESET_ID } from './preset.ts'
import type { NativeAgentPresetDocument } from './native-definition.ts'

interface Standing {
  readonly preset: NativeResolvedAgentPreset
  readonly controller: AbortController
  readonly leases: Set<object>
  readonly drained: PromiseWithResolvers<void>
  readonly cleanupFailures: unknown[]
  closing: boolean
  release: () => Promise<void>
}

/** Profile registry; Module unloading cancels dependent Agent epochs before releasing scoped resources. */
export class NativeAgentPresetRegistry implements NativeAgentPresetOperations {
  private readonly standings = new Map<string, Standing>()
  private readonly ownedStandings = new Set<Standing>()
  private stopped = false
  private disposal: Promise<void> | undefined

  /**
   * @param defaultPreset - fresh creation default.
   * @param scope - shared Core Provider ancestry of every standing composition.
   * @param folders - CLI-discovered preset folders.
   */
  constructor(private readonly defaultPreset: string, private readonly scope: NativeScope,
    private readonly folders: readonly NativePresetFolderSummary[] = [],
    private readonly roots: readonly PresetRoot[] = []) {}

  /** @inheritdoc */
  register(composition: NativePresetComposition): () => Promise<void> {
    this.assertAvailable()
    if (!this.scope.contains(composition.scope)) throw new Error('agent-presets: standing scope is outside the Registry ancestry')
    if (this.standings.has(composition.id)) throw new Error(`agent-presets: duplicate standing preset ${composition.id}`)
    const preset: NativeResolvedAgentPreset = Object.freeze({ ...composition,
      generation: brandString<NativePresetGeneration>(globalThis.crypto.randomUUID()) })
    const controller = new AbortController()
    const drained = Promise.withResolvers<void>()
    const standing: Standing = { preset, controller, drained, cleanupFailures: [], leases: new Set(), closing: false, release: () => {
      if (!standing.closing) {
        standing.closing = true
        if (this.standings.get(preset.id) === standing) this.standings.delete(preset.id)
        controller.abort(new Error(`agent-presets: standing preset ${preset.id} removed`))
        if (standing.leases.size === 0) drained.resolve()
      }
      return drained.promise.then(() => {
        if (standing.cleanupFailures.length > 0) throw new AggregateError(standing.cleanupFailures,
          `agent-presets: standing preset ${preset.id} cleanup failed`)
      })
    } }
    this.standings.set(preset.id, standing)
    this.ownedStandings.add(standing)
    void drained.promise.then(() => this.ownedStandings.delete(standing))
    return standing.release
  }

  /** @inheritdoc */
  list(): readonly NativeResolvedAgentPreset[] {
    this.assertAvailable()
    const managedIds = new Set(this.folders.map(folder => folder.id))
    const presentIds = this.roots.length === 0 ? managedIds
      : new Set(scanNativePresetFolders(this.roots).map(folder => folder.id))
    return [...this.standings.values()]
      .filter(({ preset }) => !managedIds.has(preset.id) || presentIds.has(preset.id))
      .map(standing => standing.preset)
  }

  /** @inheritdoc */
  catalog(): { readonly default: string; readonly folders: readonly NativePresetFolderSummary[] } {
    this.assertAvailable()
    const invalid = new Map(this.folders.filter(folder => folder.status === 'invalid')
      .map(folder => [folder.id, folder.problem]))
    const folders = this.roots.length === 0 ? this.folders : scanNativePresetFolders(this.roots).map(
      ({ id, name, description, trust, status, problem }) => {
        const previousProblem = invalid.get(id)
        const unavailable = status === 'ready' && previousProblem !== undefined
        return { id, name, trust, status: unavailable ? 'invalid' as const : status,
          ...description === undefined ? {} : { description },
          ...unavailable ? { problem: previousProblem } : problem === undefined ? {} : { problem } }
      })
    return { default: this.defaultPreset, folders }
  }

  /** @inheritdoc */
  async read(id: string): Promise<NativeAgentPresetDocument> {
    this.assertAvailable()
    if (!PRESET_ID.test(id)) throw new NativeAgentPresetError('agent-preset/invalid',
      `agent-presets: preset id ${JSON.stringify(id)} must match ${String(PRESET_ID)} — the id is a directory name`,
      { agentPreset: id, reason: 'invalid preset id' })
    const folder = nativePresetFolder(this.roots, id)
    const standing = this.standings.get(id)?.preset
    if (folder !== undefined) {
      const content = await readNativePresetComposition(folder)
      const summary = this.catalog().folders.find(candidate => candidate.id === id)
      const status = summary?.status ?? folder.status
      const problem = summary?.problem ?? folder.problem
      return { id, source: folder.trust, status, name: folder.name,
        ...folder.description === undefined ? {} : { description: folder.description },
        ...content === undefined ? {} : { content },
        ...problem === undefined ? {} : { problem } }
    }
    if (standing === undefined || !this.list().some(preset => preset.id === id)) {
      const available = [...new Set([...this.list().map(preset => preset.id), ...this.catalog().folders.map(preset => preset.id)])]
      throw new NativeAgentPresetError('agent-preset/not-found',
        `agent-presets: preset ${JSON.stringify(id)} not found (available: ${available.join(', ') || 'none'})`,
        { agentPreset: id, available })
    }
    return { id, source: 'profile', status: 'ready', name: standing.name,
      ...standing.description === undefined ? {} : { description: standing.description } }
  }

  /** @inheritdoc */
  async copy(from: string, id: string, name?: string): Promise<void> {
    this.assertAvailable()
    if (PRESET_ID.test(id) && this.standings.has(id)) {
      const reason = `preset ${JSON.stringify(id)} already exists — a copy never overwrites; choose another id`
      throw new NativeAgentPresetError('agent-preset/invalid', `agent-presets: ${reason}`, { agentPreset: id, reason })
    }
    await copyNativePreset(this.roots, from, id, name)
  }

  /** @inheritdoc */
  async delete(id: string): Promise<void> {
    this.assertAvailable()
    await deleteNativePreset(this.roots, id)
  }

  /** @inheritdoc */
  directory(id: string): string {
    this.assertAvailable()
    return nativePresetDirectory(this.roots, id)
  }

  /** @inheritdoc */
  resolvePreset(request: {
    readonly fresh: boolean
    readonly facts: NativeAgentPresetFacts
    readonly preset?: string
  }): NativeResolvedAgentPreset | null {
    this.assertAvailable()
    if (request.preset !== undefined && request.facts.locked) throw new Error('agent-presets: started Session cannot select a preset')
    const id = request.preset ?? request.facts.preset ?? (request.fresh ? this.defaultPreset : null)
    if (id === null) return null
    const standing = this.standings.get(id)
    if (standing === undefined || request.fresh && !this.list().some(preset => preset.id === id)) {
      throw new Error(`agent-presets: standing preset ${id} is unavailable`)
    }
    return standing.preset
  }

  /** @inheritdoc */
  acquire(preset: NativeResolvedAgentPreset): NativeAgentPresetLease {
    this.assertAvailable()
    const standing = this.standings.get(preset.id)
    if (standing === undefined || standing.preset.generation !== preset.generation || standing.preset.scope !== preset.scope) {
      throw new Error(`agent-presets: standing generation ${preset.id} is unavailable`)
    }
    const token = {}
    standing.leases.add(token)
    let completion: Promise<void> | undefined
    return Object.freeze({ ...standing.preset, signal: standing.controller.signal,
      release: (cleanupFailure?: unknown) => completion ??= Promise.resolve().then(() => {
        if (cleanupFailure !== undefined) standing.cleanupFailures.push(cleanupFailure)
        standing.leases.delete(token)
        if (standing.closing && standing.leases.size === 0) standing.drained.resolve()
      }) })
  }

  /** Close all admissions before awaiting leased Agent cleanup. @returns shared completion. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.stopped = true
    this.disposal = Promise.allSettled([...this.ownedStandings].map(standing => standing.release())).then((results) => {
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown)
      if (failures.length > 0) throw new AggregateError(failures, 'agent-presets: registry cleanup failed')
    })
    return this.disposal
  }

  private assertAvailable(): void {
    if (this.stopped) throw new Error('agent-presets: registry disposed')
  }
}
