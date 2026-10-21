/** Cordis-free Definition for durable, model-visible request context contributions. */
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type { NativeToolRegistration } from '@deepseek-ai/dsh-native-tools'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution/active-session-protocol'
import type { SessionEvent } from '@deepseek-ai/dsh-session/native'
import type {} from '@deepseek-ai/dsh-native-runtime'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { requestContexts: NativeRequestContexts }
}

/** Opaque provider identity used for scope shadowing and deterministic message order. */
export type NativeRequestContextProviderId = Branded<'NativeRequestContextProviderId'>

/** Brand a nonempty, stable request-context provider identity.
 * @param value - stable identity unique within one scope.
 * @returns the opaque provider identity.
 */
export function NativeRequestContextProviderId(value: string): NativeRequestContextProviderId {
  if (value.length === 0) throw new Error('request-context-definition: provider id must be nonempty')
  return brandString<NativeRequestContextProviderId>(value)
}

/** Result of the Program's final admission checks and durable accept callback. */
export type NativeRequestContextAcceptance = 'accepted' | 'rejected'

/** Exact registrations included in this model request's captured model or PTC tool catalog. */
export interface NativeRequestToolVisibility {
  /**
   * Test the exact registration identity against the snapshots used by this request.
   * @param registration - disposer returned by the tool registration.
   * @returns whether that exact registration is visible to the model or PTC program.
   */
  includes(registration: NativeToolRegistration): boolean
}

/** One exact-owner request supplied to all visible request-context providers. */
export interface NativeRequestContextRequest {
  /** Exact active Session owner retained by the selected Program. */
  readonly owner: NativeActiveSessionOwner
  /** Dynamic Agent scope used by this request. */
  readonly scope: NativeScope
  /** Current turn number. */
  readonly turn: number
  /** Current model-request step number. */
  readonly step: number
  /** Final admitted direct user inputs for this request. */
  readonly inputs: readonly UserMessage[]
  /** One durable event snapshot read through `owner.readEvents()`. */
  readonly durableEvents: readonly SessionEvent[]
  /** Exact captured tool visibility after every allowlist and shadow rule. */
  readonly toolVisibility: NativeRequestToolVisibility
  /** Program and provider cancellation. */
  readonly signal: AbortSignal
}

/** Detached request messages and state committed only after the Program's durable accept. */
export interface PreparedNativeRequestContext {
  /** Model-visible messages to append to the exact owner's Session. */
  readonly messages: readonly UserMessage[]
  /** Commit provider-local last-good state after the owner flush succeeds. */
  commit(): void
}

/** Provider of durable messages for one Native model request. */
export interface NativeRequestContextProvider {
  /** Stable identity; a nearer registration with the same ID replaces this provider. */
  readonly id: NativeRequestContextProviderId
  /** Finite integer order before the ID tie-breaker. */
  readonly order: number
  /**
   * Prepare detached messages and candidate state without writing the Session or advancing last-good state.
   * @param request - exact owner, captured input, durable history and model-tool visibility.
   * @returns messages and state that may be committed after durable acceptance.
   */
  prepare(request: NativeRequestContextRequest): Promise<PreparedNativeRequestContext>
}

/** Callable removal handle for one exact provider registration. */
export interface NativeRequestContextRegistration {
  /** Remove this registration and drain its accepted preparations. @returns completion of removal. */
  (): Promise<void>
  /** @param scope - request scope to inspect. @returns whether this exact registration is the nearest winner. */
  isVisible(scope: NativeScope): boolean
}

/** Native Host service for exact-owner, durable request-context contributions. */
export interface NativeRequestContexts {
  /**
   * Check whether a request scope has any visible providers before requiring its exact active Session owner.
   * @param scope - dynamic Agent scope to inspect.
   * @returns whether the nearest-scope contribution view is nonempty.
   */
  hasProviders(scope: NativeScope): boolean
  /**
   * Register one provider in a Native scope; its disposer closes admission and drains accepted request preparations.
   * @param scope - registration scope within this Provider's realm.
   * @param provider - stable identity, order and detached preparation callback.
   * @returns exact idempotent asynchronous removal and drain, with a check for this registration's current visibility.
   */
  register(scope: NativeScope, provider: NativeRequestContextProvider): NativeRequestContextRegistration
  /**
   * Prepare all visible providers and offer their messages to the Program's single durable acceptance callback.
   * @param request - exact active owner, one durable snapshot, final inputs and captured tool visibility.
   * @param accept - Program callback that checks admission, appends messages and flushes the exact owner.
   * @returns whether the request was durably accepted; preparation and durability failures reject.
   */
  prepareAndAccept(
    request: NativeRequestContextRequest,
    accept: (messages: readonly UserMessage[]) => Promise<NativeRequestContextAcceptance>,
  ): Promise<NativeRequestContextAcceptance>
  /** Close provider admission and drain all accepted preparations.
   * @returns completion of every preparation and Program acceptance already admitted.
   */
  dispose(): Promise<void>
}
