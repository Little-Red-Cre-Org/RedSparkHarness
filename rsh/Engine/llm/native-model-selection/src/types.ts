/** Browser-safe Session model selection requests and durable revision facts. */
import type { SessionSeq, SessionEvent } from '@deepseek-ai/dsh-session/types'
import { foldModelSelection } from '@deepseek-ai/dsh-native-model-execution/model-selection'
import type { ModelSelectionProjection, ModelSelection } from '@deepseek-ai/dsh-native-model-execution/model-selection'
export type * from '@deepseek-ai/dsh-native-model-execution/model-selection'

/** Selection intent revision; request headers do not consume a later user choice. */
export interface NativeModelSelectionState extends ModelSelectionProjection {
  readonly revision: SessionSeq | null
}

/** Reconstruct choice and intent revision from the complete validated Session prefix.
 * @param events - complete history, including any inherited fork prefix.
 * @returns durable choices and latest intent revision without activating execution.
 */
export function foldNativeModelSelectionState(events: readonly SessionEvent[]): NativeModelSelectionState {
  return { ...foldModelSelection(events), revision: events.findLast(event => event.type === 'model/selection')?.seq ?? null }
}

/** Complete choice with an explicit comparison against the latest observed durable intent. */
export interface NativeModelSelectionRequest {
  readonly selected: ModelSelection
  readonly expectedRevision: SessionSeq | null
}

/** Accepted durable choice and its exact selection event. */
export interface NativeModelSelectionReceipt {
  readonly selected: ModelSelection
  readonly revision: SessionSeq
}
