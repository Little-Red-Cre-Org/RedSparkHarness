/**
 * Host-filesystem implementation of `ctx.fs`. Realpath-derived target identity makes aliases
 * share stale guards, and writes through a symlink update its target without replacing the link.
 * @module @deepseek-ai/dsh-fs-local
 */

import { constants as bufferConstants } from 'node:buffer'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FileSystemOperations } from '@deepseek-ai/dsh-fs/operations'
import { FsError, FsVersion } from '@deepseek-ai/dsh-fs/types'
import type {
  FsDirEntry,
  FsEditOutcome,
  FsEditRequest,
  FsInfo,
  FsPathInfo,
  FsTarget,
  FsWriteIntent,
  FsWriteOutcome,
} from '@deepseek-ai/dsh-fs/types'
import {
  applyLiteralEdit,
  listDirectory,
  normalizeLineEndings,
  probe,
  probeNoFollow,
  readForEdit,
  readByteWindow,
  readTextForDiff,
  readWholeBytes,
  readWholeText,
  resolveLocalTarget,
  restoreLineEndings,
  streamWholeText,
  writeFileAtomic,
} from './fsio.ts'
import type { FsIoInternals } from './fsio.ts'

/** Configuration for the local filesystem backend. */
export interface Config {
  /** Base directory for relative paths. Defaults to `process.cwd()`. */
  cwd?: string
  /**
   * Exclusive UTF-8 byte limit on each overwrite-diff side, capped by the
   * runtime's safe allocation/decode maximum. Defaults to 10 MiB.
   */
  diffBasisMaxBytes?: number
}

/** Fully specified local storage configuration; callers resolve defaults before construction. */
export type ResolvedConfig = Readonly<Required<Config>>
const MAX_DIFF_BASIS_BYTES = Math.min(
  bufferConstants.MAX_LENGTH,
  bufferConstants.MAX_STRING_LENGTH,
)

function validateDiffLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_DIFF_BASIS_BYTES) {
    throw new Error(`fs-local: diffBasisMaxBytes must be a positive safe integer no greater than ${MAX_DIFF_BASIS_BYTES}`)
  }
}

/**
 * Validate deployment configuration and capture defaults before backend activation.
 * @param input - absent configuration or an object containing cwd and diffBasisMaxBytes.
 * @returns immutable absolute-path configuration with an allocation-safe diff limit.
 */
export function resolveLocalFilesystemConfig(input: unknown): ResolvedConfig {
  const value = input === undefined ? {} : input
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('fs-local: configuration must be an object')
  const config = value as Record<string, unknown>
  for (const key of Object.keys(config)) {
    if (key !== 'cwd' && key !== 'diffBasisMaxBytes') throw new Error(`fs-local: unknown configuration field ${key}`)
  }
  const cwd = config.cwd === undefined ? process.cwd() : config.cwd
  const diffBasisMaxBytes = config.diffBasisMaxBytes === undefined ? 10 * 1024 * 1024 : config.diffBasisMaxBytes
  if (typeof cwd !== 'string') throw new Error('fs-local: cwd must be a string')
  if (typeof diffBasisMaxBytes !== 'number') throw new Error('fs-local: diffBasisMaxBytes must be a number')
  validateDiffLimit(diffBasisMaxBytes)
  return Object.freeze({ cwd: resolve(cwd), diffBasisMaxBytes })
}

/**
 * The host-filesystem backend. Reads resolve relative paths from {@link Config.cwd}
 * (a resolution default, NOT a containment boundary — see the filesystem
 * capability-seam Agent Note); enforce
 * containment with a stricter backend or a `tools/execute` permission plugin.
 */
export class LocalFileSystemBackend extends FileSystemOperations {
  private readonly controller = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly streams = new Map<symbol, AsyncGenerator<string, undefined>>()
  private shutdown: Promise<void> | undefined

  /** Explicit validated configuration owned by this backend. */
  readonly config: ResolvedConfig
  /** Test hook forwarded to fsio for atomic-publication boundaries. */
  internals: FsIoInternals = {}
  /** Per-targetKey tail promise: serializes mutating ops so the read→guard→write
   * window can't interleave, making concurrent writes/edits deterministically
   * ordered (one wins, the rest see the new version and reject as stale). */
  private locks = new Map<string, Promise<unknown>>()

  constructor(config: ResolvedConfig) {
    super()
    validateDiffLimit(config.diffBasisMaxBytes)
    this.config = Object.freeze({ ...config })
  }

