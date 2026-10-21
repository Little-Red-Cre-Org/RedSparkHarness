/**
 * Cordis service adapter for the shared JSONL session backend.
 * @module @deepseek-ai/dsh-session-persistence-jsonl
 */
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { SessionPersistence, type NativeSessionDeletionOperations, type SessionAccess, type SessionHandle, type SessionPersistenceCreateOptions, type SessionPersistenceListOptions, type SessionPersistenceOpenOptions, type SessionPersistenceSnapshot, type SessionPersistenceStatOptions } from '@deepseek-ai/dsh-session-persistence';
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session';
import { type Config } from './backend.ts';
export { JsonlSessionBackend, JsonlCompressionSchema } from './backend.ts';
export type { Config, JsonlCompression } from './backend.ts';
/** Cordis service adapter over the same JSONL storage implementation used by native profiles. */
declare class JsonlSessionPersistence extends SessionPersistence {
    config: Config;
    static Config: z<Config>;
    readonly name = "session-persistence-jsonl";
    /** Same explicit deletion capability as the native selected JSONL Provider. */
    readonly deletions: NativeSessionDeletionOperations;
    private readonly backend;
    constructor(ctx: Context, config: Config);
    create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle>;
    open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle>;
    flush(): Promise<void>;
    stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined>;
    list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]>;
}
export default JsonlSessionPersistence;
//# sourceMappingURL=index.d.ts.map