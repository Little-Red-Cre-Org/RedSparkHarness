# Agent Note: Native exact session-query entry

Status: implemented

English | [中文](2026-10-09-native-session-query-entry.zh.md)

## Problem

Native Engine consumers had no exact session-query capability. The existing `SessionQueryEngine` and `SessionCorpus` are Cordis services, even though Native already has the two authorities needed for exact reads: `activeSessions` for attached writable owners and `sessionPersistence` for durable read handles.

## Decision

Add the Cordis-free `@deepseek-ai/dsh-session-query/native` entry and publish `NativeSessionQueryOperations` as the same `sessionQuery` capability. The provider requires `activeSessions` and treats `sessionPersistence` as optional. It lists persisted headers and exact active owners together, prefers a current active owner for body reads, and checks immutable headers when both sources are observed.

Active body reads use the exact owner's `readEvents()` method. Cold reads reuse `readColdSessionLog()`, which closes the persistence read handle and balances an interrupted tail only in memory. Both paths replay-validate a detached clone through `Session.fromRestore()` and reuse the shared title fold and current-surface tracing functions. The validation Session never acquires a writer or enters the active-owner registry; the query returns the original read events, excluding any local resume marker. Query never inserts a Session into a store, creates a writer, or keeps a second cache.

This Native entry implements exact list, raw-log, title, and current-surface reads used by Native references. The wider Native query surface remains open: observations, session/event filters, event-window and exact-event reads, session/event traces, provider-independent search, SQLite indexes, and ranked full-text search are not implemented here. Authorization and external Host presentation keep their separate boundaries.

Native cross-session references consume this exact query service through the shared projection and retention path. They preserve newly admitted canonical URI input and return sourced context messages; `NativeAgentInstructions.prepare()` orders workspace instructions before reference contexts, and Native headless appends both through the existing Session writer. Preparation waits for started reads and spill writes to settle on failure or cancellation before returning, so the writer and selected services can drain after the operation completes. The persisted model input therefore differs visibly from Cordis `@label` replacement; this batch does not claim those representations are equivalent.

## Alternatives considered

**Reuse the Cordis `SessionCorpus`.** It requires `Context`, `sessions`, and optional-service injection; importing it would pull Cordis into the Native entry and would not read from `activeSessions`.

**Maintain a Native query cache or writer.** A second cache or writer could diverge from active owners and durable history. Per-call reads already provide the exact snapshots this entry exposes.

## Consequences

Native callers can read detached history and prepare durable untrusted references without importing Cordis. With no persistence service, the query can still list and read active owners; detached sessions are unavailable. Cold title and surface reads load and validate the complete log on demand, so large histories have the same whole-log cost as existing exact reads. Native observation, filter, event, trace, and full-text migration remain future work.

## Verification

The focused Native query examples cover a cold persisted list/title/log/surface read, including an inherited fork prefix, without Session attachment or storage mutation, and exact active-owner precedence when an owner is replaced during a read. A compiled Native CLI workflow replay proves that its original URI message and sourced reference snapshot are both durable and that the model request receives the captured source text. Target package type checks, normal leaf producers, and the selected examples pass; broader Native query, Host, and Client acceptance is not implied.
