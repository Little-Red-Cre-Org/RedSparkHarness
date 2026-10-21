/**
 * Host-side session-log download: streams one ZIP archive whose files are the
 * sessions' logical session logs plus every referenced attachment. Each log
 * is read through a persistence read handle and serialized here as canonical
 * JSONL — one header line, then one line per validated event — so every
 * backend (JSONL, SQLite, future) exports identically. The root log uses the
 * current generation's canonical `session[.vN].jsonl` name; each subagent
 * descendant uses `subagents/<id>/session[.vN].jsonl`; each image referenced by any included log
 * under `media/<attachmentId>.<ext>` (content-addressed, so one archive never
 * duplicates a shared image); each generic file sits under
 * `files/<prefix>/<digest>/<name>` and streams from the attachment store. No
 * manifest is written. The selected Host adapter flushes each live Session
 * before its log read; cold sessions need no barrier. Request or provider abort
 * and response-consumer cancellation stop the same producer and compressor.
 * Compression runs on the host with fflate's streaming Zip API, so the archive
 * bytes are produced incrementally and the host never holds the whole archive
 * in one buffer; production waits for consumer pull whenever the response queue
 * reaches its byte high-water mark, so a slow consumer bounds accumulation to
 * the fixed 64 KiB response queue plus one synchronous fflate push.
 * @module
 */

import { Zip, ZipDeflate } from 'fflate'
import type {
  AttachmentOperations, FileAttachmentRef, ImageAttachmentRef,
} from '@deepseek-ai/dsh-attachment/native'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/types'
import { sessionFormatLogFilename } from '@deepseek-ai/dsh-session-format'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session/native'
import type { NativeSessionPersistenceOperations, SessionHandle } from '@deepseek-ai/dsh-session-persistence/native'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence/native'
import type { SessionLineageNode, SessionQueryOperations } from '@deepseek-ai/dsh-session-query/native'

/** Valid fflate DEFLATE levels accepted by session-log export. */
export type SessionLogCompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/** Balanced default used when Session export configuration omits a compression level. */
export const DEFAULT_SESSION_LOG_COMPRESSION_LEVEL: SessionLogCompressionLevel = 6

/** Exact active-session binding rechecked after its canonical persistence read. */
export type SessionLogFlushReceipt = () => void

/** Cordis-free providers consumed by the shared archive algorithm. */
export interface SessionLogArchivePorts {
  readonly sessionQuery: Pick<SessionQueryOperations, 'traceSession'>
  readonly sessionPersistence: Pick<NativeSessionPersistenceOperations, 'open'>
  readonly attachments: Pick<AttachmentOperations, 'readImage' | 'readFileStream'>
  /** Flushes a live Session and may return a check that rejects owner replacement during the read. */
  readonly flushLiveSession: (id: SessionId, signal?: AbortSignal) => Promise<SessionLogFlushReceipt | undefined>
}

/** One exported file: a serialized session log or one referenced attachment object. */
export type SessionLogZipEntry =
  | { readonly path: string; readonly content: string }
  | { readonly path: string; readonly data: Uint8Array }
  | { readonly path: string; readonly chunks: AsyncIterable<Uint8Array> }

/** The current generation's canonical base filename for every exported session log. */
export const SESSION_LOG_FILENAME = sessionFormatLogFilename(SESSION_FORMAT_VERSION)

/**
 * Serialize one session's logical log as canonical JSONL text: the header
 * line, then one line per event, with a trailing newline.
 * @param header - the session's immutable header.
 * @param events - the validated committed events in seq order.
 * @returns the JSONL text.
 */
