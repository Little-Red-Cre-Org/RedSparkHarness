/**
 * Cordis adapter for the E2B filesystem backend.
 * @module @redspark/rsh-fs-e2b
 */

import { Context } from '@redspark/cordis'
import type {} from '@redspark/rsh-e2b'
import { FileSystem } from '@redspark/rsh-fs'
import type {
  FsDirEntry,
  FsEditOutcome,
  FsEditRequest,
  FsInfo,
  FsPathInfo,
  FsTarget,
  FsVersion,
  FsWriteIntent,
  FsWriteOutcome,
} from '@redspark/rsh-fs/types'
import { E2BFileSystemBackend } from './backend.ts'

/** Remote filesystem service sharing the sandbox owned by `ctx.e2b`. */
export class E2BFileSystem extends FileSystem {
  static inject = ['e2b']

  private readonly backend: E2BFileSystemBackend

  /**
   * Forward filesystem operations to the shared sandbox backend.
   * @param ctx - Cordis context whose `e2b` service owns the sandbox.
   */
  constructor(ctx: Context) {
    super(ctx)
    this.backend = new E2BFileSystemBackend(ctx.e2b)
  }

  override resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    return this.backend.resolve(path, opts)
  }

  override processPath(target: FsTarget): string {
    return this.backend.processPath(target)
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

  override readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    return this.backend.readBytes(target, signal, maxBytes)
  }

  override readByteRange(target: FsTarget, range: { offset: number; length: number }, signal?: AbortSignal): Promise<Uint8Array> {
    return this.backend.readByteRange(target, range, signal)
  }

  override streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    return this.backend.streamText(target, signal)
  }

  override listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    return this.backend.listDir(target, signal)
  }

  override writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
  ): Promise<FsWriteOutcome> {
    return this.backend.writeText(target, content, expected, signal)
  }

  override editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
  ): Promise<FsEditOutcome> {
    return this.backend.editText(target, edit, expected, signal)
  }
}

export default E2BFileSystem
