/** Optional provider-owned model directory; streaming Providers need not advertise catalogs. */
import type { LlmProviderInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm/native'
import type {} from '@deepseek-ai/dsh-native-runtime'
import type { ModelCatalog, ModelSelection } from './model-selection.ts'

/** Advisory current catalogs with exact route resolution independent of advertised membership. */
export interface NativeModelDirectory {
  /** Read configured provider routes without opening a Session. @returns current routable provider facts. */
  providers(): readonly LlmProviderInfo[]
  /**
   * Read provider-owned advertised models and isolate per-provider failures.
   * @param defaultSelection - explicit Program default; this service stores no global default.
   * @param signal - caller cancellation; cancellation rejects the complete lookup.
   * @returns successful groups, isolated failures and every currently routable provider.
   */
  catalog(defaultSelection: ModelSelection, signal: AbortSignal): Promise<ModelCatalog>
  /**
   * Resolve one exact provider/model pair; advisory catalog absence does not reject it.
   * @param provider - configured provider route.
   * @param model - provider-owned model identity.
   * @param signal - caller cancellation.
   * @returns actual provider-owned capabilities and reasoning metadata.
   */
  resolve(provider: string, model: string, signal: AbortSignal): Promise<LlmResolvedModelInfo>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    modelDirectory: NativeModelDirectory
  }
}
