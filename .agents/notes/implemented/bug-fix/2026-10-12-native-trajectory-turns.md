# Agent Note: Native Trajectory preserves durable turn timing

Status: implemented

English | [中文](2026-10-12-native-trajectory-turns.zh.md)

## Problem

Native Trajectory derives its ledger from the current event window. Message-only projection loses failed turns that have no assistant message, and an assistant record without persisted step timing estimates duration from a previous visible message.

## Decision

The Native projection retains `turn/start`, `turn/end`, step boundaries and assistant attempts in its event locations and request records. Assistant message timing uses the matching persisted `step/start` timestamp. Failed turns without assistant messages remain separate turn rows and preserve their failed request record. The shared layout places user and context input in the durable turn recorded in its event location, falling back to the following assistant only when no location exists, so a failed turn keeps its own prompt instead of lending it to the next turn. System prompt cells likewise use the turn recorded by their `system/message` event, so an initial prompt recorded in a failed turn no longer opens the next successful turn and reverses the order. A system prompt counts as initial only when it belongs to the earliest turn in the loaded event window, so a window that starts after turn 1's prompt keeps turn order. A `user/message` at the start of the window, before any `turn/start`, takes the turn of the next event that records one, and any turn-bearing event sets the current turn for later input, so a failed turn's prompt stays in that turn. Tool results whose call is outside the window use the turn and step recorded by their event instead of folding into turn 1.

## Alternatives considered

**Infer duration from neighboring visible messages.** That can start an assistant span before its persisted step and changes when unrelated messages are present.

**Project only user, assistant and Tool result events.** That removes turn boundaries and empty failure records needed to preserve durable turns.

## Consequences

The Native view can display empty failed turns and accurate assistant step start times from the events already loaded by its controller. Focused regression cases cover persisted assistant timing and a failed turn followed by a successful turn, including each turn's prompt and system prompt placement; a windowed case covers windows that start after the first turn's system prompt, at a failed turn's prompt, mid-step, or at a tool result.
