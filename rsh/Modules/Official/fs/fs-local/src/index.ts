/** Cordis registration for the shared local filesystem backend. */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FileSystem } from '@deepseek-ai/dsh-fs'
import { LocalFileSystemBackend, resolveLocalFilesystemConfig, type Config, type ResolvedConfig } from './backend.ts'
import type { FsDirEntry, FsEditOutcome, FsEditRequest, FsInfo, FsPathInfo, FsTarget, FsVersion, FsWriteIntent, FsWriteOutcome } from '@deepseek-ai/dsh-fs/types'
import type { FsIoInternals } from './fsio.ts'

export type { Config } from './backend.ts'

const defaults = resolveLocalFilesystemConfig(undefined)

/** Local filesystem service; all storage operations belong to one backend instance. */
export class LocalFileSystem extends FileSystem {
  static Config: z<Config> = z.object({
    cwd: z.string().default(defaults.cwd),
    diffBasisMaxBytes: z.number().default(defaults.diffBasisMaxBytes),
  })
  private readonly backend: LocalFileSystemBackend

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.backend = new LocalFileSystemBackend(config as ResolvedConfig)
    ctx.effect(() => () => this.backend.close(), 'fs-local: close owned filesystem operations')
  }

  /** Resolved deployment configuration. */
  get config(): ResolvedConfig { return this.backend.config }
  /** Atomic-publication test hooks shared with the storage backend. */
  get internals(): FsIoInternals { return this.backend.internals }
  set internals(value: FsIoInternals) { this.backend.internals = value }

  override resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    return this.backend.resolve(path, opts)
  }

  override processPath(target: FsTarget): string {
    return this.backend.processPath(target)
  }

  override processPathFromHostPath(hostPath: string): string | undefined {
    return this.backend.processPathFromHostPath(hostPath)
  }

  override fileUrl(target: FsTarget): string {
    return this.backend.fileUrl(target)
  }

  override contains(parent: FsTarget, child: FsTarget): boolean {
    return this.backend.contains(parent, child)
  }

  override stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    return this.backend.stat(target, signal)
  }

  override lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    return this.backend.lstat(path, opts, signal)
  }

  override readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    return this.backend.readText(target, signal)
  }

  override streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    return this.backend.streamText(target, signal)
  }

  override readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    return this.backend.readBytes(target, signal, maxBytes)
  }

  override readByteRange(target: FsTarget, range: { offset: number; length: number }, signal?: AbortSignal): Promise<Uint8Array> {
    return this.backend.readByteRange(target, range, signal)
  }

  override listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    return this.backend.listDir(target, signal)
  }

  override writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal): Promise<FsWriteOutcome> {
    return this.backend.writeText(target, content, expected, signal)
  }

  override editText(
    target: FsTarget, edit: FsEditRequest, expected?: { version: FsVersion }, signal?: AbortSignal,
  ): Promise<FsEditOutcome> {
    return this.backend.editText(target, edit, expected, signal)
  }
}

export default LocalFileSystem