export function serializeSessionLog(
  header: SessionHeader,
  events: readonly SessionEvent[],
): string {
  // Match the current v2 physical header. The inherited cut is already
  // represented by the tagged session/end-seed event in `events`;
  // `delegationDepth` is required on disk, so an omitted top-level depth is 0.
  /* jscpd:ignore-start -- deliberately mirrors the JSONL backend's
     `toHeaderLine`: the exported text is the canonical v2 physical header
     line, and this backend-agnostic package must not depend on one backend
     implementation. */
  const lines = [JSON.stringify({
    type: 'session',
    version: header.version,
    id: header.id,
    createdAt: header.createdAt,
    ...header.cwd !== undefined ? { cwd: header.cwd } : {},
    ...header.parentSession !== undefined ? { parentSession: header.parentSession } : {},
    isSeeded: header.isSeeded,
    ...header.origin !== undefined ? { origin: header.origin } : {},
    delegationDepth: header.delegationDepth ?? 0,
    ...header.agentPreset !== undefined ? { agentPreset: header.agentPreset } : {},
  })]
  /* jscpd:ignore-end */
  for (const event of events) lines.push(JSON.stringify(event))
  return `${lines.join('\n')}\n`
}

/**
 * Read one session's complete logical log through a read handle and serialize
 * it. The read observes the committed log only — persistence never returns a
 * torn tail — and a handle read after a resolved flush observes at least the
 * flushed prefix.
 * @param persistence - the mounted persistence backend.
 * @param id - the session to read.
 * @param signal - optional cancellation forwarded to the open and read.
 * @returns the serialized JSONL text, or `undefined` when the session does not exist.
 */
export async function readSessionLogText(
  persistence: Pick<NativeSessionPersistenceOperations, 'open'>,
  id: SessionId,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const options = signal === undefined ? {} : { signal }
  let handle: SessionHandle
  try {
    handle = await persistence.open(id, 'read', options)
  } catch (error) {
    // Absence is `open`'s decision; every other failure (corruption,
    // unsupported format, I/O, cancellation) stays fail-loud.
    if (error instanceof SessionPersistenceNotFoundError) return undefined
    throw error
  }
  try {
    const { events } = await handle.read(0, undefined, options)
    return serializeSessionLog(handle.header, events)
  } finally {
    await handle.close()
  }
}

/** Flush through the selected Host adapter, then recheck an exact owner when the adapter supplies a receipt.
 * @param ports - the archive's canonical query, persistence, and flush operations.
 * @param id - the Session to read.
 * @param signal - optional cancellation for flush, open, and read.
 * @returns canonical JSONL text, or `undefined` when the Session is absent.
 */
export async function readSessionLogAfterFlush(
  ports: SessionLogArchivePorts,
  id: SessionId,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const receipt = await ports.flushLiveSession(id, signal)
  const content = await readSessionLogText(ports.sessionPersistence, id, signal)
  signal?.throwIfAborted()
  receipt?.()
  return content
}

