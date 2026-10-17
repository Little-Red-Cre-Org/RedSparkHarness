/** Localized presentation for conversation failures with their original detail. */
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

type Translate = TranslateNS<'nativeApplication'>

// The Host forwards LlmError codes, but the conversation snapshot keeps only failure text, so classification still matches text.
const MISSING_CREDENTIAL =
  /\bno (?:API key|credential) for provider route\b|\bAPI key\b.*\b(?:is blank|contains characters no HTTP header can carry)\b/i
const MISSING_SIGN_IN = /\b(?:requires|needs) an active Sign in\b|\bSign in (?:to DeepSeek|with ChatGPT again)\b/i
const AUTH_STATUS = /\bmodel error:.*?\b(?:HTTP\s*)?(?:401|403)\b|\bAPI error \(HTTP (?:401|403)\)/i
const INVALID_CREDENTIAL = /\bauthentication fail|\b(?:invalid|incorrect) API key\b|\bAPI key (?:is )?invalid\b/i
const INVALID_SIGN_IN = /\baccount identity is invalid\b|\bSign in with ChatGPT (?:credential|account) changed\b/i

/** Classify a conversation failure that the user fixes in Model settings.
 * @param error - raw failure text from the conversation snapshot.
 * @returns the credential problem, or undefined for other failures.
 */
function modelSetupFailure(error: string): 'missing-credential' | 'auth' | undefined {
  if (MISSING_CREDENTIAL.test(error) || MISSING_SIGN_IN.test(error)) return 'missing-credential'
  if (AUTH_STATUS.test(error) || INVALID_CREDENTIAL.test(error) || INVALID_SIGN_IN.test(error)) return 'auth'
  return undefined
}

/** Render a localized transcript alert and disclose the raw failure on demand.
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
  const title = setup === 'auth' ? t('modelSetupAuth') : t('error')
  const guidance = setup === 'missing-credential' ? t('modelSetupMissingCredential')
    : setup === 'auth' ? t('modelSetupCredentialGuidance') : undefined
  return (
    <div className={className} role="alert">
      <div>
        <strong>{title}</strong>
        {guidance === undefined ? null : <p>{guidance}</p>}
      </div>
      {setup === undefined ? null : <Button variant="outline" size="sm" onClick={onOpenModelSettings}>
        {t('openModelSettings')}
      </Button>}
      <details>
        <summary>{t('errorDetails')}</summary>
        <pre>{error}</pre>
      </details>
    </div>
  )
}
