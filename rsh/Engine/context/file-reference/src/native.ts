/** Cordis-free Native declaration for file-reference discovery. */
import type { NativeAgent } from '@deepseek-ai/dsh-native-agent'
import type {} from '@deepseek-ai/dsh-native-runtime'
import type { Session } from '@deepseek-ai/dsh-session/native'
import type { FileReferenceCandidate } from './types.ts'

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { fileReferences: NativeFileReferenceOperations }
}

/** Path-only candidates from the exact active Agent and Session workspace. */
export interface NativeFileReferenceOperations {
  /**
   * List deterministic path candidates without reading file contents.
   * @param agent - exact Native Agent whose scope is consuming the candidates.
   * @param session - exact live Session whose cwd bounds discovery.
   * @param query - path text following `@` or `@"`.
   * @param signal - caller cancellation.
   * @returns ranked workspace-relative file and directory candidates.
   * @throws when the exact Agent and Session do not have a live owner.
   */
  list(agent: NativeAgent, session: Session, query: string, signal: AbortSignal): Promise<FileReferenceCandidate[]>
}
