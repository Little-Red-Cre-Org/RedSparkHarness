/** Filesystem-independent query, ranking, and stale-index behavior for providers. */

import type { FileReferenceCandidate } from './types.ts'

/** Default maximum candidates returned for one query. */
export const DEFAULT_FILE_SEARCH_MAX_RESULTS = 20
/** Default maximum entries retained in one workspace index. */
export const DEFAULT_FILE_SEARCH_MAX_ENTRIES = 50_000
/** Directory basenames omitted from traversal; `lib` stays visible for source trees. */
export const DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES = [
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', 'target', '.next', '.nuxt', '.turbo',
  '.venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.gradle',
] as const

/** One direct child returned by a provider's workspace namespace. */
export interface FileReferenceDirectoryEntry {
  /** Child basename. */
  name: string
  /** Whether the child can be descended into or selected as a file. */
  kind: 'file' | 'directory'
}

/** Filesystem operations needed by the shared path-only search index. */
export interface FileReferenceSearchReader {
  /**
   * List one directory in the provider's own namespace, without following links.
   * @param directory - workspace-relative or provider-supported display path.
   * @param signal - cancels this listing.
   * @returns direct file and directory entries; special files are omitted.
   */
  listDirectory(directory: string, signal: AbortSignal): Promise<readonly FileReferenceDirectoryEntry[]>
}

/** Bounds and exclusions for one workspace index. */
export interface FileReferenceSearchConfig {
  /** Maximum ranked candidates returned for one query. */
  maxResults: number
  /** Maximum file and directory candidates retained in the fuzzy index. */
  maxEntries: number
  /** Directory basenames omitted from traversal and results. */
  excludedDirectories: readonly string[]
}

interface IndexGeneration {
  controller: AbortController
  promise: Promise<FileReferenceCandidate[]>
}

interface SettledIndex {
  entries: FileReferenceCandidate[]
  startedAt: number
}

interface RankedPath {
  candidate: FileReferenceCandidate
  score: number
}

/**
 * Shared cancellable fuzzy index over a provider-owned workspace reader.
 * Direct directory queries stay live; bare fuzzy queries use one bounded,
 * reusable traversal and rebuild invalidated results behind the current query.
 */
export class FileReferenceSearchIndex {
  private readonly excludedDirectories: ReadonlySet<string>
  private settled: SettledIndex | undefined
  private generation: IndexGeneration | undefined
  private invalidations = 0
  private disposed = false

  /** @param reader - the provider's namespace-limited direct-directory reader. @param config - result, index, and exclusion bounds. */
  constructor(private readonly reader: FileReferenceSearchReader, private readonly config: FileReferenceSearchConfig) {
    if (!Number.isSafeInteger(config.maxResults) || config.maxResults <= 0) {
      throw new Error('file reference search maxResults must be a positive safe integer')
    }
    if (!Number.isSafeInteger(config.maxEntries) || config.maxEntries <= 0) {
      throw new Error('file reference search maxEntries must be a positive safe integer')
    }
    if (config.excludedDirectories.some(name => name.length === 0 || name.includes('/') || name.includes('\\'))) {
      throw new Error('file reference search excludedDirectories entries must be non-empty directory basenames')
    }
    this.excludedDirectories = new Set(config.excludedDirectories)
  }

  /**
   * Return ranked path candidates for the current token.
   * @param rawQuery - path text following `@` or `@"`.
   * @param signal - cancels this caller's wait without cancelling other readers.
   * @returns at most `maxResults` deterministic candidates.
   */
  async list(rawQuery: string, signal: AbortSignal): Promise<FileReferenceCandidate[]> {
    signal.throwIfAborted()
    if (this.disposed) return []
    const query = rawQuery.replaceAll('\\', '/')
    const slash = query.lastIndexOf('/')
    if (query === '' || slash >= 0) {
      const directory = slash < 0 ? '' : query.slice(0, slash + 1)
      const fragment = slash < 0 ? '' : query.slice(slash + 1)
      return this.listDirectory(directory, fragment, signal)
    }
    const indexed = await this.indexFor(signal)
    return rankCandidates(
      indexed.filter(candidate => visibleForGlobalQuery(candidate.path, query)),
      query,
      this.config.maxResults,
    )
  }

  /** Mark the index stale so a later bare query observes a fresh tree. */
  invalidate(): void {
    this.invalidations += 1
  }

