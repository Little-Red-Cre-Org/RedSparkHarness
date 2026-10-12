/** Cordis-free file operations shared by Native and Cordis Host controllers. */

/** A line page exceeded its configured UTF-8 byte cap. */
export class WorkspaceFilePageTooLargeError extends Error {
  /** Requested path. */
  readonly path: string
  /** Configured page cap. */
  readonly limit: number

  /** @param path - requested file path.
   * @param limit - configured UTF-8 byte cap.
   * @param offset - first requested line.
   * @param last - last requested line.
   */
  constructor(path: string, limit: number, offset: number, last: number) {
    super(`lines ${offset}-${last} of "${path}" exceed the ${limit} byte cap`)
    this.name = 'WorkspaceFilePageTooLargeError'
    this.path = path
    this.limit = limit
  }
}

/** One page cut from a decoded text stream. */
export interface WorkspaceFilePage {
  /** Page lines joined with `\n` and no terminator. */
  readonly text: string
  /** Lines in `text`; `0` for a page past the last line. */
  readonly lines: number
  /** Whether the page includes the final line. */
  readonly eof: boolean
}

/**
 * Cut lines `offset` through `offset + limit - 1`, stopping at the first
 * character past the page so the rest of the file is never read.
 * @param chunks - decoded UTF-8 text chunks from the filesystem.
 * @param offset - first 1-based line in the page.
 * @param limit - maximum number of lines in the page.
 * @param maxBytes - maximum UTF-8 byte count for the returned page.
 * @param path - requested path used in an oversized-page error.
 * @returns the page text, line count and end-of-file flag.
 */
export async function cutWorkspaceFilePage(
  chunks: AsyncIterable<string>,
  offset: number,
  limit: number,
  maxBytes: number,
  path: string,
): Promise<WorkspaceFilePage> {
  const last = offset + limit - 1
  const lines: string[] = []
  let current = ''
  let bytes = 0
  let lineNumber = 1
  const admit = (size: number): void => {
    bytes += size
    if (bytes > maxBytes) throw new WorkspaceFilePageTooLargeError(path, maxBytes, offset, last)
  }
  const complete = (): void => {
    if (lines.length > 0) admit(1)
    lines.push(current)
    current = ''
  }
  for await (const chunk of chunks) {
    let position = 0
    while (position < chunk.length) {
      if (lineNumber > last) return { text: lines.join('\n'), lines: lines.length, eof: false }
      const newline = chunk.indexOf('\n', position)
      const segment = newline === -1 ? chunk.slice(position) : chunk.slice(position, newline)
      if (lineNumber >= offset) {
        admit(Buffer.byteLength(segment, 'utf8'))
        current += segment
      }
      if (newline === -1) break
      if (lineNumber >= offset) complete()
      lineNumber += 1
      position = newline + 1
    }
  }
  if (current.length > 0) complete()
  return { text: lines.join('\n'), lines: lines.length, eof: true }
}
