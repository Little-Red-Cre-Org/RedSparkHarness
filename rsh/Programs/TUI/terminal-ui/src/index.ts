/** Shared locale-owned rows and Ink transcript presentation. */
export { ENGLISH_ROWS, CHINESE_ROWS } from './copy.ts'
export type { TerminalRowCopy } from './copy.ts'
export { ChatRow, StreamBlock, toolResultText, blocksText } from './ui.js'

import { computeViewport as javascriptViewport } from './ui.js'

/** Select transcript rows using the shared rendered-line estimate.
 * @param options - transcript rows, terminal dimensions and line offset from the bottom.
 * @returns visible rows and the bounded scroll position.
 */
export function computeViewport<Row extends Record<string, unknown>>(options: {
  readonly items: readonly Row[]
  readonly rows: number
  readonly width: number
  readonly scrollLines: number
  readonly busy: boolean
  readonly todos?: readonly unknown[]
}): { visible: Row[]; scrollLines: number; maxScroll: number; atBottom: boolean; atTop: boolean; step: number } {
  return javascriptViewport(options)
}

import { stripAnsi as stripTerminalControls } from './utils.js'

/** Remove terminal controls from untrusted presentation text.
 * @param text - model, tool or user text.
 * @returns printable text preserving line layout.
 */
export function stripAnsi(text: string): string { return stripTerminalControls(text) }
