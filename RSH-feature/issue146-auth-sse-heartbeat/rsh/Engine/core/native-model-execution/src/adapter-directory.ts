/** Advisory catalogs and cancellation for the profile-selected model adapter. */
import type { LlmAdapter } from '@deepseek-ai/dsh-llm/native'
import type { LlmProviderInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm/native'
import type { NativeModelDirectory } from './model-directory.ts'
import type { ModelCatalog, ModelProviderGroup, ModelSelection } from './model-selection.ts'

/** Directory whose provider routes are explicitly owned by the selected adapter installation. */
export class NativeAdapterModelDirectory implements NativeModelDirectory {
  private readonly pending = new Set<Promise<unknown>>()
  private readonly cancellation = new AbortController()
  private disposal: Promise<void> | undefined
  /**
   * @param adapter - the exact adapter also published as the native streaming Model.
   * @param routes - current configured provider route identities; no inferred or hardcoded routes.
   * @param lifetime - selected Provider installation lifetime.
   */
  constructor(private readonly adapter: Pick<LlmAdapter, 'providerInfo' | 'listModels' | 'resolveModel'>,
    private readonly routes: () => readonly string[], private readonly lifetime: AbortSignal) {}

  providers(): readonly LlmProviderInfo[] {
    this.lifetime.throwIfAborted()
    this.cancellation.signal.throwIfAborted()
    return this.routes().map(provider => this.adapter.providerInfo(provider))
  }

  catalog(defaultSelection: ModelSelection, signal: AbortSignal): Promise<ModelCatalog> {
    return this.run(signal, async (signal) => {
      signal.throwIfAborted()
      const providers = this.providers()
      const settled = await Promise.allSettled(providers.map(async (provider) => {
        try {
          const models = await this.adapter.listModels(provider.id, signal)
          signal.throwIfAborted()
          const resolvedModels = await Promise.allSettled(models.map(async (model) => {
            const resolved = await this.adapter.resolveModel(provider.id, model.id, signal)
            signal.throwIfAborted()
            return { id: model.id, name: model.name,
              ...model.description === undefined ? {} : { description: model.description },
              ...resolved.reasoning === undefined ? {} : { reasoning: {
                efforts: resolved.reasoning.efforts.map(effort => ({ ...effort })),
                ...resolved.reasoning.defaultEffort === undefined ? {} : { defaultEffort: resolved.reasoning.defaultEffort },
              } },
            }
          }))
          signal.throwIfAborted()
          const advertised = resolvedModels.map((entry) => {
            if (entry.status === 'rejected') throw entry.reason
            return entry.value
          })
          const group: ModelProviderGroup = { id: provider.id, name: provider.name, models: advertised }
          return { kind: 'group' as const, group }
        } catch (error) {
          signal.throwIfAborted()
          return { kind: 'failure' as const, failure: { id: provider.id, name: provider.name,
            message: error instanceof Error ? error.message : String(error) } }
        }
      }))
      signal.throwIfAborted()
      const entries = settled.map((entry) => {
        if (entry.status === 'rejected') throw entry.reason
        return entry.value
      })
      return { default: { ...defaultSelection }, routableProviders: providers.map(provider => provider.id),
        groups: entries.flatMap(entry => entry.kind === 'group' && entry.group.models.length > 0 ? [entry.group] : []),
        failures: entries.flatMap(entry => entry.kind === 'failure' ? [entry.failure] : []) }
    })
  }

  resolve(provider: string, model: string, signal: AbortSignal): Promise<LlmResolvedModelInfo> {
    return this.run(signal, async (effective) => {
      const info = await this.adapter.resolveModel(provider, model, effective)
      effective.throwIfAborted()
      return info
    })
  }

  /** Close admission and drain accepted lookups before releasing the selected adapter.
   * @returns completion after all admitted catalog and resolution operations settle.
   */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.cancellation.abort(new Error('native model directory: Provider disposed'))
    return this.disposal = Promise.allSettled([...this.pending]).then(() => undefined)
  }

  private run<T>(signal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const effective = AbortSignal.any([signal, this.lifetime, this.cancellation.signal])
    const result = Promise.resolve().then(async () => {
      effective.throwIfAborted()
      try { return await operation(effective) }
      catch (error) { effective.throwIfAborted(); throw error }
    })
    this.pending.add(result)
    void result.then(() => { this.pending.delete(result) }, () => { this.pending.delete(result) })
    return result
  }
}
