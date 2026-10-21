/**
 * Authorization error taxonomy shared by the Cordis service and the native Provider.
 * @module @deepseek-ai/dsh-authorization/errors
 */

import { HarnessError } from '@deepseek-ai/dsh-llm/native'

/** Stable error taxonomy for authorization failures. */
export class AuthorizationError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'AuthorizationError'
  }
}

/**
 * Whether a flow failure's message is a curated diagnostic that may reach the
 * settled frame: an `AuthorizationError`, or a `HarnessError` coded `SIWC_*`
 * (thrown by `llm-pi-ai`, which cannot import this package at runtime).
 * @param error - the flow failure.
 * @returns true when its message may be shown and logged by code.
 */
export function isSafeDiagnostic(error: unknown): error is HarnessError {
  return error instanceof AuthorizationError || (error instanceof HarnessError && error.code.startsWith('SIWC_'))
}

/**
 * The rejection an interaction `prompt()` uses to say the
 * human declined — dismissed the question, chose not to answer — rather than
 * that the surface broke. An attempt whose flow fails after a prompt was
 * declined settles as `cancelled`, the same outcome as a withdrawn signal,
 * because the human saying no is a refusal, not a breakage. Only a human's
 * "no" may reject with this class: a prompt withdrawn by its own `signal` (a
 * flow retiring the losing question of a race) must reject with something
 * else, or a later genuine failure would be misread as a decline.
 */
export class AuthorizationDeclinedError extends AuthorizationError {
  constructor(message = 'the authorization prompt was declined') {
    super(message, 'DECLINED')
    this.name = 'AuthorizationDeclinedError'
  }
}
