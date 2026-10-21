# Agent Note: Native Trajectory preserves durable turn timing

Status: implemented

English | [中文](2026-10-12-native-trajectory-turns.zh.md)

## Problem

Native Trajectory derives its ledger from the current event window. Message-only projection loses failed turns that have no assistant message, and an assistant record without persisted step timing estimates duration from a previous visible message.

## Decision

The Native projection retains `turn/start`, `turn/end`, step boundaries and assistant attempts in its event locations and request records. Assistant message timing uses the matching persisted `step/start` timestamp. Failed turns without assistant messages remain separate turn rows and preserve their failed request record.

## Alternatives considered

**Infer duration from neighboring visible messages.** That can start an assistant span before its persisted step and changes when unrelated messages are present.

**Project only user, assistant and Tool result events.** That removes turn boundaries and empty failure records needed to preserve durable turns.

## Consequences

The Native view can display empty failed turns and accurate assistant step start times from the events already loaded by its controller. Two focused regression cases cover persisted assistant timing and a failed turn followed by a successful turn.
