/**
 * Wire-safe authorization types import the credential-key brand through the
 * Cordis-free Native entry; type-only imports keep runtime code out of browser
 * type chains.
 * @module @deepseek-ai/dsh-authorization/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/native'

/** One way a flow can obtain its credential, named by the flow that offers it. */
export interface AuthorizationMethod {
  /** Flow-owned identifier, echoed back when a caller picks this method. */
  id: string
  /** User-facing label for a picker. */
  label: string
}

/** A running flow's report to whoever is watching it. Never carries a secret. */
export interface AuthorizationNotice {
  /** What is happening, or what the human must do next. */
  message: string
  /** A page the human must open to continue. */
  url?: string
  /** A short code the human must enter on that page. */
  code?: string
}

/** One choice offered by a `select` prompt. */
export interface AuthorizationPromptOption {
  /** Value returned when this option is chosen. */
  id: string
  /** User-facing label. */
  label: string
  /** Optional extra context rendered by capable surfaces. */
  description?: string
}

/**
 * A question a flow must have answered before it can continue. `secret` differs
 * from `text` only in presentation — a surface masks it and keeps it out of
 * logs — and `select` answers with the chosen option's `id`.
 */
export type AuthorizationPrompt = {
  /**
   * Withdraws this prompt alone, leaving the flow running. A flow that races a
   * typed code against a browser callback aborts the losing prompt here; the
   * whole authorization is cancelled through the request's signal instead.
   */
  signal?: AbortSignal
} & ({
  kind: 'text'
  message: string
  placeholder?: string
} | {
  kind: 'secret'
  message: string
  placeholder?: string
} | {
  kind: 'select'
  message: string
  options: readonly AuthorizationPromptOption[]
})

/** How one authorization attempt ended, as its own caller sees it. */
export type AuthorizationStatus = 'authorized' | 'cancelled'

/**
 * How one attempt ended, as an onlooker sees it. A failure reaches its caller
 * as a thrown error rather than an outcome, so `failed` exists only here — on
 * the event stream, where a watcher that did not start the attempt has no
 * other way to tell a refusal from a breakage.
 */
export type AuthorizationSettlement = AuthorizationStatus | 'failed'

/** The result of one `begin()` attempt. */
export interface AuthorizationOutcome {
  /** `authorized` once the record is committed and observed; `cancelled` when the human or caller withdrew. */
  status: AuthorizationStatus
}

/** A registered flow as a surface sees it: what it authorizes and whether it is busy. */
export interface AuthorizationEntry {
  /** The credential record this flow writes. */
  key: CredentialKey
  /** User-facing name of what is being authorized. */
  label: string
  /** The methods this flow offers, most preferred first. */
  methods: readonly AuthorizationMethod[]
  /** Whether an attempt for this key is running right now. */
  inFlight: boolean
}

/**
 * What a running flow is given to talk to the human. Every member is scoped to
 * one attempt: the flow neither knows nor chooses which surface is listening.
 */
export interface AuthorizationSession {
  /** The method id the caller picked, always one this flow declared. */
  readonly method: string
  /** Aborted when the caller withdraws or `cancel()` is called for this key. */
  readonly signal: AbortSignal
  /**
   * Report progress, or tell the human what to do next. Fire-and-forget: a
   * surface that cannot render a notice must not stall the flow.
   * @param notice - the message, and any page or code it refers to.
   */
  notify(notice: AuthorizationNotice): void
  /**
   * Ask the human a question the flow cannot answer for itself.
   * @param prompt - what to ask, and how it should be presented.
   * @returns what the human typed, or the chosen option's id.
   * @throws when the human declines, or the prompt's own signal withdraws it.
   */
  prompt(prompt: AuthorizationPrompt): Promise<string>
}

/**
 * A plugin's knowledge of how to obtain one credential. The flow owns the
 * write: `run()` resolving means the record for `key` is committed through
 * `ctx.credentials` during that run, which the seam confirms — a commit
 * observed within the attempt, still present after it — before reporting
 * success. Committing inside the flow is what lets a library that persists
 * through its own store adapter (pi-ai's `Models.login()`) stay the single
 * writer instead of being copied back out and written twice.
 */
export interface AuthorizationFlow {
  /** The credential record this flow writes. Its scope names the owning plugin. */
  readonly key: CredentialKey
  /** User-facing name of what is being authorized. */
  readonly label: string
  /**
   * The methods offered, most preferred first; a caller naming none gets the
   * first. Typed non-empty because a flow with nothing to run is a flow that
   * cannot be begun, and the type says so at the one place flows are written.
   */
  readonly methods: readonly [AuthorizationMethod, ...AuthorizationMethod[]]
  /**
   * Run one attempt to obtain and commit the credential.
   * @param session - the chosen method, the cancellation signal, and the interaction callbacks.
   * @returns once the record is committed.
   * @throws when the attempt fails or the human declines.
   */
  run(session: AuthorizationSession): Promise<void>
}

/** Opaque identity of one authorization attempt, safe to send to a surface. */
export type AuthorizationAttemptId = Branded<'AuthorizationAttemptId'>

/** Opaque identity of one prompt within an attempt, safe to send to a surface. */
export type AuthorizationPromptId = Branded<'AuthorizationPromptId'>

/** A prompt as a surface receives it: {@link AuthorizationPrompt} without its process-local signal. */
export type AuthorizationPromptView = {
  kind: 'text'
  message: string
  placeholder?: string
} | {
  kind: 'secret'
  message: string
  placeholder?: string
} | {
  kind: 'select'
  message: string
  options: readonly AuthorizationPromptOption[]
}

/**
 * One step of an attempt's conversation, in order. Prompts never echo answers.
 * A failure carries a code and may include a curated `AuthorizationError`
 * message.
 *
 * - `notice`: progress, or what the human must do next.
 * - `prompt`: a question waiting for `answer()` or `decline()` with its `promptId`.
 * - `prompt-closed`: that prompt no longer accepts an answer (answered,
 *   declined, or withdrawn by the flow racing it against a callback).
 * - `settled`: the last frame; the attempt has fully drained and released its key.
 *   `code` is present only for `failed`: an `AuthorizationError` code, or
 *   `FLOW_FAILED` for any other flow error. `message` is included only for an
 *   `AuthorizationError`; other flow error messages are not exposed.
 */
export type AuthorizationFrame =
  | { type: 'notice'; notice: AuthorizationNotice }
  | { type: 'prompt'; promptId: AuthorizationPromptId; prompt: AuthorizationPromptView }
  | { type: 'prompt-closed'; promptId: AuthorizationPromptId }
  | { type: 'settled'; settlement: AuthorizationSettlement; code?: string; message?: string }