  /** Abort traversal and make later queries return no candidates. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation?.controller.abort(new Error('file reference search index disposed'))
    this.generation = undefined
    this.settled = undefined
  }

  private async indexFor(signal: AbortSignal): Promise<readonly FileReferenceCandidate[]> {
    const settled = this.settled
    if (settled === undefined) return waitForPromise(this.ensureIndex(), signal)
    if (settled.startedAt < this.invalidations) {
      void this.ensureIndex().catch(() => {
        // The stale index remains usable; a later query retries a failed refresh.
      })
    }
    return settled.entries
  }

  private ensureIndex(): Promise<FileReferenceCandidate[]> {
    if (this.generation !== undefined) return this.generation.promise
    const controller = new AbortController()
    const startedAt = this.invalidations
    const generation: IndexGeneration = { controller, promise: Promise.resolve([]) }
    generation.promise = this.scanWorkspace(controller.signal).then(
      (entries) => {
        if (!this.disposed) {
          this.generation = undefined
          this.settled = { entries, startedAt }
        }
        return entries
      },
      (error: unknown) => {
        if (this.generation === generation) this.generation = undefined
        throw error
      },
    )
    this.generation = generation
    return generation.promise
  }

  private async scanWorkspace(signal: AbortSignal): Promise<FileReferenceCandidate[]> {
    const indexed: FileReferenceCandidate[] = []
    const directories = ['']
    for (let cursor = 0; cursor < directories.length && indexed.length < this.config.maxEntries; cursor += 1) {
      signal.throwIfAborted()
      const directory = directories[cursor]
      if (directory === undefined) throw new Error('file reference search selected a missing directory')
      const entries = cursor === 0
        ? await this.readDirectory(directory, signal)
        : await this.readSubdirectory(directory, signal)
      for (const entry of sortDirectoryEntries(entries)) {
        signal.throwIfAborted()
        const path = directory === '' ? entry.name : `${directory}${entry.name}`
        if (entry.kind === 'directory') {
          if (this.excludedDirectories.has(entry.name)) continue
          indexed.push({ path, kind: 'directory' })
          directories.push(`${path}/`)
        } else {
          indexed.push({ path, kind: 'file' })
        }
        if (indexed.length >= this.config.maxEntries) break
      }
    }
    return indexed
  }

  private async readSubdirectory(directory: string, signal: AbortSignal): Promise<readonly FileReferenceDirectoryEntry[]> {
    try {
      return await this.readDirectory(directory, signal)
    } catch {
      signal.throwIfAborted()
      return []
    }
  }

  private async listDirectory(
    displayDirectory: string,
    fragment: string,
    signal: AbortSignal,
  ): Promise<FileReferenceCandidate[]> {
    if (displayDirectory.split('/').some(segment => this.excludedDirectories.has(segment))) return []
    let entries: readonly FileReferenceDirectoryEntry[]
    try {
      entries = await this.readDirectory(displayDirectory, signal)
    } catch {
      signal.throwIfAborted()
      return []
    }
    const candidates: FileReferenceCandidate[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.') && !fragment.startsWith('.')) continue
      if (entry.kind === 'directory') {
        if (this.excludedDirectories.has(entry.name)) continue
        candidates.push({ path: `${displayDirectory}${entry.name}`, kind: 'directory' })
      } else {
        candidates.push({ path: `${displayDirectory}${entry.name}`, kind: 'file' })
      }
    }
    return rankCandidates(candidates, fragment, this.config.maxResults)
  }

  private async readDirectory(directory: string, signal: AbortSignal): Promise<readonly FileReferenceDirectoryEntry[]> {
    signal.throwIfAborted()
    return this.reader.listDirectory(directory, signal)
  }
}

function visibleForGlobalQuery(path: string, query: string): boolean {
  if (query.startsWith('.') || query.includes('/.')) return true
  return !path.split('/').some(segment => segment.startsWith('.'))
}

function rankCandidates(
  candidates: readonly FileReferenceCandidate[],
  query: string,
  limit: number,
): FileReferenceCandidate[] {
  const ranked: RankedPath[] = []
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, query)
    if (score !== undefined) ranked.push({ candidate, score })
  }
  ranked.sort((left, right) =>
    right.score - left.score
    || kindRank(left.candidate.kind) - kindRank(right.candidate.kind)
    || (query === '' ? 0 : left.candidate.path.length - right.candidate.path.length)
    || compareText(left.candidate.path, right.candidate.path))
  return ranked.slice(0, limit).map(entry => entry.candidate)
}

function scoreCandidate(candidate: FileReferenceCandidate, query: string): number | undefined {
  if (query === '') return 0
  const path = candidate.path.toLowerCase()
  const name = path.slice(path.lastIndexOf('/') + 1)
  const needle = query.toLowerCase()
  const directoryBonus = candidate.kind === 'directory' ? 25 : 0
  if (name === needle) return 1_000 + directoryBonus
  if (name.startsWith(needle)) return 900 + directoryBonus
  if (name.includes(needle)) return 700 + directoryBonus
  if (path.includes(needle)) return 500 + directoryBonus
  const subsequence = subsequenceScore(path, needle)
  return subsequence === undefined ? undefined : 300 + subsequence + directoryBonus
}

function subsequenceScore(target: string, query: string): number | undefined {
  let targetIndex = 0
  let gap = 0
  for (const character of query) {
    const found = target.indexOf(character, targetIndex)
    if (found < 0) return undefined
    gap += found - targetIndex
    targetIndex = found + 1
  }
  return Math.max(0, 100 - gap)
}

function kindRank(kind: FileReferenceCandidate['kind']): number {
  return kind === 'directory' ? 0 : 1
}

function sortDirectoryEntries(entries: readonly FileReferenceDirectoryEntry[]): FileReferenceDirectoryEntry[] {
  return [...entries].sort((left, right) =>
    compareText(left.name, right.name) || kindRank(left.kind) - kindRank(right.kind))
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function waitForPromise<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(errorReason(signal.reason, 'file search aborted'))
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const onAbort = (): void => { rejectPromise(errorReason(signal.reason, 'file search aborted')) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolvePromise(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        rejectPromise(errorReason(error, 'file reference search index failed'))
      },
    )
  })
}

function errorReason(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback, { cause: reason })
}
