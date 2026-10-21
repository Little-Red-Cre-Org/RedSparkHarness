/** Native Session feedback capability and its durable-commit observation. */
import type { NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { NativePlugin, NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type { SessionInspection } from '@deepseek-ai/dsh-session-persistence/native'
import type { FeedbackRecord, SessionFeedbackRecordResult } from './types.ts'
import type {} from './types.ts'

/** Native Session feedback operations used by the Host and human command Provider. */
export interface NativeSessionFeedbackOperations {
  /**
   * Record feedback on an exact live root Session owner and wait for durability.
   * @param owner - current root owner of the target Session.
   * @param entry - human-authored remark and its category.
   * @param signal - cancellation observed before the append is admitted.
   * @returns durable acknowledgement, or a stable missing-Session result.
   */
  record(owner: NativeActiveSessionOwner, entry: FeedbackRecord, signal?: AbortSignal): Promise<SessionFeedbackRecordResult>
}

/** Durable feedback produced by a cold write lease or one exact live Session owner. */
export interface NativeFeedbackCommit {
  /** Complete canonical log prefix through the feedback event. */
  readonly inspection: SessionInspection
  /** Exact installation or live-owner scope for telemetry redaction. */
  readonly scope: NativeScope
  /** Exact live writer for live commits; absent when a cold write lease made the commit. */
  readonly owner?: NativeActiveSessionOwner
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { sessionFeedback: NativeSessionFeedbackOperations }
  interface NativeEvents {
    /** Notify telemetry only after the feedback event is durable. @param commit - committed event and canonical prefix. @mode parallel */
    'feedback/committed': { mode: 'parallel'; args: [commit: NativeFeedbackCommit]; result: void }
  }
}

export type { NativePlugin }
