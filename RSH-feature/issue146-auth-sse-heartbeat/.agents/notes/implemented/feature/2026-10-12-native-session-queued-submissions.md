# Agent Note: Native Session queued submissions

Status: implemented

English | [中文](2026-10-12-native-session-queued-submissions.zh.md)

## Problem

Native Web `session/prompt` admits one turn and rejects a second busy submission. The Client cannot express queued work or mid-turn steering with stable request identities.

## Decision

The Host exposes `session/queue` and `session/steer` on the exact active root owner, using its existing `next-turn` and `next-step` inboxes. `session/dequeue` removes an identified request while it remains pending. The caller's request id is the durable user-message id. Queue and steer resolve after the inbox append is durable. `session/submissions` folds the durable event prefix and returns each pending full message with its `throughSeq` cursor.

`session/submission/edit` replaces the complete content of a pending message with text blocks while retaining its id, source, and position. It records the replacement through the existing splice event and returns `updated` or `stale`. `session/submission/promote` moves a queued message to the end of `next-step` in one `agent/inbox/moved` event; `stale` means it is no longer pending and `not-promotable` means it is already in `next-step`. Both operations use the exact root owner. Cancellation before synchronous admission rejects the operation; after an event is accepted, the owner waits for its existing persistence barrier. Teardown after a committed move leaves the pending fact for recovery and skips only the wake.

Before claiming inputs, Headless compares the original complete eligible inbox snapshot after asynchronous instruction and context preparation. A changed candidate keeps the input pending and repeats input-dependent preparation; the Program synchronously removes only the unchanged selected inputs at the claim point.

An observed prompt follow emits `submission-update` frames after durable acceptance, after an accepted input is canceled before model admission, and after its user message's turn ends. An RPC refusal includes the request id in its error details. Plain prompts keep the one-pending-turn rule from [ordinary send ordering](../simplification/2026-07-17-one-send-one-turn.md).

## Alternatives considered

- **Keep a Web-only in-memory queue:** rejected because accepted work would not survive Host restart or use the durable Session inbox.
- **Route both actions through `next-turn`:** rejected because the native inbox already distinguishes a later turn from the next model step.
- **Represent promotion as separate removal and insertion events:** rejected because the durable fold could observe an intermediate state between two facts; one move event expresses the transition as one inbox fact.

## Consequences

Queue, steering, editing, and promotion use the Session log's identified messages and inbox events, without another execution queue or writer. Queue and steer accept input only while this controller owns an active root browser turn. Editing preserves the pending message identity and location while replacing its text-only content; promotion records one durable move and wakes the existing driver only while its owner remains open. The durable submissions read returns a cursor with full pending messages, while the optional prompt follow carries lifecycle frames.
