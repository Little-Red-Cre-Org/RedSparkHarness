/** Exact standing generations with cancellation-before-drain on removal. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type { NativeAgentPresetOperations, NativeAgentPresetLease, NativePresetComposition,
  NativePresetGeneration, NativeResolvedAgentPreset } from './native-definition.ts'
import type { NativeAgentPresetFacts } from './selection.ts'

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

  /** @param defaultPreset - fresh creation default. @param scope - shared Core Provider ancestry of every standing composition. */
  constructor(private readonly defaultPreset: string, private readonly scope: NativeScope) {}

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
    return [...this.standings.values()].map(standing => standing.preset)
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
    if (standing === undefined) throw new Error(`agent-presets: standing preset ${id} is unavailable`)
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
