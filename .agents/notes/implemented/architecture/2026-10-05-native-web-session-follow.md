# Agent Note: Native Web follows exact Host admissions

Status: implemented

English | [中文](2026-10-05-native-web-session-follow.zh.md)

## Problem

Settlement-only conversation cannot display accepted Session facts or assistant text while the Host turn runs. A disconnected browser must not release execution ownership before durable cleanup.

## Decision

The selected Connection supplies an authenticated Fetch response for a feature-owned SSE route. The existing turn admission owns its bounded feed; the route checks the exact Session and admission identity and permits one follower. No second Agent, Session writer, job registry or reconnect schedule is introduced.

The executor forwards accepted durable events and transient assistant text separately. The unread Host queue and active followers have explicit configured limits. Queue overflow cancels the exact turn and fails settlement; distinct execution or cleanup failures remain in the combined failure; detach releases unread data and its follower slot. Host disposal closes streams and drains the existing execution owner.

The Client uses maintained eventsource-parser framing and the existing Session parser. Malformed frames, premature EOF and observer failures cancel the admitted turn and await durable settlement. Caller abort detaches the stream but cannot make the prompt resolve before writer cleanup. A carrier lacking Fetch responses rejects observed prompts before admission.

The page appends durable facts to its shared transcript projection. Temporary text has a configured visible tail and an explicit truncation indicator; it disappears when the durable assistant record arrives or settlement refreshes history. Configured event limits reject excessive presentation state. Cold restore reads durable history only.

## Alternatives considered

**Polling status or history.** Repeated reads cannot identify real output progress and create another scheduler.

**An application WebSocket bus.** A second transport would duplicate authentication and teardown already owned by Connection. Feature-owned SSE keeps framing and exact admission delivery local.

## Consequences

The explicit native-web profile supplies Host queue/follower limits, Client parser limits and presentation limits. Existing explicit native configurations must supply these required fields; legacy defaults remain unchanged. Tool cards, approval and question replies and additional model chunk presentations remain separate Consumers.

The existing real HTTP case covers incremental text, durable event delivery, exact admission rejection and delayed cancellation cleanup. One bounded feed case covers overflow and detach. The built Chromium scenario records temporary assistant output, durable settlement and cold restoration through the shipped Client roster.
