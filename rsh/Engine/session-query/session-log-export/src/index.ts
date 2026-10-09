/** Session-log download command and Host-owned streaming route. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import Schema from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-attachment'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { SessionEvent, SessionHeader, SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { SessionQueryOperations } from '@deepseek-ai/dsh-session-query/native'
import {
  DEFAULT_SESSION_LOG_COMPRESSION_LEVEL as DEFAULT_COMPRESSION_LEVEL_FROM_ARCHIVE,
  readSessionLogAfterFlush,
  readSessionLogText as readSessionLogTextFromArchive,
  serializeSessionLog as serializeSessionLogFromArchive,
  sessionLogZipEntries as sessionLogZipEntriesFromArchive,
  sessionLogZipFilename as sessionLogZipFilenameFromArchive,
  SESSION_LOG_FILENAME as SESSION_LOG_FILENAME_FROM_ARCHIVE,
  streamSessionLogZip as streamSessionLogZipFromArchive,
} from './archive.ts'

/** Valid fflate DEFLATE levels accepted by session-log export. */
export type SessionLogCompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/** One file emitted by the package's archive stream. */
export type SessionLogZipEntry =
  | { readonly path: string; readonly content: string }
  | { readonly path: string; readonly data: Uint8Array }
  | { readonly path: string; readonly chunks: AsyncIterable<Uint8Array> }

/** Balanced default used when Session export configuration omits a compression level. */
export const DEFAULT_SESSION_LOG_COMPRESSION_LEVEL: SessionLogCompressionLevel = DEFAULT_COMPRESSION_LEVEL_FROM_ARCHIVE

/** The current generation's canonical filename for each exported Session log. */
export const SESSION_LOG_FILENAME: string = SESSION_LOG_FILENAME_FROM_ARCHIVE

export const name = 'session-log-download'
export const inject = ['commands', 'connection']

/** Stable browser download path retained across the transport migration. */
export const SESSION_LOG_EXPORT_PATH = '/api/session.export'

/** Session-log archive policy. */
export interface Config {
  /** DEFLATE level for each ZIP entry. @default 6 */
  readonly compressionLevel?: SessionLogCompressionLevel
}

/** The archive filename for one root Session.
 * @param sessionId - Session id sanitized to one safe path segment.
 * @returns the ZIP filename.
 */
export function sessionLogZipFilename(sessionId: string): string {
  return sessionLogZipFilenameFromArchive(sessionId)
}

/** Validate Session-log archive configuration. */
export const Config: Schema<Config> = Schema.object({
  compressionLevel: Schema.number().step(1).min(0).max(9)
    .default(DEFAULT_SESSION_LOG_COMPRESSION_LEVEL) as Schema<SessionLogCompressionLevel>,
})

interface SessionLogConnection {
  readonly fetch: {
    register(route: {
      readonly path: string
      readonly methods: readonly ('GET' | 'HEAD')[]
      readonly requestBody: 'buffered'
      readonly fetch: (request: Request) => Promise<Response>
    }): () => Promise<void>
  }
}

/** Cordis service subset adapted to the package's shared archive ports. */
interface LegacyArchivePorts {
  readonly sessionQuery: Pick<SessionQueryOperations, 'traceSession'>
  readonly sessionPersistence: Pick<SessionPersistence, 'open'>
  readonly attachments: Pick<AttachmentStore, 'readImage' | 'readFileStream'>
  readonly flushLiveSession: (id: SessionId, signal?: AbortSignal) => Promise<undefined>
}

/** Services resolved from a Cordis Host for the existing Web adapter. */
export interface SessionLogExportDeps {
  readonly sessionQuery: Pick<SessionQueryOperations, 'traceSession'> | undefined
  readonly sessionPersistence: SessionPersistence | undefined
  readonly attachments: AttachmentStore | undefined
  readonly sessions: SessionStore | undefined
}

/** The services narrowed to those required by one Cordis export request. */
export interface SessionLogExportReady {
  readonly sessionQuery: Pick<SessionQueryOperations, 'traceSession'>
  readonly sessionPersistence: SessionPersistence
  readonly attachments: AttachmentStore
  readonly sessions: SessionStore | undefined
}

/** Resolve the services consumed by the existing Cordis Host adapter.
 * @param ctx - the composed Host context.
 * @returns the export services, which may be absent from this deployment.
 */
export function sessionLogExportDeps(ctx: Context): SessionLogExportDeps {
  return {
    sessionQuery: ctx.get('sessionQuery') as Pick<SessionQueryOperations, 'traceSession'> | undefined,
    sessionPersistence: ctx.get('sessionPersistence'),
    attachments: ctx.get('attachments'),
    sessions: ctx.get('sessions'),
  }
}

/** Flush one live Session through Cordis SessionStore before its persisted read.
 * @param deps - the optional Cordis SessionStore.
 * @param id - Session id to flush.
 * @param signal - optional cancellation observed around the flush.
 * @returns completion after the live Session flushes or when no live Session exists.
 */
export async function flushLiveSessionLog(
  deps: Pick<SessionLogExportDeps, 'sessions'>,
  id: SessionId,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  const sessions = deps.sessions
  if (sessions === undefined) return
  const session = sessions.get(id)
  if (session === undefined) return
  await sessions.flush(session)
  signal?.throwIfAborted()
}

function archivePorts(ready: SessionLogExportReady): LegacyArchivePorts {
  return {
    sessionQuery: ready.sessionQuery,
    sessionPersistence: ready.sessionPersistence,
    attachments: ready.attachments,
    flushLiveSession: async (id, signal) => {
      await flushLiveSessionLog({ sessions: ready.sessions }, id, signal)
      return undefined
    },
  }
}

