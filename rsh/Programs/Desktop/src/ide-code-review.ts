/** Line edits held outside documents until the user accepts them. */
import { diffLines } from 'diff'

/** One replacement against the original document's character offsets. */
export interface CodeReviewBlock {
  readonly start: number
  readonly end: number
  readonly before: string
  readonly after: string
}

/**
 * Group adjacent removed and added lines without merging unchanged lines.
 * @param before - original document text.
 * @param after - proposed complete document text.
 * @returns independent blocks in original document order.
 */
export function codeReviewBlocks(before: string, after: string): CodeReviewBlock[] {
  const blocks: CodeReviewBlock[] = []
  let offset = 0
  let pending: { start: number; end: number; before: string; after: string } | undefined
  for (const part of diffLines(before, after)) {
    if (!part.added && !part.removed) {
      if (pending !== undefined) { blocks.push(pending); pending = undefined }
      offset += part.value.length
      continue
    }
    pending ??= { start: offset, end: offset, before: '', after: '' }
    if (part.removed) { pending.before += part.value; offset += part.value.length; pending.end = offset }
    else pending.after += part.value
  }
  if (pending !== undefined) blocks.push(pending)
  return blocks
}

/**
 * Apply only accepted blocks while retaining all other original text.
 * @param original - immutable review baseline.
 * @param blocks - replacements produced for that baseline.
 * @param accepted - selected block indexes.
 * @returns candidate editor text.
 */
export function applyReviewBlocks(original: string, blocks: readonly CodeReviewBlock[], accepted: ReadonlySet<number>): string {
  let result = original
  for (let index = blocks.length - 1; index >= 0; index--) {
    if (!accepted.has(index)) continue
    const block = blocks[index]!
    result = result.slice(0, block.start) + block.after + result.slice(block.end)
  }
  return result
}
