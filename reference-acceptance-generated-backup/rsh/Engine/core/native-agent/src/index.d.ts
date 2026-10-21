export { InitiatorRunTracker } from './initiator-runs.ts';
import { type Branded } from '@deepseek-ai/dsh-brand';
import { type NativePlugin, NativeScope } from '@deepseek-ai/dsh-native-runtime';
import { NativeAgentExecution } from './execution.ts';
export type { NativeAgentExecution, NativeAgentExecutionStatus } from './execution.ts';
export type * from './lifecycle-types.ts';
declare module '@deepseek-ai/dsh-native-runtime' {
    interface NativeServices {
        agents: NativeAgentRegistry;
    }
}
/** One of the Agent's ordered pending-message lists. */
export type { InboxTarget } from './inbox.ts';
/** Opaque identity for one live native Agent. */
export type NativeAgentId = Branded<'NativeAgentId'>;
/**
 * Brand a nonempty native Agent identity at a string input boundary.
 * @param value - raw identity supplied by an application or integration.
 * @returns the opaque native Agent identity.
 */
export declare function NativeAgentId(value: string): NativeAgentId;
/** A live Agent's identity and scope visibility; Session ownership remains in the application. */
export interface NativeAgent {
    readonly id: NativeAgentId;
    readonly scope: NativeScope;
}
/** Scoped event dispatch that reports native Agent lifecycle edges. */
export interface NativeAgentEventDispatcher {
    emit(scope: NativeScope, key: 'agent/created' | 'agent/disposed', agent: NativeAgent): void;
}
/**
 * Records native Agents, emits their scoped lifecycle events, and propagates
 * the explicit initiator through native asynchronous work.
 */
export declare class NativeAgentRegistry {
    private readonly events;
    private readonly lifetime?;
    private readonly entries;
    private readonly initiators;
    private readonly initiatorRuns;
    private state;
    private disposal;
    private lifecycleEventsEnabled;
    /**
     * @param events - the selected native Host's typed scoped event dispatcher.
     * @param lifetime - Host cancellation, which closes event admission before owned resources drain.
     */
    constructor(events: NativeAgentEventDispatcher, lifetime?: AbortSignal | undefined);
    /**
     * Return the inherited initiator, or undefined outside an initiator boundary.
     * @returns the active initiator when one is inherited.
     */
    currentInitiator(): NativeAgent | undefined;
    /**
     * Return the inherited initiator or reject an agentless operation.
     * @returns the active initiator.
     */
    requireInitiator(): NativeAgent;
    /**
     * Preserve `agent` across the operation's returned Promise without assigning
     * resource ownership or authorization to the Agent.
     * @param agent - exact live Agent that initiated the operation.
     * @param operation - synchronous or asynchronous work to run with that Agent.
     * @returns the exact value returned by `operation`.
     */
    withInitiator<T>(agent: NativeAgent, operation: () => T): T;
    /**
     * Hide an inherited initiator while starting agentless shared work.
     * @param operation - synchronous or asynchronous work to run without an Agent.
     * @returns the exact value returned by `operation`.
     */
    withoutInitiator<T>(operation: () => T): T;
    /**
     * Register an exact Agent identity and announce it in its own NativeScope.
     * @param agent - live Agent identity and visibility scope.
     * @returns an idempotent disposer for this exact registration.
     */
    register(agent: NativeAgent): () => Promise<void>;
    /**
     * Register one asynchronous cleanup that completes before its Agent leaves the registry.
     * @param agent - exact live Agent whose release owns the cleanup.
     * @param cleanup - idempotent resource release, such as draining the Agent's jobs.
     * @returns a disposer that removes this cleanup while the Agent remains live.
     */
    onDispose(agent: NativeAgent, cleanup: () => void | Promise<void>): () => void;
    /**
     * Return the live Agent selected by its exact identity.
     * @param id - opaque identity to resolve.
     * @returns the matching Agent while its registration is live.
     */
    get(id: NativeAgentId): NativeAgent | undefined;
    /**
     * Return a detached registration-order snapshot.
     * @returns live Agents in registration order.
     */
    list(): NativeAgent[];
    /**
     * Obtain the unique FIFO execution and idle-maintenance owner for a registered Agent.
     * @param agent - exact available identity; copied or releasing identities are refused.
     * @returns the same execution owner across the Agent's registration lifetime.
     */
    execution(agent: NativeAgent): NativeAgentExecution;
    /**
     * Stop new initiator boundaries, drain returned Promise operations, and
     * announce disposal for registrations the owner did not release first.
     */
    dispose(): Promise<void>;
    private disposeInternal;
    private detach;
    private release;
    private releaseInternal;
    private runWithInitiator;
    private assertAccepting;
    private assertReadable;
}
/** Native Agent lifecycle Provider with no configuration surface. */
export declare const plugin: NativePlugin;
//# sourceMappingURL=index.d.ts.map