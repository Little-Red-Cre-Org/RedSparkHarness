/** Persisted filesystem presentation facts shared by native and compatibility tools. @module */
import { computeHunkDiffs, type FsDiffMeta } from './diff.ts'
import { langFromPath, type FileReadOutcome, type FsReadMeta, type FileTextLine } from './read-render.ts'

/** JSON-serializable projection of the canonical read metadata. */
export type FsReadPresentationMeta = Omit<FsReadMeta, 'lines'> & { lines: Array<Pick<FileTextLine, 'number' | 'text'>> }
/** JSON-serializable projection of the canonical applied-diff metadata. */
export type FsDiffPresentationMeta = { diffs: Array<Pick<FsDiffMeta['diffs'][number], 'path' | 'oldText' | 'newText'>> }

/** Preserve the exact returned read window and its language hint.
 * @param value - successful provider read outcome with its resolved display path.
 * @returns JSON metadata for replaying the same file window.
 */
export function readPresentationMeta(value: FileReadOutcome & { path: string }): FsReadPresentationMeta {
  const lang = langFromPath(value.path)
  return { path: value.path, offset: value.offset,
    lines: value.lines.map(({ number, text }) => ({ number, text })), totalLines: value.totalLines,
    ...lang === undefined ? {} : { lang } }
}

/** Preserve only applied contextual diffs; a newly created file has no previous text.
 * @param path - authored file path stamped on the applied hunks.
 * @param before - actual prior text, or null for a newly created file.
 * @param after - actual committed text.
 * @returns JSON metadata for replaying the applied change.
 */
export function diffPresentationMeta(path: string, before: string | null, after: string): FsDiffPresentationMeta {
  return { diffs: before === null ? [] : computeHunkDiffs(path, before, after)
    .map(({ path, oldText, newText }) => ({ path, oldText, newText })) }
}

/** Preserve an image read's display path; its attachment remains in result content.
 * @param value - successful read outcome with its resolved display path.
 * @returns path-only JSON metadata.
 */
export function imagePresentationMeta(value: { path: string }): Pick<FsReadMeta, 'path'> {
  return { path: value.path }
}
