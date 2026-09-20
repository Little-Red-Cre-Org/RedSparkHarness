/**
 * Browser-safe failure vocabulary of the configuration surfaces this package
 * serves. The redacted views themselves live with their seam in
 * `@deepseek-ai/dsh-settings/types`, whose Cordis event declarations already
 * register that file for the Client compilation face.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { AuthorizationEntry, AuthorizationNotice, AuthorizationPromptOption } from '@deepseek-ai/dsh-authorization/types'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * Every seam refusal that is not a stale write: an unregistered or malformed
     * namespace, a read-only provider, schema validation, storage.
     */
    'settings/rejected': { readonly ns: string }
    /**
     * The stored revision moved after the caller read it. Its own outcome rather
     * than an invalid request: the caller must re-read and re-apply.
     */
    'settings/conflict': { readonly ns: string; readonly expected: number; readonly actual: number }
    /**
     * The provider refused a valid credential write, for example because a
     * read-only source shadows the reference. The details name only the
     * reference, never the value.
     */
    'credential/rejected': { readonly ref: string }
  }
}

/** Confirmation that the settings document was handed to the native editor. */
export interface SettingsDocumentOpenValue {
  readonly opened: true
}

/** Result of opening or revealing one locally authored Agent preset directory. */
export type AgentPresetDirectoryOpenValue =
  | { readonly opened: true }
  | { readonly opened: false; readonly path: string }

/** Browser-visible identity of one live authorization attempt. */
export type AuthorizationAttemptId = Branded<'AuthorizationAttemptId'>

/** Browser-visible identity of one prompt within an authorization attempt. */
export type AuthorizationPromptId = Branded<'AuthorizationPromptId'>

/** A registered authorization flow joined with redacted credential-record state. */
export interface AuthorizationEntryView extends AuthorizationEntry {
  readonly configured: boolean
  readonly kind?: CredentialRecord['kind']
  readonly writable: boolean
}

/** Wire-safe prompt with the Host-only cancellation signal removed. */
export type AuthorizationPromptView =
  | { kind: 'text' | 'secret'; message: string; placeholder?: string }
  | { kind: 'select'; message: string; options: readonly AuthorizationPromptOption[] }

/** Incremental browser conversation for one authorization attempt. */
export type AuthorizationFrame =
  | { type: 'started'; attemptId: AuthorizationAttemptId }
  | { type: 'notice'; notice: AuthorizationNotice }
  | {
    type: 'prompt'
    attemptId: AuthorizationAttemptId
    promptId: AuthorizationPromptId
    prompt: AuthorizationPromptView
  }
  | { type: 'settled'; status: 'authorized' | 'cancelled' }

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'authorization/rejected': { readonly authorizationCode?: string }
    'authorization/prompt-not-found': {
      readonly attemptId: AuthorizationAttemptId
      readonly promptId: AuthorizationPromptId
    }
  }
}
