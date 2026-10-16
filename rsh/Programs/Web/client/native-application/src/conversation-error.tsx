/** Localized presentation for conversation failures with their original detail. */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

type Translate = TranslateNS<'nativeApplication'>

// The native prompt RPC reports model failures as `native/session` message text without the
// LlmError code, so credential failures are recognized from the adapters' message wording.
const MISSING_CREDENTIAL = /\bno (?:API key|credential) for provider route\b|\brequires an active Sign in\b|\bSign in to DeepSeek\b/i
const INVALID_CREDENTIAL = /\b(?:401|403)\b|\bauthentication fail|\b(?:invalid|incorrect) API key\b|\bAPI key (?:is )?invalid\b/i

/** Classify a conversation failure that the user fixes in Model settings.
 * @param error - raw failure text from the conversation snapshot.
 * @returns the credential problem, or undefined for other failures.
 */
function modelSetupFailure(error: string): 'missing-credential' | 'auth' | undefined {
  if (MISSING_CREDENTIAL.test(error)) return 'missing-credential'
  if (INVALID_CREDENTIAL.test(error)) return 'auth'
  return undefined
}

/** Render friendly conversation copy and disclose the raw failure on demand.
 * @param props.error - raw failure text from the conversation snapshot.
 * @param props.t - native application translation callback.
 * @param props.onOpenModelSettings - open Settings at Models for credential failures.
 * @param props.className - page-owned layout class.
 * @returns localized alert content.
 */
export function ConversationError({ error, t, onOpenModelSettings, className }: {
  error: string
  t: Translate
  onOpenModelSettings: () => void
  className?: string | undefined
}) {
  const setup = modelSetupFailure(error)
  return (
    <div className={className} role="alert">
      <p>{setup === 'missing-credential' ? t('modelSetupMissingCredential') : setup === 'auth' ? t('modelSetupAuth') : t('error')}</p>
      {setup === undefined ? null : <button type="button" onClick={onOpenModelSettings}>{t('openModelSettings')}</button>}
      <details>
        <summary>{t('errorDetails')}</summary>
        <pre>{error}</pre>
      </details>
    </div>
  )
}