/** Serialize a stored Session header and its accepted events as canonical JSONL.
 * @param header - the stored Session header.
 * @param events - the validated events in sequence order.
 * @returns canonical JSONL text.
 */
export function serializeSessionLog(header: SessionHeader, events: readonly SessionEvent[]): string {
  return serializeSessionLogFromArchive(header, events)
}

/** Read one Session through a Cordis persistence handle.
 * @param persistence - the mounted Cordis persistence service.
 * @param id - the Session id to read.
 * @param signal - optional cancellation forwarded to open and read.
 * @returns canonical JSONL text, or `undefined` when the Session is absent.
 */
export function readSessionLogText(
  persistence: SessionPersistence,
  id: SessionId,
  signal?: AbortSignal,
): Promise<string | undefined> {
  return readSessionLogTextFromArchive(persistence, id, signal)
}

/** Build archive entries using the existing Cordis service types.
 * @param ready - the narrowed Cordis export services.
 * @param rootContent - serialized root log yielded first.
 * @param sessionId - root Session id.
 * @param includeDescendants - whether to include all descendants.
 * @param signal - optional cancellation forwarded to each read.
 * @returns entries in ZIP order.
 */
export function sessionLogZipEntries(
  ready: SessionLogExportReady,
  rootContent: string,
  sessionId: SessionId,
  includeDescendants: boolean,
  signal?: AbortSignal,
): AsyncGenerator<SessionLogZipEntry> {
  return sessionLogZipEntriesFromArchive(archivePorts(ready), rootContent, sessionId, includeDescendants, signal)
}

/** Stream one ZIP using the existing Cordis service types.
 * @param ready - the narrowed Cordis export services.
 * @param rootContent - serialized root log yielded first.
 * @param sessionId - root Session id.
 * @param includeDescendants - whether to include all descendants.
 * @param compressionLevel - validated DEFLATE level for every entry.
 * @param signal - request and consumer cancellation.
 * @returns the bounded ZIP stream.
 */
export function streamSessionLogZip(
  ready: SessionLogExportReady,
  rootContent: string,
  sessionId: SessionId,
  includeDescendants: boolean,
  compressionLevel: SessionLogCompressionLevel,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  return streamSessionLogZipFromArchive(
    archivePorts(ready), rootContent, sessionId, includeDescendants, compressionLevel, signal,
  )
}

const REQUESTED: CommandResult = {
  kind: 'success',
  text: 'Session log download requested.',
}

/**
 * Register the Web-only `/export` command and authenticated ZIP download route.
 * @param ctx - Host context carrying the human-command registry.
 * @param config - resolved compression policy.
 */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.effect(() => ctx.commands.register({
    definitionId: brandString<CommandDefinitionId>('@deepseek-ai/dsh-session-log-export'),
    name: 'export',
    description: 'Download this Session log as a ZIP archive',
    handler: invocation => Promise.resolve(invocation.rawInput.trim() === ''
      ? REQUESTED
      : { kind: 'error', text: 'The Web /export command does not accept a path.' }),
  }), 'session-log-download: command')
  connectionOf(ctx).fetch.register({
    path: SESSION_LOG_EXPORT_PATH,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const response = await sessionLogExportResponse(
        ctx,
        request,
        config.compressionLevel ?? DEFAULT_SESSION_LOG_COMPRESSION_LEVEL,
      )
      if (request.method === 'GET') return response
      await response.body?.cancel()
      return new Response(null, { status: response.status, headers: response.headers })
    },
  })
}

function connectionOf(ctx: Context): SessionLogConnection {
  return Reflect.get(ctx, 'connection') as SessionLogConnection
}

async function sessionLogExportResponse(
  ctx: Context,
  request: Request,
  compressionLevel: SessionLogCompressionLevel,
): Promise<Response> {
  const url = new URL(request.url)
  const query = Object.fromEntries(url.searchParams)
  const sessionIdValue = query['sessionId']
  const descendantsValue = query['includeDescendants']
  if (sessionIdValue === undefined || sessionIdValue.length === 0
    || (descendantsValue !== undefined && descendantsValue !== 'true' && descendantsValue !== 'false')) {
    return new Response('missing or invalid sessionId query parameter', { status: 400 })
  }
  const sessionId = brandString<SessionId>(sessionIdValue)
  const deps = sessionLogExportDeps(ctx)
  if (deps.sessionQuery === undefined
    || deps.sessionPersistence === undefined
    || deps.attachments === undefined) {
    return new Response(
      'session log export is unavailable: missing session-query, session-persistence, or attachments service',
      { status: 500 },
    )
  }
  const ready: SessionLogExportReady = {
    sessionQuery: deps.sessionQuery,
    sessionPersistence: deps.sessionPersistence,
    attachments: deps.attachments,
    sessions: deps.sessions,
  }
  let rootContent: string | undefined
  try {
    rootContent = await readSessionLogAfterFlush(archivePorts(ready), sessionId, request.signal)
    request.signal.throwIfAborted()
  } catch {
    request.signal.throwIfAborted()
    // Root preparation failure (flush, open, or read): answer 500 without
    // echoing the error, which may carry absolute host paths into the
    // browser error bar.
    return new Response('session log export failed to read the stored log', { status: 500 })
  }
  if (rootContent === undefined) {
    return new Response('session not found', { status: 404 })
  }
  const response = new Response(
    streamSessionLogZip(
      ready,
      rootContent,
      sessionId,
      descendantsValue === 'true',
      compressionLevel,
      request.signal,
    ),
    {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${sessionLogZipFilename(sessionId)}"`,
      },
    },
  )
  return response
}
