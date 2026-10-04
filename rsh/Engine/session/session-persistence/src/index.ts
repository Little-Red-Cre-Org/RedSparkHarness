/** Cordis SessionPersistence service over provider-neutral storage contracts. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session/native'
import type { SessionHandle, SessionAccess } from './handle.ts'
import type { SessionPersistenceCreateOptions, SessionPersistenceListOptions, SessionPersistenceOpenOptions, SessionPersistenceSnapshot, SessionPersistenceStatOptions } from './types.ts'
import type { NativeSessionPersistenceOperations } from './native.ts'
export * from './native.ts'
declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionPersistence: SessionPersistence
  }
}

/**
 * Durable append-only session storage addressed through per-session handles.
 *
 * Storage semantics shared by every backend: events are contiguous from seq 0
 * and never rewritten; a torn physical tail is never returned to a reader and
 * is truncated by the write path before its first append; reads validate
 * current-format records only and refuse unknown vocabulary fail-closed.
 * `append` persists best-effort; `flush` — per handle or service-wide — is
 * the durability barrier.
 *
 * Visibility: a created session is observable through `stat`/`list`/`open`
 * in this process from the moment `create` resolves, even while a backend
 * defers physical materialization (a pure optimization); other processes see
 * the session only once it materializes, and a session that never
 * materialized before a crash never existed. `SessionHandle.flush` forces
 * materialization.
 *
 * Freshness: once an `append` or `flush` resolves, reads started afterwards
 * on this backend instance observe at least that prefix.
 */
export abstract class SessionPersistence extends Service implements NativeSessionPersistenceOperations {
  constructor(ctx: Context) {
    super(ctx, 'sessionPersistence')
  }

  /** @inheritdoc */
  abstract create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle>

  /** @inheritdoc */
  abstract open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle>

  /** @inheritdoc */
  abstract flush(): Promise<void>

  /** @inheritdoc */
  abstract stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined>

  /** @inheritdoc */
  abstract list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]>
}

export default SessionPersistence
