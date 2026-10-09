/**
 * Native authorization Definition and Provider: plugin-owned flows obtain a
 * credential through one neutral conversation of notices, prompts, answers and
 * cancellation, and commit it through the selected `credentials` Provider.
 *
 * Unlike the Cordis service, a native attempt is never orphaned: cancelling it,
 * removing its flow, or disposing the Provider aborts the flow's signal and
 * settles only after `run()` and the credential writes it admitted have
 * finished. The key stays claimed until then.
 *
 * @module @deepseek-ai/dsh-authorization/native
 */

import type {} from '@deepseek-ai/dsh-native-runtime'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/native'
import type {
  AuthorizationAttemptId, AuthorizationEntry, AuthorizationFlow, AuthorizationFrame, AuthorizationOutcome,
  AuthorizationPromptId, AuthorizationSettlement,
} from './types.ts'

export { AuthorizationDeclinedError, AuthorizationError } from './errors.ts'
export type {
  AuthorizationAttemptId, AuthorizationEntry, AuthorizationFlow, AuthorizationFrame, AuthorizationMethod,
  AuthorizationNotice, AuthorizationOutcome, AuthorizationPrompt, AuthorizationPromptId, AuthorizationPromptOption,
  AuthorizationPromptView, AuthorizationSession, AuthorizationSettlement, AuthorizationStatus,
} from './types.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { authorization: NativeAuthorization }
  interface NativeEvents {
    /**
     * One attempt has fully drained and released its key.
     * @mode parallel
     * @param key - the credential record the attempt was authorizing.
     * @param settlement - how it ended, including `failed`.
     */
    'authorization/settled': { mode: 'parallel'; args: [key: CredentialKey, settlement: AuthorizationSettlement]; result: void }
  }
}

/** One request to start authorizing a key. */
export interface NativeAuthorizationRequest {
  /** The credential record to authorize; a flow must be registered for it. */
  readonly key: CredentialKey
  /** One of the flow's method ids; defaults to its first. */
  readonly method?: string
  /** Withdraws the whole attempt, like `cancel()`. */
  readonly signal?: AbortSignal
}

/** One running attempt, driven by a surface through its frames and commands. */
export interface NativeAuthorizationAttempt {
  readonly id: AuthorizationAttemptId
  readonly key: CredentialKey
  readonly method: string
  /**
   * The conversation so far, then live frames, ending after `settled`.
   * Each call replays from the first frame, so a reconnecting surface rebuilds
   * its view; aborting `signal` ends only this iteration.
   * @param signal - ends this iteration early.
   */
  frames(signal?: AbortSignal): AsyncIterable<AuthorizationFrame>
  /**
   * Answer an open prompt.
   * @param promptId - from a `prompt` frame.
   * @param value - typed text, or the chosen option's id.
   * @throws {AuthorizationError} code `PROMPT_NOT_FOUND` when the prompt is closed or unknown.
   */
  answer(promptId: AuthorizationPromptId, value: string): void
  /**
   * Decline an open prompt; the flow sees `AuthorizationDeclinedError` and the
   * attempt settles `cancelled` if the flow then fails.
   * @param promptId - from a `prompt` frame.
   * @throws {AuthorizationError} code `PROMPT_NOT_FOUND` when the prompt is closed or unknown.
   */
  decline(promptId: AuthorizationPromptId): void
  /**
   * Withdraw the attempt.
   * @returns after the flow and its admitted credential writes have settled and the key is released.
   */
  cancel(): Promise<void>
  /**
   * Settles with the attempt, after the drain `cancel()` describes.
   * Resolves `authorized` or `cancelled`; rejects with the flow's failure
   * (`AuthorizationError` code `NOT_COMMITTED` when it committed nothing).
   */
  readonly outcome: Promise<AuthorizationOutcome>
}

/** The `authorization` native service. */
export interface NativeAuthorization {
  /**
   * Offer a flow for one key.
   * @param flow - the key it writes, its label, methods and runner.
   * @returns removal that refuses new attempts, cancels the running one and
   *   resolves after it has drained.
   * @throws {AuthorizationError} code `DUPLICATE_FLOW` when the key is claimed.
   */
  registerFlow(flow: AuthorizationFlow): () => Promise<void>
  /** @returns every registered flow, in registration order. */
  list(): readonly AuthorizationEntry[]
  /**
   * @param key - credential record address.
   * @returns the registered flow's entry, or undefined.
   */
  describe(key: CredentialKey): AuthorizationEntry | undefined
  /**
   * Start one attempt; at most one runs per key.
   * @param request - key, optional method and signal.
   * @returns the running attempt.
   * @throws {AuthorizationError} synchronously with code `NO_FLOW`,
   *   `UNKNOWN_METHOD`, `ALREADY_IN_FLIGHT` or `DISPOSED`.
   */
  begin(request: NativeAuthorizationRequest): NativeAuthorizationAttempt
  /**
   * @param key - credential record address.
   * @returns the attempt currently holding the key, so a second surface can watch or drive it.
   */
  current(key: CredentialKey): NativeAuthorizationAttempt | undefined
  /**
   * Withdraw the attempt for a key, if any.
   * @param key - credential record address.
   * @returns after that attempt has drained; immediately when none runs.
   */
  cancel(key: CredentialKey): Promise<void>
}
