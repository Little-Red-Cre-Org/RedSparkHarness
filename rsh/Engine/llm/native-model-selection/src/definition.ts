/** Session-local model selection over the Program's existing active owner. */
import type { LlmCallConfig, UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type {} from '@deepseek-ai/dsh-native-runtime'
import type { NativeModelSelectionState, NativeModelSelectionRequest, NativeModelSelectionReceipt } from './types.ts'

/** One frozen step route and the durable model-visible notice the Program must append. */
export interface NativeModelSelectionSnapshot {
  readonly config: Readonly<LlmCallConfig>
  /** Accepted route and explicit controls before advisory metadata contributes defaults. */
  readonly requestedConfig: Readonly<LlmCallConfig>
  readonly notice?: UserMessage
}

/** No writer or global defaults are owned by this service. */
export interface NativeModelSelectionOperations {
  /**
   * Reconstruct the complete durable choice through the exact Program writer.
   * @param owner - attached root invocation with an available sole writer.
   * @param signal - caller cancellation combined with Provider lifetime.
   * @returns last used and next choice plus the latest intent revision.
   */
  state(owner: NativeActiveSessionOwner, signal: AbortSignal): Promise<NativeModelSelectionState>
  /**
   * Resolve a proposed exact route, compare its expected revision and persist accepted intent.
   * @param owner - exact root owner already admitted by the Program's maintenance operation.
   * @param request - complete selection and caller-observed intent revision.
   * @param signal - effective maintenance cancellation.
   * @returns provider-normalized choice after its selection event is durable.
   */
  select(owner: NativeActiveSessionOwner, request: NativeModelSelectionRequest, signal: AbortSignal): Promise<NativeModelSelectionReceipt>
  /**
   * Capture one admitted root step before prompt assembly, headers, compaction and model dispatch.
   * @param owner - exact active root owner; explicit delegated configuration remains Program-owned.
   * @param defaults - complete explicit Program request defaults used when no choice exists.
   * @param signal - current step cancellation.
   * @returns requested controls, advisory resolved route and optional notice; the Program prepares final defaults and logs the notice.
   */
  capture(owner: NativeActiveSessionOwner, defaults: LlmCallConfig, signal: AbortSignal): Promise<NativeModelSelectionSnapshot>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { modelSelection: NativeModelSelectionOperations }
}
