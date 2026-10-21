/** Native Agent lifecycle, scope and asynchronous initiator attribution. */
import { InitiatorRunTracker } from "./initiator-runs.js";
export { InitiatorRunTracker } from "./initiator-runs.js";
import { AsyncLocalStorage } from 'node:async_hooks';
import { brandString } from '@deepseek-ai/dsh-brand';
import { NativeAgentExecution } from "./execution.js";
/**
 * Brand a nonempty native Agent identity at a string input boundary.
 * @param value - raw identity supplied by an application or integration.
 * @returns the opaque native Agent identity.
 */
export function NativeAgentId(value) {
    if (value.length === 0)
        throw new Error('native-agent: id must be nonempty');
    return brandString(value);
}
const NO_INITIATOR_MESSAGE = 'native-agent: no initiating Agent is active';
const DISPOSED_INITIATOR_MESSAGE = 'native-agent: initiator scope is disposed';
function isNativePromise(value) {
    return (typeof value === 'object' && value !== null || typeof value === 'function')
        && Object.prototype.toString.call(value) === '[object Promise]';
}
/**
 * Records native Agents, emits their scoped lifecycle events, and propagates
 * the explicit initiator through native asynchronous work.
 */
export class NativeAgentRegistry {
    events;
    lifetime;
    entries = new Map();
    initiators = new AsyncLocalStorage();
    initiatorRuns = new InitiatorRunTracker();
    state = 'active';
    disposal;
    lifecycleEventsEnabled = true;
    /**
     * @param events - the selected native Host's typed scoped event dispatcher.
     * @param lifetime - Host cancellation, which closes event admission before owned resources drain.
     */
    constructor(events, lifetime) {
        this.events = events;
        this.lifetime = lifetime;
        const disableEvents = () => { this.lifecycleEventsEnabled = false; };
        if (lifetime?.aborted)
            disableEvents();
        else
            lifetime?.addEventListener('abort', disableEvents, { once: true });
    }
    /**
     * Return the inherited initiator, or undefined outside an initiator boundary.
     * @returns the active initiator when one is inherited.
     */
    currentInitiator() {
        this.assertReadable();
        return this.initiators.getStore();
    }
    /**
     * Return the inherited initiator or reject an agentless operation.
     * @returns the active initiator.
     */
    requireInitiator() {
        const agent = this.currentInitiator();
        if (agent === undefined)
            throw new Error(NO_INITIATOR_MESSAGE);
        return agent;
    }
    /**
     * Preserve `agent` across the operation's returned Promise without assigning
     * resource ownership or authorization to the Agent.
     * @param agent - exact live Agent that initiated the operation.
     * @param operation - synchronous or asynchronous work to run with that Agent.
     * @returns the exact value returned by `operation`.
     */
    withInitiator(agent, operation) {
        return this.runWithInitiator(agent, operation);
    }
    /**
     * Hide an inherited initiator while starting agentless shared work.
     * @param operation - synchronous or asynchronous work to run without an Agent.
     * @returns the exact value returned by `operation`.
     */
    withoutInitiator(operation) {
        return this.runWithInitiator(undefined, operation);
    }
    /**
     * Register an exact Agent identity and announce it in its own NativeScope.
     * @param agent - live Agent identity and visibility scope.
     * @returns an idempotent disposer for this exact registration.
     */
    register(agent) {
        this.assertAccepting();
        if (this.entries.has(agent.id))
            throw new Error(`native-agent: Agent "${agent.id}" is already registered`);
        const entry = { agent, execution: undefined, announced: true, cleanups: new Set(), release: undefined };
        this.entries.set(agent.id, entry);
        try {
            this.events.emit(agent.scope, 'agent/created', agent);
        }
        catch (error) {
            try {
                this.detach(entry);
            }
            catch (disposalError) {
                throw new AggregateError([error, disposalError], `native-agent: Agent "${agent.id}" announcement and disposal failed`);
            }
            throw error;
        }
        return () => this.release(entry);
    }
    /**
     * Register one asynchronous cleanup that completes before its Agent leaves the registry.
     * @param agent - exact live Agent whose release owns the cleanup.
     * @param cleanup - idempotent resource release, such as draining the Agent's jobs.
     * @returns a disposer that removes this cleanup while the Agent remains live.
     */
    onDispose(agent, cleanup) {
        this.assertAccepting();
        const entry = this.entries.get(agent.id);
        if (entry?.agent !== agent || entry.release !== undefined) {
            throw new Error(`native-agent: Agent ${JSON.stringify(agent.id)} is not the registered instance`);
        }
        entry.cleanups.add(cleanup);
        return () => { entry.cleanups.delete(cleanup); };
    }
    /**
     * Return the live Agent selected by its exact identity.
     * @param id - opaque identity to resolve.
     * @returns the matching Agent while its registration is live.
     */
    get(id) {
        const entry = this.entries.get(id);
        return entry?.release === undefined ? entry?.agent : undefined;
    }
    /**
     * Return a detached registration-order snapshot.
     * @returns live Agents in registration order.
     */
    list() {
        return [...this.entries.values()].flatMap(entry => entry.release === undefined ? [entry.agent] : []);
    }
    /**
     * Obtain the unique FIFO execution and idle-maintenance owner for a registered Agent.
     * @param agent - exact available identity; copied or releasing identities are refused.
     * @returns the same execution owner across the Agent's registration lifetime.
     */
    execution(agent) {
        this.assertAccepting();
        const entry = this.entries.get(agent.id);
        if (entry?.agent !== agent || entry.release !== undefined)
            throw new Error('native-agent: Agent is not the registered instance');
        return entry.execution ??= new NativeAgentExecution(this, agent, this.lifetime);
    }
    /**
     * Stop new initiator boundaries, drain returned Promise operations, and
     * announce disposal for registrations the owner did not release first.
     */
    dispose() {
        return this.disposal ??= this.disposeInternal();
    }
    async disposeInternal() {
        if (this.state === 'active')
            this.state = 'closing';
        const errors = [];
        const pending = [...this.entries.values()].map(entry => this.release(entry));
        try {
            const draining = this.initiatorRuns.drainReentrant();
            if (draining !== undefined)
                pending.push(draining);
        }
        catch (error) {
            errors.push(error);
        }
        for (const result of await Promise.allSettled(pending)) {
            if (result.status === 'rejected')
                errors.push(result.reason);
        }
        this.state = 'disposed';
        this.initiators.disable();
        this.initiatorRuns.disable();
        if (errors.length > 0)
            throw new AggregateError(errors, 'native-agent: Agent disposal failed');
    }
    detach(entry) {
        if (this.entries.get(entry.agent.id) !== entry)
            return;
        this.entries.delete(entry.agent.id);
        if (entry.announced && this.lifecycleEventsEnabled)
            this.events.emit(entry.agent.scope, 'agent/disposed', entry.agent);
    }
    release(entry) {
        if (entry.release !== undefined)
            return entry.release;
        const completion = Promise.withResolvers();
        entry.release = completion.promise;
        void this.releaseInternal(entry).then(completion.resolve, completion.reject);
        return completion.promise;
    }
    async releaseInternal(entry) {
        if (this.entries.get(entry.agent.id) !== entry)
            return;
        const errors = [];
        const pending = [];
        for (const cleanup of [...entry.cleanups]) {
            entry.cleanups.delete(cleanup);
            try {
                pending.push(Promise.resolve(cleanup()));
            }
            catch (error) {
                errors.push(error);
            }
        }
        for (const result of await Promise.allSettled(pending)) {
            if (result.status === 'rejected')
                errors.push(result.reason);
        }
        try {
            this.detach(entry);
        }
        catch (error) {
            errors.push(error);
        }
        if (errors.length > 0)
            throw new AggregateError(errors, `native-agent: Agent ${JSON.stringify(entry.agent.id)} cleanup failed`);
    }
    runWithInitiator(agent, operation) {
        this.assertAccepting();
        return this.initiatorRuns.run(() => this.initiators.run(agent, operation), isNativePromise);
    }
    assertAccepting() {
        if (this.state !== 'active')
            throw new Error(DISPOSED_INITIATOR_MESSAGE);
    }
    assertReadable() {
        if (this.state === 'disposed')
            throw new Error(DISPOSED_INITIATOR_MESSAGE);
    }
}
/** Native Agent lifecycle Provider with no configuration surface. */
export const plugin = {
    apiVersion: 1, name: '@deepseek-ai/dsh-native-agent', targets: ['host'],
    requires: [], provides: ['agents'],
    resolve(input) {
        if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length > 0)) {
            throw new Error('native-agent: configuration must be empty');
        }
        return (context) => {
            const registry = new NativeAgentRegistry(context.events, context.signal);
            context.own(() => registry.dispose());
            context.provide('agents', registry);
        };
    },
};
//# sourceMappingURL=index.js.map