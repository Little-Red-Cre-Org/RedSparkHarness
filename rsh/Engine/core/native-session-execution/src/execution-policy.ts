/** Durable execution limits and permission requirements shared by Native Session consumers. */
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session/native'
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/native'
import type { Session } from '@deepseek-ai/dsh-session/native'
import type { NativeApprovalRequestId, NativeApprovalOutcome } from '@deepseek-ai/dsh-approval-definition'

/** Permission handling required by one accepted Session execution policy. */
export type NativeSessionExecutionPermission =
  | { readonly mode: 'deny' }
  | { readonly mode: 'require-approval'; readonly authority: 'session-owner' }

/** Accepted limits applied to every turn and model output in one Session. */
export interface NativeSessionExecutionPolicy {
  /** Durable policy vocabulary version. */
  readonly version: 1
  /** Maximum model/tool steps in each accepted turn; restoring or forking cannot raise it. */
  readonly maxSteps: number
  /** Optional maximum output tokens for every model request in the Session. */
  readonly maxTokens?: number
  /** Permission behavior; session-owner approval requires a live owner proof at execution time. */
  readonly permission: NativeSessionExecutionPermission
}

/** One requested approval scoped to a live Session-owner capability. */
export interface NativeSessionOwnerApprovalRequest {
  /** Exact identity already durably recorded by `native-approval/asked`. */
  readonly id: NativeApprovalRequestId
  /** Exact model tool call awaiting approval. */
  readonly callId: ToolCallId
  /** Tool whose execution is blocked pending the owner decision. */
  readonly toolName: string
  /** Why this invocation needs approval. */
  readonly reason?: string
  /** Cancels this request when its turn, Session owner, or carrier closes. */
  readonly signal: AbortSignal
}

/**
 * Live approval capability issued by a trusted Program for one exact Session and Agent owner.
 *
 * The capability is process-local and is never stored in the Session log. Its issuer binds both object identities and the
 * owner lifetime; consumers must also match those identities to the active invocation before calling `authorize`. On
 * cold restore, the Program must establish an equivalent current parent approval route and issue a new capability. If
 * it cannot, the restored Session must refuse execution. Aborting `lifetime` revokes this capability; issuers must also
 * recheck their live owner and parent route on every request.
 */
export interface NativeSessionOwnerApproval {
  /** Exact live Agent identity authorized by the owner. */
  readonly agent: NativeAgent
  /** Exact live Session object authorized by the owner. */
  readonly session: Session
  /** Owner and carrier lifetime; abortion revokes the capability. */
  readonly lifetime: AbortSignal
  /**
   * Request an owner decision for one exact admitted tool invocation.
   * @param request - tool identity, reason and turn cancellation.
   * @returns the owner's closed decision; cancellation settles locally at once while the issuer tracks and drains the unanswered relay.
   */
  authorize(request: NativeSessionOwnerApprovalRequest): Promise<NativeApprovalOutcome>
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Required execution authority; consumers must refuse to run when they cannot enforce it. */
    'execution/policy': NativeSessionExecutionPolicy
  }
}

/** Read and validate a durable execution policy payload.
 * @param value - JSON decoded from an execution/policy event.
 * @returns the accepted versioned execution policy.
 * @throws when the payload is malformed or contains unsupported fields.
 */
export function readNativeSessionExecutionPolicy(value: unknown): NativeSessionExecutionPolicy {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('native-session-execution: execution policy must be an object')
  }
  const policy = value as Record<string, unknown>
  const keys = Object.keys(policy)
  if (keys.some(key => !['version', 'maxSteps', 'maxTokens', 'permission'].includes(key))) {
    throw new TypeError('native-session-execution: execution policy has unsupported fields')
  }
  if (policy.version !== 1) throw new TypeError('native-session-execution: execution policy version is unsupported')
  if (typeof policy.maxSteps !== 'number' || !Number.isSafeInteger(policy.maxSteps) || policy.maxSteps <= 0) {
    throw new TypeError('native-session-execution: execution policy maxSteps must be a positive safe integer')
  }
  if (policy.maxTokens !== undefined
    && (typeof policy.maxTokens !== 'number' || !Number.isSafeInteger(policy.maxTokens) || policy.maxTokens <= 0)) {
    throw new TypeError('native-session-execution: execution policy maxTokens must be a positive safe integer')
  }
  if (typeof policy.permission !== 'object' || policy.permission === null || Array.isArray(policy.permission)) {
    throw new TypeError('native-session-execution: execution policy permission must be an object')
  }
  const permission = policy.permission as Record<string, unknown>
  const permissionKeys = Object.keys(permission)
  let acceptedPermission: NativeSessionExecutionPermission
  if (permission.mode === 'deny' && permissionKeys.length === 1) acceptedPermission = { mode: 'deny' }
  else if (permission.mode === 'require-approval' && permission.authority === 'session-owner' && permissionKeys.length === 2) {
    acceptedPermission = { mode: 'require-approval', authority: 'session-owner' }
  } else throw new TypeError('native-session-execution: execution policy permission is unsupported')
  return { version: 1, maxSteps: policy.maxSteps,
    ...(policy.maxTokens === undefined ? {} : { maxTokens: policy.maxTokens }), permission: acceptedPermission }
}

/** Read the one immutable execution policy from a Session event list.
 * @param events - ordered durable Session events, including inherited fork events.
 * @returns the accepted execution policy, or undefined for Sessions created before this policy existed.
 * @throws if the log contains a duplicate, ignorable, or malformed policy record.
 */
export function nativeSessionExecutionPolicy(events: readonly SessionEvent[]): NativeSessionExecutionPolicy | undefined {
  let policy: SessionEventMap['execution/policy'] | undefined
  for (const event of events) {
    if (event.type !== 'execution/policy') continue
    if (policy !== undefined) throw new Error('native-session-execution: Session has multiple execution policies')
    if (event.ignorable === true) throw new Error('native-session-execution: execution policy must be required-on-read')
    policy = readNativeSessionExecutionPolicy(event.data)
  }
  return policy
}
