/** Durable policy seeded onto a Native child at delegation. */
import type { Session } from '@redspark/rsh-session/native'
import { explicitSandboxMode, type SandboxMode } from '@redspark/rsh-native-sandbox-policy'

/** Explicit parent overrides captured before the child's first await. */
export interface DelegatedPolicySeed {
  /** Last logged parent sandbox mode, absent when the parent never switched. */
  readonly sandboxMode?: SandboxMode
  /** Approval pin written when the parent turn has an approval authority. */
  readonly approvalPolicy?: 'never'
}

/** Child writer that accepts the two delegation policy events. */
export interface DelegatedPolicyAppend {
  (type: 'sandbox/mode', data: { mode: SandboxMode; source: 'delegation' }): unknown
  (type: 'approval/policy', data: { policy: 'never'; source: 'delegation' }): unknown
}

/**
 * Capture the parent's explicit sandbox override and the approval pin.
 *
 * The sandbox value is the last logged `sandbox/mode`, not the deployment default.
 * Approval is pinned to `never` only when that parent turn recorded an approval authority.
 * @param session - the delegating parent Session.
 * @param approvalRequired - whether the parent turn's authority includes approval.
 * @returns the events a fresh child must record before its first model step.
 */
export function captureDelegatedPolicy(session: Session, approvalRequired: boolean): DelegatedPolicySeed {
  const sandboxMode = explicitSandboxMode(session)
  return {
    ...sandboxMode === undefined ? {} : { sandboxMode },
    ...approvalRequired ? { approvalPolicy: 'never' as const } : {},
  }
}

/**
 * Append the captured seed onto a child Session, sandbox first.
 * @param append - the child's sole writer.
 * @param seed - policy captured from the parent before this child started.
 */
export function appendDelegatedPolicy(append: DelegatedPolicyAppend, seed: DelegatedPolicySeed): void {
  if (seed.sandboxMode !== undefined) append('sandbox/mode', { mode: seed.sandboxMode, source: 'delegation' })
  if (seed.approvalPolicy !== undefined) append('approval/policy', { policy: 'never', source: 'delegation' })
}
