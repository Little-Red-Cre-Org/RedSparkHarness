/** Cordis service adapter for the shared SQLite session-query core. */

import type { Session } from '@deepseek-ai/dsh-session'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import { Context, Service, type Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type SessionPersistence from '@deepseek-ai/dsh-session-persistence'
import SessionQueryEngine, { readColdSessionLog } from '@deepseek-ai/dsh-session-query'
import {
  SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY,
  SESSION_QUERY_DEFAULT_PREPARED_SESSION_CACHE_SIZE,
  SESSION_QUERY_READ_WINDOW_MAX,
} from '@deepseek-ai/dsh-session-query/native'
import type {
  SessionEventSearchPage,
  SessionEventSearchRequest,
  SessionSearchExecContext,
  SessionSearchHit,
  SessionSearchPage,
  SessionSearchRequest,
} from '@deepseek-ai/dsh-session-query/native'
import type {
  SessionQueryLiveSource,
  SessionQueryPersistenceRecord,
  SessionQuerySource,
} from '@deepseek-ai/dsh-session-query/source'
import {
  SESSION_QUERY_SQLITE_DEFAULT_LIMIT,
  SESSION_QUERY_SQLITE_MAX_LIMIT,
  SESSION_QUERY_SQLITE_SNIPPET_CHARS,
  resolveSessionQuerySqliteConfig,
  SqliteSessionQueryCore,
  type SessionQuerySqliteConfig,
} from './core.ts'
import { SQLITE_MAX_PAGE_LIMIT } from './query.ts'

export {
  SESSION_QUERY_SQLITE_APPLICATION_ID,
  SESSION_QUERY_SQLITE_SCHEMA_VERSION,
  type JournalMode,
} from './schema.ts'
export {
  SESSION_QUERY_SQLITE_DEFAULT_LIMIT,
  SESSION_QUERY_SQLITE_MAX_LIMIT,
  SESSION_QUERY_SQLITE_SNIPPET_CHARS,
  type OpenAt,
  type ResolvedSessionQuerySqliteConfig,
  type SessionQuerySqliteConfig,
  resolveSessionQuerySqliteConfig,
  SqliteSessionQueryCore,
} from './core.ts'

/** Boot-context slot for a launcher-owned absolute path to this process's derived query index. */
export const SESSION_QUERY_SQLITE_PATH_KEY = 'launcherSessionQueryPath'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Launcher-owned absolute path to this process's disposable derived query index. */
    launcherSessionQueryPath?: string
  }
}

/** Combined session-query configuration backed by SQLite full-text search. */
export type Config = SessionQuerySqliteConfig

/** Cordis owner of `ctx.sessionQuery`; source reads are adapted to the shared query core. */
export class SqliteSessionQueryEngine extends SessionQueryEngine {
  static override inject = ['sessions']

  static Config: z<Config> = z.object({
    path: z.string().required(),
    openAt: z.union(['startup', 'first-search', 'never'] as const).default('startup'),
    journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
    defaultLimit: z.number().step(1).min(1).max(SQLITE_MAX_PAGE_LIMIT).default(SESSION_QUERY_SQLITE_DEFAULT_LIMIT),
    maxLimit: z.number().step(1).min(1).max(SQLITE_MAX_PAGE_LIMIT).default(SESSION_QUERY_SQLITE_MAX_LIMIT),
    snippetChars: z.number().step(1).min(1).default(SESSION_QUERY_SQLITE_SNIPPET_CHARS),
    readWindowMax: z.number().step(1).min(0).default(SESSION_QUERY_READ_WINDOW_MAX),
    persistedReadConcurrency: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)
      .default(SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY),
    preparedSessionCacheSize: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)
      .default(SESSION_QUERY_DEFAULT_PREPARED_SESSION_CACHE_SIZE),
  })

  /** Validated and defaulted backend configuration. */
  readonly config: ReturnType<typeof resolveSessionQuerySqliteConfig>

  private readonly _core: SqliteSessionQueryCore
  private readonly _optionalPersistenceFiber: Fiber
  private _persistenceBinding: ReturnType<SessionQuerySource['persistenceBinding']> = { identity: {} }
  private _closePromise: Promise<void> | undefined

  constructor(ctx: Context, config: Config) {
    const resolved = resolveSessionQuerySqliteConfig(config)
    super(ctx, resolved)
    this.config = resolved
    const source: SessionQuerySource = {
      persistenceBinding: () => this._persistenceBinding,
      liveOwners: () => ctx.sessions.list().map(cordisLiveOwner),
    }
    this._core = new SqliteSessionQueryCore(resolved, source)
    this._optionalPersistenceFiber = ctx.inject(['sessionPersistence'], (childCtx: Context) => {
      const binding = {
        identity: {},
        store: cordisPersistenceSource(childCtx.sessionPersistence),
      }
      this._persistenceBinding = binding
      childCtx.effect(() => () => {
        if (this._persistenceBinding !== binding) return
        this._persistenceBinding = { identity: {} }
      }, 'sessionQuerySqlite.persistenceBinding')
    })
    ctx.effect(() => async () => this.close(), 'sessionQuerySqlite.close')
  }

  /** Open SQLite during service activation only for the startup readiness mode. */
  protected async [Service.init](): Promise<void> {
    if (this.config.openAt === 'startup') await this._core.open()
  }

  override searchSessions(
    request: SessionSearchRequest,
    exec?: SessionSearchExecContext,
  ): Promise<SessionSearchPage<SessionSearchHit>> {
    return this._core.searchSessions(request, exec?.signal)
  }

  override searchEvents(
    request: SessionEventSearchRequest,
    exec?: SessionSearchExecContext,
  ): Promise<SessionEventSearchPage> {
    return this._core.searchEvents(request, exec?.signal)
  }

  /** Close admission, drain accepted searches, then release the optional source subscription. */
  close(): Promise<void> {
    this._closePromise ??= (async () => {
      try {
        await this._core.close()
      } finally {
        await this._optionalPersistenceFiber.dispose()
      }
    })()
    return this._closePromise
  }
}

function cordisPersistenceSource(persistence: SessionPersistence): NonNullable<ReturnType<SessionQuerySource['persistenceBinding']>['store']> {
  return {
    async list(signal): Promise<readonly SessionQueryPersistenceRecord[]> {
      return persistence.list(signal === undefined ? undefined : { signal })
    },
    read(sessionId, signal) {
      return readColdSessionLog(persistence, sessionId, signal)
    },
  }
}

function cordisLiveOwner(session: Session): SessionQueryLiveSource {
  return {
    sessionId: session.id,
    ownerToken: session,
    header: structuredClone(session.header),
    inheritedEventCount: session.inheritedEventCount,
    capturedEventCount: session.seq,
    readEvents(maxEvents, signal) {
      return new Promise<ReturnType<Session['snapshotEvents']>>((resolve) => {
        signal?.throwIfAborted()
        // oxlint-disable-next-line typescript/no-deprecated -- The legacy Session adapter reads the captured prefix.
        resolve(session.snapshotEvents(SessionLogOffset(0), maxEvents))
      })
    },
  }
}

export default SqliteSessionQueryEngine
