/** Native message-feedback operations over the Program writer or cold Session lease. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type {
  MessageFeedbackDeleteRequest, MessageFeedbackDeleteResult, MessageFeedbackListRequest,
  MessageFeedbackListResult, MessageFeedbackPutRequest, MessageFeedbackPutResult,
} from './types.ts'

/** Cordis-free message-feedback Definition consumed by Native Hosts. */
export interface NativeMessageFeedbackOperations {
  /**
   * @param request - Session whose feedback should be read.
   * @param signal - caller cancellation.
   * @returns current immutable values or Session-not-found.
   */
  list(request: MessageFeedbackListRequest, signal?: AbortSignal): Promise<MessageFeedbackListResult>
  /**
   * @param request - target, replacement and observed version.
   * @param signal - cancellation before commit.
   * @returns durable item or a business failure.
   */
  put(request: MessageFeedbackPutRequest, signal?: AbortSignal): Promise<MessageFeedbackPutResult>
  /**
   * @param request - Session, message and observed version.
   * @param signal - cancellation before commit.
   * @returns durable absence or a business failure.
   */
  delete(request: MessageFeedbackDeleteRequest, signal?: AbortSignal): Promise<MessageFeedbackDeleteResult>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { messageFeedback: NativeMessageFeedbackOperations }
}

export type { NativePlugin }
