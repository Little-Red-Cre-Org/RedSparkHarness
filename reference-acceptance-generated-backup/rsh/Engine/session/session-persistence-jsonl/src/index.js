/**
 * Cordis service adapter for the shared JSONL session backend.
 * @module @deepseek-ai/dsh-session-persistence-jsonl
 */
import z from '@deepseek-ai/schemastery';
import { SessionPersistence, } from '@deepseek-ai/dsh-session-persistence';
import { JsonlSessionBackend, JsonlCompressionSchema } from "./backend.js";
export { JsonlSessionBackend, JsonlCompressionSchema } from "./backend.js";
/** Cordis service adapter over the same JSONL storage implementation used by native profiles. */
class JsonlSessionPersistence extends SessionPersistence {
    config;
    static Config = z.object({
        root: z.string().required(),
        compression: JsonlCompressionSchema,
    });
    name = 'session-persistence-jsonl';
    /** Same explicit deletion capability as the native selected JSONL Provider. */
    deletions;
    backend;
    constructor(ctx, config) {
        super(ctx);
        this.config = config;
        this.backend = new JsonlSessionBackend(config, (message) => { ctx.logger.warn(message); });
        this.deletions = this.backend.deletions;
        ctx.on('session/event', (session, event) => {
            this.backend.onSessionEvent(session, event, (message) => { ctx.logger.warn(message); });
        });
        ctx.on('session/flush', session => this.backend.flushSession(session));
        ctx.on('session/disposed', (session) => {
            this.backend.disposeSession(session, (message) => { ctx.logger.warn(message); });
        });
        ctx.effect(() => () => this.backend.close(), this.backend.name + ' open handles');
    }
    create(header, options) {
        return this.backend.create(header, options);
    }
    open(id, access, options) {
        return this.backend.open(id, access, options);
    }
    flush() {
        return this.backend.flush();
    }
    stat(id, options) {
        return this.backend.stat(id, options);
    }
    list(options) {
        return this.backend.list(options);
    }
}
export default JsonlSessionPersistence;
//# sourceMappingURL=index.js.map