  private checkAbort(signal: AbortSignal, operation: string): void {
    if (signal.aborted) throw new FsError(`${operation} aborted`, 'FS_ABORTED')
  }

  private run<T>(signal: AbortSignal | undefined, operation: (ownedSignal: AbortSignal) => Promise<T>): Promise<T> {
    const ownedSignal = signal === undefined ? this.controller.signal : AbortSignal.any([this.controller.signal, signal])
    const work = Promise.resolve().then(() => {
      this.checkAbort(ownedSignal, 'filesystem operation')
      return operation(ownedSignal)
    })
    this.pending.add(work)
    // The operation caller owns its failure; shutdown waits for settlement without reporting it twice.
    void work.then(() => this.pending.delete(work), () => this.pending.delete(work))
    return work
  }

  /**
   * Reject new I/O, abort owned operations and close open text iterators before resolving.
   * Already published writes remain committed; operation errors belong to their callers.
   * @returns shared shutdown completion after admitted I/O and stream cleanup settle.
   */
  close(): Promise<void> {
    this.controller.abort()
    return this.shutdown ??= Promise.resolve().then(async () => {
      await Promise.allSettled([...this.pending, ...[...this.streams.values()].map(stream => stream.return(undefined))])
      this.streams.clear()
    })
  }

  /** Run `op` with exclusive access to `targetKey` (FIFO per key). */
  private async withLock<T>(targetKey: string, op: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(targetKey) ?? Promise.resolve()
    const run = prior.then(op, op)
    // Keep the chain alive but swallow this op's result/throw for the *next* waiter.
    const tail = run.then(() => undefined, () => undefined)
    this.locks.set(targetKey, tail)
    try {
      return await run
    } finally {
      if (this.locks.get(targetKey) === tail) {
        this.locks.delete(targetKey)
      }
    }
  }

