/** Returned-Promise lifetime tracking shared by native and compatibility Agent registries. */
import { AsyncLocalStorage } from 'node:async_hooks';
/** Counts nested initiator operations without owning Agent attribution or admission. */
export class InitiatorRunTracker {
    runs = new AsyncLocalStorage();
    active = 0;
    completion;
    /** Track an operation while preserving its exact return identity.
     * @param operation - registry-owned attribution boundary.
     * @param isPromise - the registry's existing returned-Promise classification.
     * @returns the exact synchronous value or Promise returned by the operation.
     */
    run(operation, isPromise) {
        const run = { active: true, parent: this.runs.getStore() };
        this.active += 1;
        let result;
        try {
            result = this.runs.run(run, operation);
        }
        catch (error) {
            this.release(run);
            throw error;
        }
        if (isPromise(result)) {
            try {
                void Promise.prototype.then.call(result, () => { this.release(run); }, () => { this.release(run); });
            }
            catch {
                // A branded Promise's failing species prevents attachment; retain its exact return without leaking the run.
                this.release(run);
            }
        }
        else
            this.release(run);
        return result;
    }
    /** Exclude the teardown's current nesting chain and wait for unrelated operations.
     * @returns pending completion, or undefined when nothing remains to drain.
     */
    drainReentrant() {
        let run = this.runs.getStore();
        while (run !== undefined) {
            this.release(run);
            run = run.parent;
        }
        if (this.active === 0)
            return undefined;
        this.completion ??= Promise.withResolvers();
        return this.completion.promise;
    }
    /** Disable asynchronous run tracking after admission is closed and draining completes. */
    disable() { this.runs.disable(); }
    release(run) {
        if (!run.active)
            return;
        run.active = false;
        this.active -= 1;
        if (this.active !== 0)
            return;
        this.completion?.resolve(undefined);
        this.completion = undefined;
    }
}
//# sourceMappingURL=initiator-runs.js.map