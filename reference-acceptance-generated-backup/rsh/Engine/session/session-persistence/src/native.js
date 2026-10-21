/** Provider-neutral Session persistence types, validation, and failures. */
export { SessionDeletionId } from "./deletion.js";
export { SessionPersistenceRevision } from "./revision.js";
export { SessionAlreadyExistsError, SessionAlreadyOwnedError, SessionFormatUnsupportedError, SessionHandleClosedError, SessionOwnershipLostError, SessionPersistenceCorruptionError, SessionPersistenceNotFoundError, SessionReadOnlyError, sessionFormatVersionRefusal, } from "./errors.js";
export { assertContiguous, assertStoredId, assertVersion, materializeAppendBatch, materializeCreateHeader, validateStoredEvents, } from "./storage-contract.js";
//# sourceMappingURL=native.js.map