import type { SessionEvent } from './types.ts';
/**
 * Validate an exclusively owned event and deeply freeze its identified message
 * without copying the event. The caller transfers an object graph that no
 * producer retains and that shares no mutable children with another event.
 * Use {@link snapshotSessionEvent} when exclusive ownership is not guaranteed.
 * @param event - exclusively owned event imported across a trusted boundary.
 * @returns the same event object with a validated, deeply frozen message.
 * @throws when event-local surface metadata, request-header fields, or message invariants are invalid; history relations are not checked.
 */
export declare function adoptSessionEvent<T extends SessionEvent>(event: T): T;
/**
 * Detach one event while preserving deep immutability for its identified message.
 * @param event - event imported across a query or persistence boundary.
 * @returns a detached event snapshot with a validated, deeply frozen message.
 */
export declare function snapshotSessionEvent<T extends SessionEvent>(event: T): T;
/** Validate the fixed event envelope after one-pass JSON materialization.
 * @param value - decoded event.
 * @param index - expected event position.
 * @returns narrows the decoded event after validation.
 */
export declare function assertSessionEventEnvelope(value: unknown, index: number): asserts value is SessionEvent;
/** Parse one decoded event using the current Session seed/message validators.
 * @param value - exclusively owned wire event.
 * @param index - contiguous history position.
 * @returns validated event; unknown types require the ignorable marker.
 */
export declare function parseSessionEvent(value: unknown, index: number): SessionEvent;
//# sourceMappingURL=event-validation.d.ts.map