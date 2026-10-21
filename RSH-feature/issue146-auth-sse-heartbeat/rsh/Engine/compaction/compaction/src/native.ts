/**
 * Cordis-free compaction Definition for native Providers and Consumers. The
 * durable `compaction/*` events, checkpoint source and manual failure classes
 * are the same values the Cordis Service Definition exports.
 * @module @deepseek-ai/dsh-compaction/native
 */

import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type {} from '@deepseek-ai/dsh-native-runtime'
import type { Session } from '@deepseek-ai/dsh-session/native'
import type { CompactionTrigger } from './errors.ts'
import type { CompactionResult } from './types.ts'

export type { CompactionResult } from './types.ts'
export { CompactionId } from './brand.ts'
export { compactCheckpointSource, isCompactCheckpointSource } from './checkpoint.ts'
export type { CompactionCheckpointSource } from './checkpoint.ts'
export { toolPairingBalancedAfter, toolPairingBalancedBefore } from './tool-pairing.ts'
export { ManualCompactionError } from './errors.ts'
export type { CompactionTrigger, ManualCompactionErrorCode } from './errors.ts'

/**
 * Exact live Session access a native compaction Provider writes through. A
 * Program's active Session owner satisfies it; every append uses the Program's
 * sole retained writer and `flush()` is its durability barrier.
 */
export interface NativeCompactionOwner {
  readonly session: Session
  /** False after the Program closes writer admission; appends then fail loudly. */
  readonly writerAvailable: boolean
  readonly append: Session['append']
  /**
   * Persist tracked appends through the Program's writer.
   * @returns completion of the durability barrier.
   */
  flush(): Promise<void>
}

/**
 * Native compaction Definition. A Provider owns trigger policy, retention and
 * summarization; a successful run replaces one balanced surface span with one
 * checkpoint `user/message` inside a durable `compaction/start`/`compaction/end`
 * bracket that is also the Session compaction lock.
 */
export interface NativeCompactionOperations {
  /**
   * Consider automatic compaction inside the owner's open turn.
   * @param owner - exact live Session owner with an open turn.
   * @param trigger - normal pressure or provider-confirmed context overflow.
   * @param signal - turn cancellation forwarded to summarization.
   * @returns the latest committed result, or `null` when no compaction was needed or possible.
   */
  compactIfNeeded(owner: NativeCompactionOwner, trigger: CompactionTrigger, signal: AbortSignal): Promise<CompactionResult | null>
  /**
   * Compact one useful span below the automatic threshold between turns. The
   * caller supplies an owner whose idle Session operation excludes new turns.
   * @param owner - exact live Session owner without an open turn.
   * @param signal - cancellation scoped to this request.
   * @param sourceCommandId - initiating human command, when present.
   * @returns the durably flushed result, or `null` when no safe useful span exists.
   * @throws {@link ManualCompactionError} for expected busy, changed-span,
   * summarization, commit-stage or persistence failures; an aborted request
   * preserves its abort reason.
   */
  compactNow(owner: NativeCompactionOwner, signal: AbortSignal, sourceCommandId?: CommandId): Promise<CompactionResult | null>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { compaction: NativeCompactionOperations }
}
