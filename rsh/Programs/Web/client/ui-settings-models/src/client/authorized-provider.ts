/** Account sign-in routes are not offered by this deployment; only the directory filter remains. */

import type { ProviderDirectoryEntry } from './store.ts'

/**
 * Identify the account-authenticated route, independently of whether it is configured.
 * @param entry - provider directory identity.
 * @returns whether the route belongs to account sign-in rather than API-key editors.
 */
export function isSubscriptionProvider(entry: Pick<ProviderDirectoryEntry, 'provider' | 'settingsNs'>): boolean {
  return entry.provider === 'openai-codex' && entry.settingsNs === 'llm-pi-ai'
}
