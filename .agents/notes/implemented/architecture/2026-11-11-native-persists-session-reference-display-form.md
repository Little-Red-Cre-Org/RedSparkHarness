# Agent Note: Native persists session-reference display form

Status: implemented

English | [中文](2026-11-11-native-persists-session-reference-display-form.zh.md)

## Problem

Cordis rewrites a canonical `dsh-session:` mention to `@label` before storing the user message, and it appends the reference snapshot before the runtime-context message. Native built the snapshot from the canonical mention but stored that mention, and it appended the runtime snapshot first. A recording such as session-reference-spill therefore could not match. Rewriting the admitted inputs before prepare also removed the mention prepare needs, so the snapshot disappeared.

## Decision

`native-headless` calls `sessionReference.rewrite` only while appending admitted user messages. `agent-instructions.prepare` still receives the original inputs, and its contexts are appended before the runtime-context snapshot. A scenario that needs rows the twelve-row test profile omits passes the shipped profile directory as `profileRoot`. `session-reference-spill` replays through that profile, and `workflow-native` submits the canonical mention while expecting the stored display form.

## Alternatives considered

**Rewrite the admitted inputs before prepare.** The stored message becomes `@label`, but prepare then parses that display form and emits no reference snapshot. The spill scenario stayed at `user, plugin`.

**Keep storing the canonical mention.** `workflow-native` fixtures would not change, and the Cordis recording's display form would not match. The migration requires that recorded sequence.

## Consequences

A profile that installs `sessionReference` stores `@label` instead of the `dsh-session:` mention. The `workflow-native` parent fixture changes only that text. Profiles that do not install the service are unchanged, and the reference snapshot still carries the source fact.
