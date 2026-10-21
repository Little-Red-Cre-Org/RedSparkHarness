/** Native Host provider for the shared session-log archive stream. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeActiveSessionOperations } from '@deepseek-ai/dsh-native-session-execution/active-session-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/native'
import {
  DEFAULT_SESSION_LOG_COMPRESSION_LEVEL,
  readSessionLogAfterFlush,
  streamSessionLogZipManaged,
} from './archive.ts'
import type { ManagedSessionLogZip, SessionLogArchivePorts, SessionLogCompressionLevel } from './archive.ts'
import { sessionLogZipFilename } from './archive.ts'

/** One prepared Native Host export; the caller owns the returned stream. */
export interface NativeSessionLogArchive {
  readonly filename: string
  readonly stream: ReadableStream<Uint8Array>
}

/** Options for one canonical Session archive. */
export interface NativeSessionLogArchiveOptions {
  readonly includeDescendants: boolean
  readonly signal?: AbortSignal
}

/** Public Host capability used by transport adapters to stream Session archives. */
export interface NativeSessionLogExportOperations {
  /**
   * Flush the exact live Session owner, then read its canonical stored log and prepare the ZIP stream.
   * @param sessionId - target Session id.
   * @param options - descendant inclusion and optional cancellation.
   * @returns archive metadata and stream, or `undefined` when the root log does not exist.
   * @throws when a persistence, lineage, or attachment operation fails, or a live owner changes during its read.
   */
  createArchive(
    sessionId: SessionId,
    options: NativeSessionLogArchiveOptions,
  ): Promise<NativeSessionLogArchive | undefined>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { sessionLogExport: NativeSessionLogExportOperations }
}

/** Native Session archive service with admission and stream-producer drain on disposal. */
class NativeSessionLogExportService implements NativeSessionLogExportOperations {
  private readonly abort = new AbortController()
  private readonly operations = new Set<Promise<unknown>>()
  private readonly producers = new Set<ManagedSessionLogZip>()
  private closing = false
  private closePromise: Promise<void> | undefined

  /** @param ports - selected Native Session, persistence, and attachment operations. */
  constructor(
    private readonly ports: SessionLogArchivePorts,
    private readonly compressionLevel: SessionLogCompressionLevel,
    private readonly hostSignal: AbortSignal,
  ) {}

  createArchive(
    sessionId: SessionId,
    options: NativeSessionLogArchiveOptions,
  ): Promise<NativeSessionLogArchive | undefined> {
    if (this.closing || this.hostSignal.aborted) {
      return Promise.reject(new Error('session-log-export: provider is closing'))
    }
    const signal = options.signal === undefined
      ? AbortSignal.any([this.abort.signal, this.hostSignal])
      : AbortSignal.any([this.abort.signal, this.hostSignal, options.signal])
    const operation = Promise.resolve().then(async () => {
      signal.throwIfAborted()
      const rootContent = await readSessionLogAfterFlush(this.ports, sessionId, signal)
      if (rootContent === undefined) return undefined
      signal.throwIfAborted()
      const producer = streamSessionLogZipManaged(
        this.ports,
        rootContent,
        sessionId,
        options.includeDescendants,
        this.compressionLevel,
        signal,
      )
      this.producers.add(producer)
      void producer.done.then(() => this.producers.delete(producer))
      return { filename: sessionLogZipFilename(sessionId), stream: producer.stream }
    })
    this.operations.add(operation)
    const release = (): void => { this.operations.delete(operation) }
    void operation.then(release, release)
    return operation
  }

  /** Stop admission, cancel streams, and await every accepted read and ZIP producer.
   * @returns completion after all accepted work has drained.
   */
  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise
    this.closing = true
    const reason = new Error('session-log-export: provider is closing')
    this.abort.abort(reason)
    const producers = [...this.producers]
    for (const producer of producers) producer.cancel(reason)
    const operations = [...this.operations]
    this.closePromise = Promise.allSettled([
      ...operations,
      ...producers.map(producer => producer.done),
    ]).then(() => {})
    return this.closePromise
  }
}

function resolveCompressionLevel(input: unknown): SessionLogCompressionLevel {
  if (input === undefined) return DEFAULT_SESSION_LOG_COMPRESSION_LEVEL
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('session-log-export: configuration must be an object')
  }
  const config = input as Record<string, unknown>
  if (Object.keys(config).some(key => key !== 'compressionLevel')) {
    throw new Error('session-log-export: unknown configuration field')
  }
  const value = config['compressionLevel']
  if (value === undefined) return DEFAULT_SESSION_LOG_COMPRESSION_LEVEL
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 9) {
    throw new Error('session-log-export: compressionLevel must be an integer from 0 through 9')
  }
  return value as SessionLogCompressionLevel
}

function createFlushPort(active: NativeActiveSessionOperations): SessionLogArchivePorts['flushLiveSession'] {
  return async (id, signal) => {
    signal?.throwIfAborted()
    const matches = active.owners().filter(owner => owner.session.id === id)
    if (matches.length > 1) throw new Error(`session-log-export: multiple active owners for ${id}`)
    const owner = matches[0]
    if (owner === undefined) {
      return () => {
        if (active.owners().some(current => current.session.id === id)) {
          throw new Error(`session-log-export: active owner changed while reading ${id}`)
        }
      }
    }
    await owner.flush()
    signal?.throwIfAborted()
    if (!owner.writerAvailable || active.owner(owner.agent, owner.session) !== owner) {
      throw new Error(`session-log-export: active owner changed while flushing ${id}`)
    }
    return () => {
      if (!owner.writerAvailable || active.owner(owner.agent, owner.session) !== owner) {
        throw new Error(`session-log-export: active owner changed while reading ${id}`)
      }
    }
  }
}

/** Native Provider selected by a Host composition with the canonical query and storage providers. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-session-log-export',
  targets: ['host'],
  requires: ['sessionQuery', 'sessionPersistence', 'attachments', 'activeSessions'],
  provides: ['sessionLogExport'],
  resolve(input) {
    const compressionLevel = resolveCompressionLevel(input)
    return (context) => {
      const active = context.require('activeSessions')
      const ports: SessionLogArchivePorts = {
        sessionQuery: context.require('sessionQuery'),
        sessionPersistence: context.require('sessionPersistence'),
        attachments: context.require('attachments'),
        flushLiveSession: createFlushPort(active),
      }
      const service = new NativeSessionLogExportService(ports, compressionLevel, context.signal)
      context.own(() => service.close())
      context.provide('sessionLogExport', service)
    }
  },
}
