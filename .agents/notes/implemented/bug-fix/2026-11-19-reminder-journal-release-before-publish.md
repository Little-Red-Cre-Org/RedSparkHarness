# Agent Note: Publish a reminder journal only after its writer closes

Status: implemented

English | [中文](2026-11-19-reminder-journal-release-before-publish.zh.md)

## Problem

The compatibility scheduler's reminder journal created or resumed a Session, flushed it, and then published its identity with `store.bindReminderSession` while the write handle was still open. The loader smoke polls the published run until `sessionId` appears and immediately resumes that conversation. Under parallel load the resume lands between publication and the handle's `dispose()`, so the JSONL backend rejects the second write claim with `SessionAlreadyOwnedError`. `removeReminderRecord` had the same publication order for its replacement conversation.

The package suite also carried an independent red test. `MockAdapter` declares `defaultMaxTokens` but inherited `LlmAdapter.prepareCall`, whose `supportsOutputTokenLimit` always returns false. `native-model-execution` therefore refused every maxTokens-carrying request, including the restart test that asserts the persisted configuration.

## Decision

`startReminderJournal` now publishes `bindReminderSession` only after `handle.dispose()` releases the write handle, and `removeReminderRecord` binds and archives only after its writer closes. A journal resume that loses the ownership race to a caller skips that task for the current tick and retries later; the caller holds the session and owns its flush. `MockAdapter.prepareCall` reports that the scripted generation enforces a ceiling up to the `defaultMaxTokens` it declares.

## Verification

- A new `reminder-journal.spec.ts` test records `flush`, `dispose`, then `bind`; it fails if publication moves before release.
- The task-scheduler directory passes 126 tests with 1 skipped across three consecutive runs.
- The real-loader smoke passes, including the journal inspection, replacement, and deletion steps.
- The Native restart test now reaches its persisted-configuration assertion instead of failing on `maxTokens`.

## Alternatives considered

### Why not retry only in the loader driver?

The driver is a stand-in for a user opening the scheduled conversation. A retry there would hide the product race that any caller of `agents.resume` can hit during a journal write.

### Why not keep the journal handle open between ticks?

That turns a transient race into a persistent refusal: every user resume of that conversation would contend with a writer that never releases.

### Why not have the mock reject `maxTokens`?

The mock declares the limit it can serve. Rejecting its own declared default makes the restart test assert a contract the test adapter can never satisfy, and it contradicts the model metadata the fixture supplies.

## Consequences

- A conversation identity observed through the scheduler can be resumed immediately without contending for the write claim.
- A journal task can lag one tick when a caller wins the open race; the next tick reconciles it from the durable store.
- The scripted adapter can exercise output-token forwarding, while a request above its declared default still reports that the generation cannot enforce the ceiling.
