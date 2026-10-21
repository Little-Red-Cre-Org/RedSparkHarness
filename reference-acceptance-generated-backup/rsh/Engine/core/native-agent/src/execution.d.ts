/** Per-Agent FIFO execution and exclusive idle maintenance without Session ownership. */
import type { NativeAgent, NativeAgentRegistry } from './index.ts';
/** Observable execution admission state for one persistent Agent. */
export type NativeAgentExecutionStatus = 'idle' | 'running' | 'maintenance' | 'closing' | 'disposed';
/**
 * Serializes operations for one registered identity. Disposal cancels queued work
 * and awaits the active body; registration and durable Session writes remain owned
 * by the caller. An operation must not await disposal of its own execution owner.
 */
export declare class NativeAgentExecution {
    private readonly agents;
    readonly agent: NativeAgent;
    private readonly queue;
    private readonly cancellation;
    private active;
    private closing;
    private disposed;
    private readonly drained;
    private readonly releaseCleanup;
    private readonly lifetime;
    private readonly onLifetimeAbort;
    /**
     * @param agents - registry owning the exact Agent and its initiator attribution.
     * @param agent - registered identity retained across operations.
     * @param lifetime - optional host cancellation; closes admission before draining.
     */
    constructor(agents: NativeAgentRegistry, agent: NativeAgent, lifetime?: AbortSignal);
    /** Current admission and execution state; an active cancelled body remains closing until it exits. */
    get status(): NativeAgentExecutionStatus;
    /** Agent execution lifetime; aborts when disposal starts, independently of any current model turn. */
    get signal(): AbortSignal;
    /**
     * Queue one operation in admission order, preserving its result or rejection.
     * @param task - body executed with this Agent as initiator and composed cancellation.
     * @param signal - caller cancellation, including while the operation is queued.
     * @returns the body result after it exits; cancelled queued bodies never start.
     */
    run<T>(task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T>;
    /**
     * Reserve idle execution synchronously; later turns queue behind this maintenance.
     * @param task - exclusive maintenance with Agent-owned cancellation.
     * @returns the preserved maintenance result after the body exits.
     * @throws synchronously when another operation is active or already queued.
     */
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>;
    /**
     * Close admission, cancel pending work and wait for the active body to exit.
     * @returns the same quiescent disposal promise on every call.
     */
    dispose(): Promise<void>;
    private enqueue;
    private startNext;
    private perform;
    private finishDisposal;
    private assertAccepting;
}
//# sourceMappingURL=execution.d.ts.map