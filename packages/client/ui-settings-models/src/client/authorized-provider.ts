/** Codex account sign-in activates its existing pi-ai catalog route without changing session models. */

import type { AuthorizationEntryView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsOperations } from './operations.ts'
import type { ModelsSettingsStore, ProviderDirectoryEntry } from './store.ts'
import type { en } from './locales.ts'

/**
 * Identify the supported account-authenticated route, independently of whether it is configured.
 * @param entry - provider directory identity.
 * @returns whether the route belongs in subscription settings rather than API-key editors.
 */
export function isSubscriptionProvider(entry: Pick<ProviderDirectoryEntry, 'provider' | 'settingsNs'>): boolean {
  return entry.provider === 'openai-codex' && entry.settingsNs === 'llm-pi-ai'
}

/**
 * Add a missing Codex profile without an API-key override. Existing profiles survive unchanged.
 * @param key - the account whose authorization completed.
 * @param operations - revision-fenced settings writes.
 * @param controller - current provider and settings snapshot owner.
 * @param t - localized configuration failure messages.
 * @param signal - cancels activation before a settings write starts; committed settings are retained.
 * @returns nothing after configuration and directory refresh.
 * @throws Error when the directory, settings write, or an existing API-key override prevents activation.
 */
export async function enableAuthorizedProvider(
  key: AuthorizationEntryView['key'],
  operations: ModelsOperations,
  controller: ModelsSettingsStore,
  t: (key: keyof typeof en) => string,
  signal?: AbortSignal,
): Promise<void> {
  await controller.load()
  signal?.throwIfAborted()
  if (key !== 'llm-pi-ai/openai-codex') return
  const state = controller.store.getSnapshot()
  if (state.status !== 'ready') throw new Error(state.error ?? t('loadFailed'))
  const row = state.rows.find(candidate => isSubscriptionProvider(candidate.entry))
  const namespace = state.namespaces.get('llm-pi-ai')
  if (row === undefined || namespace === undefined) throw new Error(t('authorizationProviderMissing'))
  if (row.apiKeyEnv !== undefined) throw new Error(t('authorizationApiKeyOverride'))
  if (row.entry.error !== undefined) throw new Error(row.entry.error)
  if (row.configured) {
    if (!row.entry.active) throw new Error(t('authorizationProviderMissing'))
    return
  }
  if (!state.writable) throw new Error(t('readOnly'))
  const written = await operations.writeSettings('llm-pi-ai', [
    { op: 'set', path: [...row.entry.settingsPath], value: {} },
  ], namespace.revision)
  if (written.kind !== 'written') throw new Error(written.message)
  await controller.load()
  const refreshed = controller.store.getSnapshot()
  if (refreshed.status !== 'ready') throw new Error(refreshed.error ?? t('loadFailed'))
  if (!refreshed.rows.some(candidate => candidate.entry.provider === 'openai-codex' && candidate.entry.active)) {
    throw new Error(t('authorizationProviderMissing'))
  }
}
