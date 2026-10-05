# Agent Note: Native Web conversation uses the selected Host executor

Status: implemented

English | [中文](2026-10-05-native-web-conversation.zh.md)

## Problem

The native Web boot and Session RPC packages had no conversation consumer, so users could not create or resume a Session from the page.

## Decision

The native Client application consumes the existing Session RPC Consumer and supplies only conversation interaction and presentation. It creates or selects a persisted Session and submits human text through the sole Host turn executor. The selected renderer owns the React root; the application owns its view controller and outstanding calls.

Cancellation changes the view to stopping without declaring readiness. The send operation remains pending through Host writer cleanup and durable history refresh. Application release aborts owned calls and awaits their settlement; removing React does not release execution ownership early.

## Transcript and composition

Human transcript rows use append-origin Session events and the shared message projection. Model-only replacements cannot erase conversation the user already saw. Raw durable records preserve tool and permission facts that the minimal page does not yet present as feature cards or interactive decisions.

The first-use native Client roster contains installed Providers and Consumers only. The page owns a complete typed English/Chinese dictionary pair and accepts explicit locale configuration. It does not create a Settings authority or change the legacy default composition.

## Alternatives considered

**Polling history or status.** Polling cannot prove execution progress and adds an independent scheduling lifecycle. Settlement refresh reads durable records; realtime delivery is defined by the [following decision](2026-10-05-native-web-session-follow.md).

## Consequences

The page refreshes durable transcript after settlement. [Realtime following](2026-10-05-native-web-session-follow.md) uses the same admission and settlement authority; polling history or status would falsely present a guessed execution stream. The [package reference](../../../../rsh/Programs/Web/client/native-application/README.md) owns the supported interaction limits.

The existing authenticated HTTP case exercises cancellation with delayed model cleanup through the conversation controller. The keyless native-web scenario exercises the built page through its shipped Client roster, records its user-visible transcript and restores that transcript after reload. Focused compiler and native dependency checks cover the changed Client and resolver declarations.
