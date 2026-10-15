# Agent Note: Native Session Schedule

Status: implemented

English | [中文](2026-10-15-native-session-schedule.zh.md)

## Problem

Native Host profiles need durable reminders without loading the Cordis compatibility overlay. Replacing the Session event log with process-local timers or a second store would split reminder ownership, persistence, and replay from the existing Schedule protocol.

## Decision

Native profiles opt in to `@deepseek-ai/dsh-schedule/native`, which requires `activeSessions` and `tools`. The entry attaches to existing and future exact root Session owners, installs the three Schedule tools in that root Agent scope, and rejects calls from delegated Agents or another Session. Native Host completes owner attachment before capturing the first model request's tool snapshot, so the first turn includes these schemas when its tool allowlist permits them. If attachment or snapshot creation fails, the request does not reach the model and the turn follows the existing snapshot, owner, and writer cleanup path. Cordis keeps its separate package-root entry and load-order behavior; shipped Native profiles do not enable Schedule by default.

Both entries use the version-1 `schedule/change` Session events, strict fold, framing, and serialized management operations. Native reads and writes use the attached owner's flush, committed-event reader, and sole writer. A timer wake claims the root owner's idle operation. If a turn is busy, the awaited terminal idle hook processes due work through the same Agent FIFO before that writer is released. The owner waits for durable queue admission before appending and flushing the dispatch event. A cold Session is never woken and handles overdue reminders only when a root owner resumes it.

## Alternatives considered

**Use a process-local or global scheduler.** It would create a second owner and recovery protocol instead of deriving pending work from the original Session log.

**Install tools across all Agents or accept descendant calls.** Schedule mutations belong to one exact root Session, and descendant tools must not read or change that root's reminders.

**Replace Cordis or enable Schedule in Native defaults.** A separate opt-in Native entry preserves compatibility and lets each profile choose its Host capabilities explicitly.

## Consequences

- Native profiles that opt in must provide `activeSessions` and `tools`; tools attach to the exact root Session and not to delegated Agents.
- Dispatch records durable queue admission, not model completion or user acknowledgement. A crash after enqueue but before the dispatch append can repeat a reminder after recovery.
- Cold Sessions do no scheduling work or external notification; resuming a root owner rebuilds timers from the Session log and processes overdue records.
- Cordis behavior and shipped Native profile defaults remain unchanged.
