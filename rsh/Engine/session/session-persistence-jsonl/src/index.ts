/**
 * Cordis service adapter for the shared JSONL session backend.
 * @module @deepseek-ai/dsh-session-persistence-jsonl
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  SessionPersistence, type NativeSessionDeletionOperations,
  type SessionAccess, type SessionHandle,
  type SessionPersistenceCreateOptions, type SessionPersistenceListOptions,
  type SessionPersistenceOpenOptions, type SessionPersistenceSnapshot,
  type SessionPersistenceStatOptions,
} from '@deepseek-ai/dsh-session-persistence'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { JsonlSessionBackend, JsonlCompressionSchema, type Config } from './backend.ts'

export { JsonlSessionBackend, JsonlCompressionSchema } from './backend.ts'
export type { Config, JsonlCompression } from './backend.ts'

/** Cordis service adapter over the same JSONL storage implementation used by native profiles. */
class JsonlSessionPersistence extends SessionPersistence {
  static Config: z<Config> = z.object({
    root: z.string().required(),
    compression: JsonlCompressionSchema,
  })

  override readonly name = 'session-persistence-jsonl'
  /** Same explicit deletion capability as the native selected JSONL Provider. */
  override readonly deletions: NativeSessionDeletionOperations
  private readonly backend: JsonlSessionBackend

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.backend = new JsonlSessionBackend(config, (message) => { ctx.logger.warn(message) })
    this.deletions = this.backend.deletions
    ctx.on('session/event', (session, event) => {
      this.backend.onSessionEvent(session, event, (message) => { ctx.logger.warn(message) })
    })
    ctx.on('session/flush', session => this.backend.flushSession(session))
    ctx.on('session/disposed', (session) => {
      this.backend.disposeSession(session, (message) => { ctx.logger.warn(message) })
    })
    ctx.effect(() => () => this.backend.close(), this.backend.name + ' open handles')
  }

  override create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    return this.backend.create(header, options)
  }

  override open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    return this.backend.open(id, access, options)
  }

  override flush(): Promise<void> {
    return this.backend.flush()
  }

  override stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    return this.backend.stat(id, options)
  }

  override list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    return this.backend.list(options)
  }
}

export default JsonlSessionPersistence
