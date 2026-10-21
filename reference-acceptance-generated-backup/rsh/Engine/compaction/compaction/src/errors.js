/**
 * Cordis-free compaction trigger and manual-failure vocabulary shared by the
 * Cordis Service Definition and the native compaction Definition.
 * @module @deepseek-ai/dsh-compaction/errors
 */
/**
 * Expected manual-compaction failure suitable for a direct human-command result.
 * Shared durable-lock entry assertions may also throw the `busy` subtype from
 * automatic compaction paths.
 */
export class ManualCompactionError extends Error {
    code;
    name = 'ManualCompactionError';
    /**
     * Create one classified compaction failure.
     * @param code - stable failure class; `busy` may originate from any compaction entry path.
     * @param message - backend diagnostic retained as the Error message.
     * @param options - optional original failure.
     */
    constructor(code, message, options) {
        super(message, options);
        this.code = code;
    }
}
//# sourceMappingURL=errors.js.map