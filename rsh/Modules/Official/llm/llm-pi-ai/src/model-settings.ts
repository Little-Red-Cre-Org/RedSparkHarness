/** Native settings metadata and discovery service for the pi-ai adapter. */
import type { LlmConfigurableProvider, LlmDiscoveredModel, LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-llm/native'
import type {} from '@deepseek-ai/dsh-native-runtime'

/** Settings-page model operations owned by the selected pi-ai adapter. */
export interface NativeModelSettings {
  /** @returns detached configurable-provider entries and their current diagnostics. */
  configurableProviders(): readonly LlmConfigurableProvider[]
  /**
   * Discover candidate models without storing the draft or its API key.
   * @param settingsNs - Settings namespace that owns the discovery implementation.
   * @param request - endpoint, provider, protocol and one-request API key.
   * @param signal - caller cancellation.
   * @returns deduplicated candidate models projected to settings-page fields.
   */
  discover(
    settingsNs: string, request: LlmModelDiscoveryRequest, signal: AbortSignal,
  ): Promise<readonly LlmDiscoveredModel[]>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    /** Model-page provider configuration and discovery for this adapter. */
    modelSettings: NativeModelSettings
  }
  interface NativeEvents {
    /** Notify configuration surfaces after model adapters or provider entries change.
     * @mode parallel
     */
    'llm/adapters-updated': { mode: 'parallel'; args: []; result: void }
  }
}
