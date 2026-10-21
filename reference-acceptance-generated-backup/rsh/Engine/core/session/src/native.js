/** Cordis-free Session values and event vocabulary for native consumers. */
export * from "./types.js";
export { SessionPreparation } from "./preparation.js";
export { interruptedTurnClosers, TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN } from "./repair.js";
export { deriveEventMessage, foldSurface, isAppendSurfaceEvent, isReplacementSurfaceEvent, isSurfaceEvent, isSurfaceEligibleType } from "./surface.js";
export { canonicalHeader, foldRequestHeader, headerEquals } from "./request-header.js";
export { KNOWN_SESSION_EVENT_TYPES } from "./known-event-types.js";
export { adoptSessionEvent, snapshotSessionEvent, Session, SessionForkError, decodeSeqRanges, encodeSeqRanges } from "./session-core.js";
//# sourceMappingURL=native.js.map