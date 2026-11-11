# Agent Note: Native tracks every Session append

Status: implemented

English | [中文](2026-11-11-native-tracks-every-session-append.zh.md)

## Problem

Native persistence records only events passed to `NativeContinuationSession.track`. A tool result policy that calls `session.append` advances the in-memory sequence without entering that batch. The next tracked append then fails with `append seq mismatch`. The agent-instructions recording compacts the workspace baseline from inside the first `read` result, before the tool result is stored, so that scenario could not replay.

## Decision

`Session.onAppend` notifies after an event is in the log. The continuation owner subscribes for its lifetime and tracks each new event. `track` ignores an event already in the pending batch, so the existing `track(session.append(...))` calls stay single writes. `agent-instructions` replays through a Native profile. Its compaction fixture appends during `postResult`, and the persisted log keeps compaction before the first tool result. The delimiter directory is created only on non-Windows hosts, because its name contains `<`.

## Alternatives considered

**Leave compaction unpersisted.** The in-memory log would show the events, and the writer would reject the next append. The recording would not match.

**Require the fixture to hold the continuation owner.** Tool plugins receive the Session, not the writer owner. Passing the owner into every tool call would widen the tool execution type for one fixture.

## Consequences

Any append on a Session owned by a live continuation writer is durable, including appends from tool result policies. Closing the owner removes the subscription before the final flush. An observer throw does not roll back the accepted event.
