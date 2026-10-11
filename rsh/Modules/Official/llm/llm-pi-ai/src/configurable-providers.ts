/** Provider configuration entries shared by the Cordis and Native adapters. */
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm/native'
import { catalogProviderIds } from './catalog.ts'
import type { ResolvedPiAiProviderProfile } from './config.ts'

/**
 * Build the configurable directory from pi-ai's installed catalog and active profiles.
 * @param profiles - the currently resolved provider profiles.
 * @returns directory entries in catalog order, with profile-only routes last.
 */
export function configurableProviderEntries(
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>,
): LlmConfigurableProvider[] {
  const catalog = new Set(catalogProviderIds())
  const entries = new Map<string, LlmConfigurableProvider>()
  const declare = (provider: string, displayName: string, error?: string): void => {
    entries.set(provider, {
      provider,
      displayName,
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', provider],
      declared: !catalog.has(provider),
      ...error === undefined ? {} : { error },
    })
  }
  for (const provider of catalog) declare(provider, provider)
  for (const [provider, profile] of profiles) declare(provider, profile.displayName, profile.catalogError)
  return [...entries.values()]
}
