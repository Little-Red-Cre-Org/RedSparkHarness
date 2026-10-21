/**
 * Compaction Service Definition (`ctx.compaction`): providers decide when to
 * compact and replace a history range with one summary node by subclassing
 * {@link CompactionEngine}. This interface necessarily depends on session and LLM
 * vocabulary; the rationale is in the
 * [compaction Agent Note](../../../../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md).
 * @module @deepseek-ai/dsh-compaction
 */
import { Service } from '@deepseek-ai/cordis';
export { CompactionId } from "./brand.js";
export { toolPairingBalancedAfter, toolPairingBalancedBefore } from "./tool-pairing.js";
// The checkpoint source constructor and predicate are declared on the cordis-free
// `./checkpoint` leaf so client and wire programs can name them without this
// root's Context merge; the root stays the host-side entry point for both.
export { compactCheckpointSource, isCompactCheckpointSource } from "./checkpoint.js";
export { ManualCompactionError } from "./errors.js";
/**
 * Abstract compaction service. Implementations own trigger policy, retention,
 * and summarization, and may consume a separate measurement service. A
 * successful run replaces the selected surface span with one summary node and
 * prevents concurrent compaction of the same session. The replacement user
 * message uses {@link compactCheckpointSource} with the transaction identity
 * so consumers recognize and correlate it independently of the backend. Load
 * one implementation per context as `ctx.compaction`.
 */
export class CompactionEngine extends Service {
    constructor(ctx) {
        super(ctx, 'compaction');
    }
}
export default CompactionEngine;
//# sourceMappingURL=index.js.map