/** Zip extension for each accepted raster media type. */
const MEDIA_TYPE_EXTENSIONS: Record<ImageAttachmentRef['mediaType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * The zip path for one media object: content-addressed by the opaque
 * attachment id so shared images land once and the id in the log maps back to
 * the archive entry without a manifest.
 * @param ref - the durable reference from a session log.
 * @returns the archive path.
 */
function mediaEntryPath(ref: ImageAttachmentRef): string {
  return `media/${String(ref.attachmentId)}.${MEDIA_TYPE_EXTENSIONS[ref.mediaType]}`
}

/** Archive path that preserves one stored file reference's digest and name. */
function fileEntryPath(ref: FileAttachmentRef): string {
  const digest = String(ref.attachmentId).replace(/^sha256:/u, '')
  const name = ref.name.replace(/[\\/\u0000-\u001f\u007f]/gu, '_')
  const safeName = name === '.' || name === '..' || name === '' ? 'file' : name
  return `files/${digest.slice(0, 2)}/${digest}/${safeName}`
}

/**
 * Collect every attachment reference inside one content array, descending into
 * nested tool results the way the live attachment route does.
 * @param content - an event content array (or nested tool-result content).
 * @param images - image dedupe map keyed by attachment id.
 * @param files - file dedupe map keyed by attachment id and stored name.
 */
function collectAttachmentRefs(
  content: unknown,
  images: Map<string, ImageAttachmentRef>,
  files: Map<string, FileAttachmentRef>,
): void {
  if (!Array.isArray(content)) return
  const pending: unknown[] = []
  for (const item of content) pending.push(item)
  while (pending.length > 0) {
    const value = pending.pop()
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const block = value as { type?: unknown; attachment?: unknown; content?: unknown }
    if (block.type === 'image' && typeof block.attachment === 'object' && block.attachment !== null) {
      const ref = block.attachment as ImageAttachmentRef
      images.set(String(ref.attachmentId), ref)
    }
    if (block.type === 'file' && typeof block.attachment === 'object' && block.attachment !== null) {
      const ref = block.attachment as FileAttachmentRef
      files.set(`${String(ref.attachmentId)}\u0000${ref.name}`, ref)
    }
    if (Array.isArray(block.content)) {
      for (const item of block.content) pending.push(item)
    }
  }
}

/**
 * Collect every attachment reference one session event carries, across the same
 * carriers the live attachment route scans (direct content, message content,
 * inserted messages, and completed blocks in embedded Assistant streams).
 * @param event - one parsed JSONL event object.
 * @param images - image dedupe map keyed by attachment id.
 * @param files - file dedupe map keyed by attachment id and stored name.
 */
function collectEventAttachmentRefs(
  event: unknown,
  images: Map<string, ImageAttachmentRef>,
  files: Map<string, FileAttachmentRef>,
): void {
  const data = (event as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return
  const carrier = data as {
    content?: unknown
    message?: { content?: unknown }
    inserted?: Array<{ content?: unknown }>
    stream?: Array<{ type?: unknown; chunk?: { type?: unknown; block?: unknown } }>
  }
  collectAttachmentRefs(carrier.content, images, files)
  if (carrier.message !== undefined) collectAttachmentRefs(carrier.message.content, images, files)
  if (carrier.inserted !== undefined) {
    for (const message of carrier.inserted) collectAttachmentRefs(message.content, images, files)
  }
  if (carrier.stream !== undefined) {
    for (const record of carrier.stream) {
      if (record.type === 'chunk' && record.chunk?.type === 'block-end') {
        collectAttachmentRefs([record.chunk.block], images, files)
      }
    }
  }
}

/**
 * Collect the distinct attachment references one stored artifact text names.
 * Lines that fail to parse cannot reference attachments and are skipped (the
 * artifact text itself is exported verbatim regardless).
 * @param content - the stored artifact text.
 * @returns image and file dedupe maps.
 */
function attachmentRefsInArtifact(content: string): {
  readonly images: Map<string, ImageAttachmentRef>
  readonly files: Map<string, FileAttachmentRef>
} {
  const images = new Map<string, ImageAttachmentRef>()
  const files = new Map<string, FileAttachmentRef>()
  for (const line of content.split('\n')) {
    if (line === '') continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    collectEventAttachmentRefs(event, images, files)
  }
  return { images, files }
}

/**
 * One safe zip path segment from an untrusted session id. Session ids are
 * host-controlled, but the brand allows any non-empty string, so `../`, dot
 * segments, and separator characters are neutralized before they can shape
 * archive entries. Distinct ids may collapse onto one segment (id collision
 * is impossible for the host-minted UUIDs, so no uniqueness suffix is kept).
 * @param id - the raw session id.
 * @returns a filesystem-safe single path segment.
 */
function safeSessionIdSegment(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_')
}

/**
 * The export archive filename for one root session.
 * @param sessionId - the root session id (sanitized to one safe path segment).
 * @returns the attachment filename for the session's export archive.
 */
export function sessionLogZipFilename(sessionId: string): string {
  return `dsh-session-${safeSessionIdSegment(sessionId)}.zip`
}

/**
 * Yield the export entries in zip order: the preloaded root log first, then
 * every subagent descendant in lineage order (each flushed when live, read
 * through a persistence read handle right before it is yielded, and dropped
 * after the consumer moves on), then every distinct attachment referenced by
 * the included logs. Images are read and verified as bounded stored objects;
 * generic files remain streamed through the ZIP writer. The host holds at most
 * one descendant log, one image, and one file chunk beyond the root.
 * @param deps - the mounted export services (the caller answered 500 before this runs).
 * @param rootContent - the already-serialized root log (read by the caller so
 * the missing-session path can answer cleanly before streaming starts).
 * @param sessionId - the root session id.
 * @param includeDescendants - whether to include every subagent descendant.
 * @param signal - optional cancellation forwarded to lineage, persistence, and attachment reads.
 * @returns the export entries in zip order.
 */
export async function* sessionLogZipEntries(
  deps: SessionLogArchivePorts,
  rootContent: string,
  sessionId: SessionId,
  includeDescendants: boolean,
  signal?: AbortSignal,
): AsyncGenerator<SessionLogZipEntry> {
  const media = new Map<string, ImageAttachmentRef>()
  const files = new Map<string, FileAttachmentRef>()
  const rememberAttachments = (content: string): void => {
    const refs = attachmentRefsInArtifact(content)
    for (const [id, ref] of refs.images) media.set(id, ref)
    for (const [id, ref] of refs.files) files.set(id, ref)
  }
  rememberAttachments(rootContent)
  yield { path: SESSION_LOG_FILENAME, content: rootContent }
  if (includeDescendants) {
    const seen = new Set<SessionId>([sessionId])
    const collect = async function* (
      nodes: readonly SessionLineageNode[],
    ): AsyncGenerator<SessionLogZipEntry> {
      for (const node of nodes) {
        signal?.throwIfAborted()
        const id = node.session.header.id
        if (seen.has(id)) continue
        seen.add(id)
        const content = await readSessionLogAfterFlush(deps, id, signal)
        signal?.throwIfAborted()
        if (content === undefined) {
          throw new Error(`subagent "${id}" has no stored log`)
        }
        rememberAttachments(content)
        yield {
          path: `subagents/${safeSessionIdSegment(id)}/${SESSION_LOG_FILENAME}`,
          content,
        }
        yield* collect(node.descendants)
      }
    }
    const lineage = await deps.sessionQuery.traceSession(sessionId, signal)
    signal?.throwIfAborted()
    yield* collect(lineage.descendants)
  }
  for (const ref of media.values()) {
    signal?.throwIfAborted()
    const stored = await deps.attachments.readImage(ref, signal)
    signal?.throwIfAborted()
    yield { path: mediaEntryPath(ref), data: stored.data }
  }
  for (const ref of files.values()) {
    signal?.throwIfAborted()
    yield {
      path: fileEntryPath(ref),
      chunks: deps.attachments.readFileStream(ref, signal),
    }
  }
}

/** How many code units of Session-log text one zip push carries (bounded encode memory). */
const PUSH_CHUNK_CODE_UNITS = 1 << 16

/** How many bytes of media one zip push carries (bounded memory; images are already size-capped). */
const PUSH_CHUNK_BYTES = 1 << 16

/** Byte capacity retained by the response stream before ZIP production waits for pull. */
const RESPONSE_HIGH_WATER_MARK_BYTES = 1 << 16

/** One producer waiter released only when ReadableStream pull restores capacity. */
class ResponseCapacityGate {
  private releasePending: (() => void) | undefined

  /**
   * Wait until the response queue has positive byte capacity or cancellation wins.
   * @param controller - response controller whose desired size owns capacity.
   * @param signal - combined request/consumer cancellation.
   */
  async wait(
    controller: ReadableStreamDefaultController<Uint8Array>,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted()
    if (controller.desiredSize === null || controller.desiredSize > 0) return
    await new Promise<void>((resolve) => {
      const release = (): void => {
        this.releasePending = undefined
        signal.removeEventListener('abort', release)
        resolve()
      }
      this.releasePending = release
      signal.addEventListener('abort', release, { once: true })
    })
    signal.throwIfAborted()
  }

  /** Release the current producer waiter after a consumer pull. */
  pulled(): void {
    this.releasePending?.()
  }
}

/**
 * Push one media object's bytes into a deflate stream in bounded chunks,
 * waiting for consumer capacity between chunks like the artifact path does.
 * @param deflate - the zip entry's deflate stream.
 * @param data - the stored image bytes.
 * @param controller - response queue controller.
 * @param capacity - pull-driven response-capacity gate.
 * @param signal - cancellation; throws when aborted.
 */
async function pushBinaryChunks(
  deflate: ZipDeflate,
  data: Uint8Array,
  controller: ReadableStreamDefaultController<Uint8Array>,
  capacity: ResponseCapacityGate,
  signal: AbortSignal,
): Promise<void> {
  let offset = 0
  do {
    signal.throwIfAborted()
    const end = Math.min(offset + PUSH_CHUNK_BYTES, data.byteLength)
    const finalChunk = end >= data.byteLength
    deflate.push(data.subarray(offset, end), finalChunk)
    offset = end
    await capacity.wait(controller, signal)
  } while (offset < data.byteLength)
}

/** Push one streamed file entry without retaining its complete byte sequence. */
async function pushStreamChunks(
  deflate: ZipDeflate,
  chunks: AsyncIterable<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  capacity: ResponseCapacityGate,
  signal: AbortSignal,
): Promise<void> {
  for await (const chunk of chunks) {
    signal.throwIfAborted()
    if (chunk.byteLength === 0) continue
    deflate.push(chunk, false)
    await capacity.wait(controller, signal)
  }
  signal.throwIfAborted()
  deflate.push(new Uint8Array(), true)
  await capacity.wait(controller, signal)
}

/**
 * Push one artifact's text into a deflate stream in bounded chunks, never
 * splitting a surrogate pair across a chunk boundary (a lone high surrogate
 * re-encodes as U+FFFD and would silently corrupt the exported artifact).
 * @param deflate - the zip entry's deflate stream.
 * @param content - the canonical Session-log text.
 * @param controller - response queue controller.
 * @param capacity - pull-driven response-capacity gate.
 * @param signal - cancellation; throws when aborted.
 */
async function pushArtifactChunks(
  deflate: ZipDeflate,
  content: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  capacity: ResponseCapacityGate,
  signal: AbortSignal,
): Promise<void> {
  const encoder = new TextEncoder()
  let offset = 0
  let finalChunk: boolean
  do {
    signal.throwIfAborted()
    let end = Math.min(offset + PUSH_CHUNK_CODE_UNITS, content.length)
    if (end < content.length && end - offset > 1) {
      // Back off one code unit when the boundary lands inside a surrogate
      // pair: the pair then starts the next chunk whole.
      const last = content.charCodeAt(end - 1)
      if (last >= 0xd800 && last <= 0xdbff) end -= 1
    }
    finalChunk = end >= content.length
    deflate.push(encoder.encode(content.slice(offset, end)), finalChunk)
    offset = end
    await capacity.wait(controller, signal)
  } while (!finalChunk)
}

/** Producer handle retained by the Native provider until cancellation has drained it. */
export interface ManagedSessionLogZip {
  readonly stream: ReadableStream<Uint8Array>
  /** Completes after the ZIP producer stops reading and compressing entries. */
  readonly done: Promise<void>
  /** Abort the producer and terminate its active compressor.
   * @param reason - the cancellation reason.
   */
  cancel(reason: unknown): void
}

/** Build one archive stream and expose producer settlement to its resource owner.
 * @param deps - canonical query, persistence, attachment, and flush operations.
 * @param rootContent - serialized root log yielded as the first archive entry.
 * @param sessionId - root Session id.
 * @param includeDescendants - whether to export all descendants.
 * @param compressionLevel - validated DEFLATE level.
 * @param signal - request and provider cancellation.
 * @returns the stream, producer settlement, and cancellation operation.
 */
export function streamSessionLogZipManaged(
  deps: SessionLogArchivePorts,
  rootContent: string,
  sessionId: SessionId,
  includeDescendants: boolean,
  compressionLevel: SessionLogCompressionLevel,
  signal: AbortSignal,
): ManagedSessionLogZip {
  const consumerAbort = new AbortController()
  const producerSignal = AbortSignal.any([signal, consumerAbort.signal])
  const producerSettled = Promise.withResolvers<void>()
  const done = producerSettled.promise
  let zip: Zip | undefined
  let zipTerminated = false
  let consumerCancelled = false
  const capacity = new ResponseCapacityGate()
  const terminateZip = (): void => {
    if (zip === undefined || zipTerminated) return
    zipTerminated = true
    zip.terminate()
  }
  const cancel = (reason: unknown): void => {
    consumerAbort.abort(reason instanceof Error ? reason : new Error('session log export stream cancelled'))
    terminateZip()
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // fflate invokes the callback synchronously per compressed chunk, so a
      // single push can enqueue ahead of a slow consumer; the capacity gate
      // waits for pull between pushes once the byte queue is full, bounding
      // accumulation to the queue high-water mark plus one synchronous push.
      const archive = new Zip((error, data, final) => {
        /* v8 ignore next 3 -- fflate reports only internal zip failures, unreachable for valid inputs */
        if (error) {
          controller.error(error)
          return
        }
        /* v8 ignore next -- fflate may emit empty chunks; not controllable from tests */
        if (data.byteLength > 0) controller.enqueue(data)
        if (final) controller.close()
      })
      zip = archive
      void (async () => {
        try {
          for await (const entry of sessionLogZipEntries(deps, rootContent, sessionId, includeDescendants, producerSignal)) {
            const deflate = new ZipDeflate(entry.path, { level: compressionLevel })
            archive.add(deflate)
            if ('content' in entry) {
              await pushArtifactChunks(deflate, entry.content, controller, capacity, producerSignal)
            } else if ('data' in entry) {
              await pushBinaryChunks(deflate, entry.data, controller, capacity, producerSignal)
            } else {
              await pushStreamChunks(deflate, entry.chunks, controller, capacity, producerSignal)
            }
          }
          archive.end()
        } catch (error) {
          // A mid-stream failure (missing descendant, cancellation, read
          // error) must fail the download rather than ship a truncated archive.
          /* v8 ignore next -- typed backends reject with Error, and DOMException is one in Node */
          terminateZip()
          if (!consumerCancelled) controller.error(error instanceof Error ? error : new Error(String(error)))
        } finally {
          producerSettled.resolve()
        }
      })()
    },
    pull() {
      capacity.pulled()
    },
    cancel(reason) {
      consumerCancelled = true
      cancel(reason)
    },
  }, {
    highWaterMark: RESPONSE_HIGH_WATER_MARK_BYTES,
    size: chunk => chunk.byteLength,
  })
  return { stream, done, cancel }
}

/** Create a bounded ZIP byte stream for the Cordis route adapter.
 * @param deps - canonical query, persistence, attachment, and flush operations.
 * @param rootContent - serialized root log yielded as the first archive entry.
 * @param sessionId - root Session id.
 * @param includeDescendants - whether to export all descendants.
 * @param compressionLevel - validated DEFLATE level.
 * @param signal - request and consumer cancellation.
 * @returns the bounded ZIP stream.
 */
export function streamSessionLogZip(
  deps: SessionLogArchivePorts,
  rootContent: string,
  sessionId: SessionId,
  includeDescendants: boolean,
  compressionLevel: SessionLogCompressionLevel,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  return streamSessionLogZipManaged(
    deps, rootContent, sessionId, includeDescendants, compressionLevel, signal,
  ).stream
}
