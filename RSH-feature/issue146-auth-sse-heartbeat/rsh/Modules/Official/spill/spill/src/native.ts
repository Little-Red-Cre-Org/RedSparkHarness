/** Framework-free spill storage Definition shared by native producers and local storage. */
import type {} from '@deepseek-ai/dsh-native-runtime'
import type { SaveTextSpill, SpillRef } from './types.ts'
export { SpillLocator } from './types.ts'
export type { SaveTextSpill, SpillOwner, SpillRef, SpillSource } from './types.ts'

/** Stores full text under its Session owner; returned locators remain readable after producer disposal. */
export interface SpillOperations {
  /**
   * Persist full text in a private, collision-free artifact before returning its retrieval locator.
   * @param input - Session owner, producing call and complete text.
   * @param signal - cancellation; accepted writes drain before Provider disposal.
   * @returns opaque locator, exact UTF-8 byte count and backend retrieval guidance.
   */
  saveText(input: SaveTextSpill, signal: AbortSignal): Promise<SpillRef>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { spillStore: SpillOperations }
}
