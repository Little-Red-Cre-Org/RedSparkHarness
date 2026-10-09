/** Host-filesystem adapter for the shared file-reference search algorithm. */

import { lstat, readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  DEFAULT_FILE_SEARCH_MAX_RESULTS,
  FileReferenceSearchIndex,
  type FileReferenceDirectoryEntry,
  type FileReferenceSearchConfig,
  type FileReferenceSearchReader,
} from '@deepseek-ai/dsh-file-reference/search'

export {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  DEFAULT_FILE_SEARCH_MAX_RESULTS,
}
export type FileSearchConfig = FileReferenceSearchConfig
export { activeAtToken, formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'

class LocalWorkspaceReader implements FileReferenceSearchReader {
  private readonly root: string

  constructor(root: string) { this.root = resolve(root) }

  async listDirectory(displayDirectory: string, signal: AbortSignal): Promise<readonly FileReferenceDirectoryEntry[]> {
    const absolute = await resolveDisplayDirectory(this.root, displayDirectory, signal)
    if (absolute === undefined) return []
    signal.throwIfAborted()
    const entries = await readdir(absolute, { withFileTypes: true })
    signal.throwIfAborted()
    return entries.sort((left, right) => compareText(left.name, right.name)).flatMap((entry): FileReferenceDirectoryEntry[] => {
      if (entry.isDirectory()) return [{ name: entry.name, kind: 'directory' as const }]
      if (entry.isFile()) return [{ name: entry.name, kind: 'file' as const }]
      return []
    })
  }
}

/**
 * Cancellable fuzzy search rooted at one Agent's working directory. The shared
 * index owns ranking and invalidation; this adapter supplies only safe local listings.
 */
export class WorkspaceFileSearch extends FileReferenceSearchIndex {
  constructor(root: string, config: FileSearchConfig) {
    super(new LocalWorkspaceReader(root), config)
  }

  override list(rawQuery: string, signal: AbortSignal) {
    return super.list(rawQuery, signal)
  }

  override invalidate(): void { super.invalidate() }
  override dispose(): void { super.dispose() }
}

async function resolveDisplayDirectory(
  root: string,
  displayDirectory: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const absolute = resolve(root, displayDirectory === '' ? '.' : displayDirectory)
  const fromRoot = relative(root, absolute)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return undefined
  let current = root
  for (const segment of fromRoot.split(sep).filter(Boolean)) {
    signal.throwIfAborted()
    current = join(current, segment)
    try {
      const status = await lstat(current)
      signal.throwIfAborted()
      if (status.isSymbolicLink() || !status.isDirectory()) return undefined
    } catch (_error: unknown) {
      signal.throwIfAborted()
      return undefined
    }
  }
  return absolute
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
