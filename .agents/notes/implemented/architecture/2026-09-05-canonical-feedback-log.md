# Agent Note: Canonical feedback log and request delivery

Status: implemented

English | [中文](2026-09-05-canonical-feedback-log.zh.md)

## Problem

Editable message ratings need one durable authority that Session export and request delivery can retain. A separate feedback store makes those consumers incomplete and introduces a second commit relationship with the target message. Recording a human judgment must not change model input or imply that a collector accepted it.

## Decision

The canonical Session log owns feedback. Session-level remarks use `feedback/record`; material message edits and deletions use `feedback/message-put` and `feedback/message-delete`. All are log-only. The service folds current items from events matching the requested `sessionId`, so inherited parent events do not become a fork's current feedback. Deletion removes the current item, not earlier ratings or notes from the log.

Live message-feedback mutations append through the owning Session and await its durability checkpoint; cold mutations hold a persistence write handle across read, comparison, append, and flush without creating a Session or Agent. A matching no-op appends nothing but still awaits persistence. Failures propagate, and a failed live flush can leave an observable in-memory item for retry. Per-item versions prevent unrelated message edits from conflicting; strict stale-write rejection prevents ABA overwrites even when the desired value matches. Target validation binds a judgment to a sent assistant message, and forks keep independent judgments. These choices retain rationale recorded in the [archived sidecar decision](../../archived/architecture/2026-08-10-message-feedback-sidecar.md), whose storage and commit mechanism is superseded.

The existing opt-in [session-log-deepseek contribution](../../../../rsh/Modules/Official/llm/session-log-deepseek/README.md) includes feedback in the ordinary `dsh_session_log` suffix on a subsequent eligible request. It uses the existing DeepSeek destination selection and acceptance watermark. There is no separate `dsh_feedback` uploader, feedback-triggered LLM request, or model-input field. The [explicit-feedback OTel decision](2026-09-05-nonofficial-feedback-otel.md) owns the independent feedback-triggered upload for all users and providers.

Native feedback Providers emit `feedback/committed` after flush and canonical readback verify the event; message feedback supports both live writes and cold persistence leases. Native telemetry authorizes a prefix from that shared event and redacts copied records. Native Host shutdown drains admitted application work before closing event observers and releasing Providers; the Native Web application waits for its HTTP listener to close so admitted RPC mutations finish inside that drain. This keeps feedback log-only without a second writer, durable outbox, or delegated-owner retention path.

Published Native declarations keep `dsh-native-runtime` and `dsh-launch-environment` as peers, and `@opentelemetry/otlp-exporter-base` plus the Native feedback types as production dependencies. The Native session client also keeps command-feedback as a runtime dependency because its request validation reads `FEEDBACK_CATEGORIES`.

The Cordis command confirms recording with the Session and anonymous user ids, without depending on telemetry or disclosing its policy; its append remains unflushed. The Native `/feedback` command waits for its owner flush and canonical readback before confirming durable recording. Neither acknowledgement confirms collector delivery. These behaviors supersede the command-copy decision in the [archived sharing disclosure note](../../archived/feature/2026-08-07-feedback-acknowledgement-sharing-disclosure.md). The [telemetry service's policy API](../../../../rsh/Engine/session/session-telemetry/README.md#the-sharing-disclosure) remains independently available: a backend discloses its policy, not delivery or retention, and the optional OTel package does not own that vocabulary.

## Alternatives considered

**Keep the sidecar.** It supports destructive local edits, but cannot make feedback part of ordinary canonical-log export and delivery without another join and durability relationship.

**Reuse `feedback/record` for message edits.** A free-text Session remark does not identify an item mutation. Distinct events preserve message identity and deletion semantics; upload policy remains consumer-owned.

**Add a dedicated feedback uploader or immediate LLM request.** The opt-in log contribution carries canonical events on eligible requests. The existing OTel pipeline independently handles explicit-feedback uploads for all providers, without a custom feedback uploader or another model request.

**Retain a live owner for background telemetry.** Delegated owners cannot be retained as root background work, and cold writes have no live owner. One post-durability commit event covers root, delegated, and cold feedback without adding another writer.

**Rely on Web Host resource disposal to drain direct RPCs.** The Native Web application waits for the HTTP listener's `close()` before it exits, so admitted RPC mutations remain live while Native Host drains its application and event work.

## Consequences

Feedback survives ordinary log export and replay without consuming model-input tokens or changing KV Cache. Current-item deletion is not erasure. The DeepSeek request contribution can leave final feedback local until another eligible request; OTel sends an authorized batch independently under its own policy. The Web controller remains a unary Remote consumer and does not consume feedback log events for cross-tab updates.

[Message-feedback tests](../../../../rsh/Modules/Official/feedback/message-feedback/tests/message-feedback.spec.ts) cover material events, no-ops, strict versions, fork isolation, and persistence failures. The [request contribution tests](../../../../rsh/Modules/Official/llm/session-log-deepseek/tests) own suffix acceptance and retry; the [command tests](../../../../rsh/Modules/Official/feedback/command-feedback/tests/command-feedback.spec.ts) pin the plain confirmation.
