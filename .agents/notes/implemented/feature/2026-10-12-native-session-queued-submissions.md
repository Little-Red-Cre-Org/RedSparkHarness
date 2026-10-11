# Agent Note: Native Session queued submissions

Status: implemented

English | [中文](2026-10-12-native-session-queued-submissions.zh.md)

## Problem

Native Web `session/prompt` admits one turn and rejects a second busy submission. The Client cannot express queued work or mid-turn steering with stable request identities.

## Decision

The Host exposes `session/queue` and `session/steer` on the exact active root owner, using its existing `next-turn` and `next-step` inboxes. `session/dequeue` removes an identified request while it remains pending. The caller's request id is the durable user-message id. The RPC resolves after the inbox append is durable, and `session/submissions` reads both pending inboxes.

An observed prompt follow emits `submission-update` frames after durable acceptance, after an accepted input is canceled before model admission, and after its user message's turn ends. An RPC refusal includes the request id in its error details. Plain prompts keep the one-pending-turn rule from [ordinary send ordering](../simplification/2026-07-17-one-send-one-turn.md).

## Alternatives considered

- **Keep a Web-only in-memory queue:** rejected because accepted work would not survive Host restart or use the durable Session inbox.
- **Route both actions through `next-turn`:** rejected because the native inbox already distinguishes a later turn from the next model step.

## Consequences

Queue and steering use the Session log's identified messages and inbox events, without another execution queue. Queue and steer accept input only while this controller owns an active root browser turn; dequeue removes pending inbox input, an optional prompt follow carries lifecycle frames, and `session/submissions` reports the current pending inbox state.
