/** Counts nested initiator operations without owning Agent attribution or admission. */
export declare class InitiatorRunTracker {
    private readonly runs;
    private active;
    private completion;
    /** Track an operation while preserving its exact return identity.
     * @param operation - registry-owned attribution boundary.
     * @param isPromise - the registry's existing returned-Promise classification.
     * @returns the exact synchronous value or Promise returned by the operation.
     */
    run<T>(operation: () => T, isPromise: (value: unknown) => boolean): T;
    /** Exclude the teardown's current nesting chain and wait for unrelated operations.
     * @returns pending completion, or undefined when nothing remains to drain.
     */
    drainReentrant(): Promise<void> | undefined;
    /** Disable asynchronous run tracking after admission is closed and draining completes. */
    disable(): void;
    private release;
}
//# sourceMappingURL=initiator-runs.d.ts.map