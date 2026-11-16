/**
 * Package-attributed invariant failure shared by Cordis and Native registries.
 * This module imports no Cordis symbol.
 * @module @redspark/rsh-invariants/error
 */

/**
 * Throw a package-attributed invariant failure.
 * @param message - violated package contract without the standard prefix.
 * @returns never because reporting a violation throws.
 */
export type InvariantFailure = (message: string) => never

/** Thrown when a package-owned runtime invariant is violated. */
export class InvariantError extends Error {
  /** Stable machine-readable invariant failure code. */
  readonly code = 'INVARIANT' as const
  /** Full npm package name that owns the violated invariant. */
  readonly packageName: string

  /**
   * Construct a package-attributed invariant failure.
   * @param packageName - full npm package name that registered the check.
   * @param message - violated contract, without the standard error prefix.
   */
  constructor(packageName: string, message: string) {
    super(`invariant violated by "${packageName}": ${message}`)
    this.name = 'InvariantError'
    this.packageName = packageName
  }
}
