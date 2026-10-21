/** Native image-understanding contracts consumed by Programs and supplied by an official plugin. */
import type { ContentBlock, ImageBlock, LlmCallConfig, TokenUsage } from '@deepseek-ai/dsh-llm/native'
import type { Session, SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session/native'

/** Explicit vision route and response budget, independent of the main model. */
export interface ImageUnderstandingConfig {
  readonly provider: string
  readonly model: string
  readonly maxTokens: number
}

/** Persisted interpretation, including the original image and provider-reported accounting. */
export interface ImageUnderstandingRecord {
  readonly image: ImageBlock
  readonly question: string
  readonly route: ImageUnderstandingConfig
  readonly instructions: string
  readonly text: string
  readonly usage?: TokenUsage
  readonly error?: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Question-directed image interpretation or failure, with original attachment, vision route and reported token usage. */
    'image/understanding': ImageUnderstandingRecord
  }
}

/** Inputs and sole-writer callbacks for an interpretation. */
export interface ImageUnderstandingRequest {
  readonly image: ImageBlock
  readonly question: string
  readonly signal: AbortSignal
  readonly record: (record: ImageUnderstandingRecord) => Promise<SessionSeq>
}

/** Extract images, including images nested inside tool results.
 * @param content - recorded message content.
 * @returns image occurrences in content order.
 */
export function contentImages(content: readonly ContentBlock[]): ImageBlock[] {
  return content.flatMap(block => block.type === 'image' ? [block]
    : block.type === 'tool-result' ? contentImages(block.content) : [])
}

/** Persisted Session surface and its sole-writer callbacks. */
export interface ImageUnderstandingProjection {
  readonly session: Session
  readonly events: readonly SessionEvent[]
  readonly signal: AbortSignal
  readonly append: (event: SessionEvent) => void
  readonly persist: () => Promise<void>
  readonly config: Readonly<LlmCallConfig>
}

/** Native capability for automatic interpretation and explicit follow-up questions. */
export interface NativeImageUnderstandingOperations {
  /** Interpret the original and persist its outcome.
   * @param request - question and durable recorder.
   * @returns attributed text and its record.
   */
  understand(request: ImageUnderstandingRequest): Promise<{ text: string; seq: SessionSeq }>
  /** Persist model-visible replacements. @param request - current Session and writer. @returns completion after persistence. */
  project(request: ImageUnderstandingProjection): Promise<void>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    imageUnderstanding: NativeImageUnderstandingOperations
  }
}
