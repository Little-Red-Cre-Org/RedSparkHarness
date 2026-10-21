# Agent Note: Native session query and projection backend

Status: implemented

English | [中文](2026-10-09-native-session-query-entry.zh.md)

## Problem

Native consumers need one query service over the attached Session owner and durable logs, plus full-text search and projections, without creating another Session writer or an independently implemented fold.

## Decision

`SessionQueryOperations` is the shared Cordis-free Definition implemented by Cordis and Native Providers. The Native source adapter reads active owners at a captured event cut and reads detached history through optional persistence handles. Active Sessions validate accepted history; cold logs are replay-validated on detached Sessions. Observation leases pin prepared cold revisions, and runtime close rejects new reads, cancels and joins accepted source work, then releases its turn-boundary registration.

The Native SQLite Provider combines exact operations and ranked search over that same source. Its Cordis-free core owns the derived FTS database, transactional reconciliation, and generation-bound cursors; it never becomes a Session store. Replacing a live owner advances the corpus generation even when its id, header, and events match, so earlier cursors fail stale. Exact-only compositions retain query operations and reject search with `SESSION_QUERY_SEARCH_DISABLED`.

Cordis and Native projection Providers use one fold registry. Cells are keyed by the exact resident Session object, and the Native Provider follows active-owner attachment and removal. The registry preserves state-version registration sharing, late-registration replay, inherited cuts, detached checkpoint values, and same-event change notifications. Native checkpoint writes use the selected cache only after the canonical Session writer flushes; the cache is a fold shortcut over the authoritative log. Closing query and projection Providers drains their owned reads, listeners, timers, and writes. Native projection activation releases earlier observer registrations if a later registration fails; shutdown attempts every observer and owner-event removal, clears registry state, and reports cleanup failures after all attempts.

Native projection detach disables event delivery and removes registry ownership even when the listener remover fails; stale callbacks cannot drive folds. A registration disposer cannot remove a later registration of the same key after the registry is cleared. Native cache checks current exact-owner membership before each attachment, including after awaiting earlier startup writes. Cache detach marks the owner state detached before calling its event-listener remover; even if removal fails, it attempts the final checkpoint, evicts the owner state, and reports the remover error. Cache close attempts every observer and owner-listener removal, drains final writes, closes the domain, and aggregates cleanup failures. A callback left registered by a failed remover cannot enqueue cache work.

Typert's shared-definition public type index includes source declarations from declaration-emitting project references in the same package and face. Only required `Context` members whose types resolve to a public export are service candidates; candidates whose exports resolve to anything other than a class or interface are rejected.

Change-feed and accepted-event observers are reported individually when they throw. The registry continues the remaining listeners and projection units, and accepted-event observers do not turn a successful durable append and flush into a writer failure.

The shipped `native-headless-query` profile selects the Native query, SQLite, projection, and cache Providers explicitly. Existing profile defaults remain unchanged. Engine tools and archive consumers use the shared query Definition; Host and SDK adapters keep their own ownership.

## Alternatives considered

**Create a second Native query Definition or fold implementation.** Separate authorities can diverge in filtering, observation cuts, and projection semantics. Cordis and Native instead adapt to one Definition and one projection fold.

**Give queries a Session writer or index the canonical persistence database.** A query-owned writer can race Session appends, and an FTS transaction can corrupt or rewrite the source log. The SQLite database remains a disposable derived index over read-only source ports.

**Select the Native query profile by default.** Existing compositions have established Provider choices and dependencies. The Native headless query profile is opt-in until release policy changes deliberately.

## Consequences

Native compositions can use the complete provider-independent query vocabulary and select ranked SQLite search without importing Cordis. Their search cursors are valid only for the corpus generation that produced them, and cold reads still pay the cost of loading authoritative event history when no compatible checkpoint shortens projection replay. Session format and writer ownership remain with the Session packages.

## Verification

The focused observer and owner-incarnation regressions pass: a throwing projection listener does not starve later listeners or units, a throwing Native accepted-event observer does not poison the retained writer, and replacing an identical live owner invalidates both session-search and event-search cursors.