  override async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    return this.run(opts?.signal, async (ownedSignal) => {
      this.checkAbort(ownedSignal, 'resolve')
      const local = await resolveLocalTarget(opts?.cwd ?? this.config.cwd, path)
      this.checkAbort(ownedSignal, 'resolve')
      return { targetKey: local.targetKey, displayPath: local.displayPath }
    })
  }

  override processPath(target: FsTarget): string {
    return String(target.targetKey)
  }

  override processPathFromHostPath(hostPath: string): string | undefined {
    return isAbsolute(hostPath) ? resolve(hostPath) : undefined
  }

  override fileUrl(target: FsTarget): string {
    return pathToFileURL(this.processPath(target)).href
  }

  override contains(parent: FsTarget, child: FsTarget): boolean {
    const path = relative(this.processPath(parent), this.processPath(child))
    return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  }

  override async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    return this.run(signal, async (ownedSignal) => {
      this.checkAbort(ownedSignal, 'stat')
      const info = await probe(target.targetKey)
      this.checkAbort(ownedSignal, 'stat')
      if (!info) return undefined
      return { version: info.version, type: info.type, size: info.size }
    })
  }

  override async lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    return this.run(signal, async (ownedSignal) => {
      this.checkAbort(ownedSignal, 'lstat')
      if (path.trim().length === 0) throw new FsError('file_path must be a non-empty string', 'FS_NOT_FOUND')
      const info = await probeNoFollow(resolve(opts?.cwd ?? this.config.cwd, path))
      this.checkAbort(ownedSignal, 'lstat')
      if (!info) return undefined
      return { version: info.version, type: info.type, size: info.size }
    })
  }

  override async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    return this.run(signal, async (ownedSignal) => {
      return readWholeText({ displayPath: target.displayPath, targetKey: target.targetKey }, ownedSignal)
    })
  }

  override streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    return this.run(signal, (ownedSignal) => {
      const streams = this.streams
      const identity = Symbol('filesystem stream')
      const iterator = (async function* () {
        try {
          yield* streamWholeText({ displayPath: target.displayPath, targetKey: target.targetKey }, ownedSignal)
        } finally {
          streams.delete(identity)
        }
        return undefined
      })()
      streams.set(identity, iterator)
      return Promise.resolve(iterator)
    })
  }

  override async readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    return this.run(signal, async (ownedSignal) => {
      return readWholeBytes({ displayPath: target.displayPath, targetKey: target.targetKey }, ownedSignal, maxBytes, this.internals)
    })
  }

  override async readByteRange(target: FsTarget, range: { offset: number; length: number }, signal?: AbortSignal): Promise<Uint8Array> {
    return this.run(signal, async (ownedSignal) => {
      return readByteWindow({ displayPath: target.displayPath, targetKey: target.targetKey }, range, ownedSignal)
    })
  }

  override async listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    return this.run(signal, async (ownedSignal) => {
      const entries = await listDirectory({ displayPath: target.displayPath, targetKey: target.targetKey }, ownedSignal)
      return entries.map(entry => ({
        name: entry.name,
        type: entry.type,
        target: { targetKey: entry.target.targetKey, displayPath: entry.target.displayPath },
        ...(entry.version !== undefined ? { version: entry.version } : {}),
        ...(entry.size !== undefined ? { size: entry.size } : {}),
      }))
    })
  }

  override async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
  ): Promise<FsWriteOutcome> {
    return this.run(signal, async (ownedSignal) => {
      return this.withLock(target.targetKey, async () => {
        const existing = await probe(target.targetKey)
        if (existing && existing.type !== 'file') {
          throw new FsError(`cannot write "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
        }

        if (expected?.kind === 'replaceIfVersion') {
          // Stale guard: the file must still exist at the version the owner observed.
          if (!existing) throw new FsError(`cannot write "${target.displayPath}": file no longer exists`, 'FS_STALE_VERSION')
          if (existing.version !== expected.version) {
            throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
          }
        } else if (expected?.kind === 'createIfAbsent' && existing) {
          // createIfAbsent onto an existing file: a blind overwrite — require a read first.
          throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, 'FS_NOT_OBSERVED')
        }
        // No expectation means an unconditional but still atomic write.

        // Capture an optional contextual-diff basis before the write. The bounded
        // reader checks the opened file itself, so an external replacement after
        // `probe()` cannot turn this best-effort presentation read into an
        // unbounded allocation. Either side at/above the configured limit yields
        // `before: null`; consumers retain their whole-file fallback.
        const diffable = existing !== null
          && Buffer.byteLength(content, 'utf8') < this.config.diffBasisMaxBytes
        const before = diffable
          ? await readTextForDiff(target.targetKey, this.config.diffBasisMaxBytes, ownedSignal)
          : null
        await writeFileAtomic(
          target.targetKey,
          content,
          existing?.mode,
          ownedSignal,
          this.internals,
          expected?.kind === 'createIfAbsent' ? { displayPath: target.displayPath } : undefined,
        )
        const after = await probe(target.targetKey)
        return {
          operation: existing ? 'update' : 'create',
          version: this.versionAfterWrite(after, target),
          before,
          // LF-normalized to share the diff basis with `before` (also LF): a CRLF
          // overwrite must not read as every line changed. Line-ending restoration
          // is a storage detail the applied-hunk diff ignores.
          after: normalizeLineEndings(content),
        }
      })
    })
  }

  override async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
  ): Promise<FsEditOutcome> {
    return this.run(signal, async (ownedSignal) => {
      return this.withLock(target.targetKey, async () => {
        const existing = await probe(target.targetKey)
        // Stale guard before literal matching: an edit based on an old read reports
        // FS_STALE_VERSION, not FS_EDIT_NOT_FOUND/FS_AMBIGUOUS_EDIT against newer content.
        // Missing targets use the same stale code on guarded and unconditional edit paths.
        if (!existing) throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
        if (existing.type !== 'file') throw new FsError(`cannot edit "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
        // expected === undefined: unconditional edit of the current content — no
        // version guard. Still inside the per-target lock, so the read→match→write
        // window is serialized and atomic.
        if (expected && existing.version !== expected.version) {
          throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
        }

        const original = await readForEdit(target.targetKey, target.displayPath, ownedSignal)
        const edited = applyLiteralEdit(original.content, edit.oldString, edit.newString, edit.replaceAll, target.displayPath)
        const content = restoreLineEndings(edited.content, original.lineEndings)
        await writeFileAtomic(target.targetKey, content, existing.mode, ownedSignal, this.internals)

        const after = await probe(target.targetKey)
        return {
          version: this.versionAfterWrite(after, target),
          // The LF-normalized before/after text (the applied-hunk diff basis);
          // line-ending restoration is a storage detail the diff ignores.
          before: original.content,
          after: edited.content,
        }
      })
    })
  }

  /* v8 ignore next 5 -- the post-write probe finding the file absent requires a
   * concurrent unlink between rename and stat; fall back to a sentinel version. */
  private versionAfterWrite(after: { version: FsVersion } | null, target: FsTarget): FsVersion {
    if (after) return after.version
    return FsVersion(`missing:${target.targetKey}`)
  }
}

export default LocalFileSystemBackend
