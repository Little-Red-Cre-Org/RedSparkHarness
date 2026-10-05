/** Shared locale-owned rows and Ink transcript presentation. */
export { ENGLISH_ROWS, CHINESE_ROWS } from './copy.ts'
export type { TerminalRowCopy } from './copy.ts'
export { ChatRow, StreamBlock, toolResultText, blocksText } from './ui.js'

import { stripAnsi as stripTerminalControls } from './utils.js'

/** Remove terminal controls from untrusted presentation text.
 * @param text - model, tool or user text.
 * @returns printable text preserving line layout.
 */
export function stripAnsi(text: string): string { return stripTerminalControls(text) }
