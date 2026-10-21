# Agent Note: Persistent Agent task scheduler

Status: implemented

English | [中文](2026-09-15-agent-task-scheduler.zh.md)

## Problem

The existing Schedule plugin delivers reminders only to live owning root Agents. Independent scheduled coding work needs persisted plans, pause/resume, execution receipts, and startup recovery without requiring an open originating conversation.

## Decision

Explicit pause freezes the scheduled plan's remaining delay in the same transaction as its state. Resume derives a new occurrence time from that persisted delay, preventing paused wall-clock time from triggering catch-up reminders. Absolute end times remain authoritative.

Goal mode composes the existing goal domain and round driver instead of scheduling repeated edits. It persists objective and acceptance criteria with the plan and the execution session identity with the claim before work starts. Completion follows the durable goal phase. Explicit continuation restores the original Session, keeps previous evidence and grants bounded additional rounds. Uncertain interrupted work is never automatically replayed. SQLite schema 4 admits the optional goal fields while preserving earlier scheduled tasks.

The opt-in [task-scheduler](../../../../packages/automation/task-scheduler/README.md) plugin owns a dedicated SQLite plan and receipt database. A transaction claims an occurrence and advances its next time before creating an execution session. Repeated intervals coalesce; one-shot claims are not replayed. An expired claim records uncertainty and pauses its task. The execution adapter alone depends on the Agent factory, presets, workspace, permission, and session services. Each run uses a new normal session, preserving its actual transcript and durable turn settlement.

Scoped tools inherit workspace/model/preset selections from their creating root session. Scheduled execution sessions cannot schedule descendants. Loading does not silently enable tasks in shipped profiles. Disposal removes tools, aborts and drains owned runs, and preserves plans. `completed` means a durable Agent turn completed, never that code tests passed.

## Reminder outlet

A sidebar inbox and persistent unread count expose committed due and result notices without asking a model to deliver UI. The client owns one disposable poller independently of Settings; native notifications supplement the in-app dialog only after permission. SQLite v2 stores acknowledgement separately from receipt state, so marking a due card read preserves acknowledgement while a later outcome updates the same card. The client observes phase transitions independently of read status to deliver one native outcome banner without adding a second card. Retention bounds notices to 100 and prunes acknowledgement with receipts. This avoids coupling the scheduler to Electron while accepting connected-client polling latency and OS delivery limits. Tests cover migration, restart acknowledgement, fresh-result delivery, no repeated popup, native denial and disposal; the real Loader checks a generated run notice and acknowledgement.

## Alternatives considered

**Extend session-local reminders:** their explicit live-owner contract and v1 event stream serve a different use case. Changing cold-session wakeup would silently alter existing reminders; the independent plugin leaves them intact. This is an additive decision, not supersession of the durable-web-schedule note.

**Put timers in AgentLoop:** that couples scheduler persistence and startup to the coding loop and impedes the planned architecture refactor.

**Replay every missed or interrupted occurrence:** external code edits or requests cannot be atomically committed with a local receipt. Automatic replay could duplicate effects; interrupted work instead requires inspection.

## Consequences

Plans survive restart and do not depend on a live originating conversation. SQLite transactions coordinate concurrent claimers, while execution logs remain normal sessions. The cost is deliberately at-most-once automatic admission rather than exactly-once external execution: a crash after claim but before submission can lose an occurrence. The application must run to execute work. Calendar cron, external notifications, and total task/transcript retention remain outside this first version. Agent completion does not certify verification success.

## Testing

Store tests exercise two-connection claims, recurrence alignment, owner isolation, pause/delete, expired recovery and retention. Engine tests cover asynchronous settlement, failure, timeout and drained disposal. A real Loader composition mounts the production Agent loop, persistence, presets, workspace, and permission services with only model transport replaced; it creates a task through the actual tool and checks its durable execution receipt and model-facing description snapshot.

## Graphical management extension

Both global and owner-scoped history responses resolve reminder start times from retained task definitions, including deletion tombstones. Keeping this projection on the Host prevents visible-task filtering from changing history semantics. The Client consumes the projected timestamp directly and leaves unavailable starts blank. Store reopen tests, the real Loader create/execute/delete flow and rendered history snapshots cover the deletion regression without rewriting receipts.

The optional settings slot provides creation, pause/resume, confirmed deletion and retained receipts without modifying the shell. A generated Typert Remote gateway shares owner validation and creation policy with the tool. Client controllers serialize actions, surface rejected saves and suppress late publication after unload. Four controller tests and the real Loader gateway ownership checks complement a desktop exercise of create/pause/resume/delete using a future task; that task is deleted after verification, without model calls.

## Bounded schedule windows

History renders each receipt's persisted timestamps with second precision. Direct reminder details expose countdown start and generation times, because their immediate settlement is not the start of the user's wait. Later recurring occurrences use the preceding interval boundary; missing countdown information falls back to the recorded execution start. Generation does not certify visible notification delivery. Agent work retains three timestamps; positive durations below one second display as less than one second. Owner-local rendered snapshots cover both modes, an unfinished run and switching between distinct receipts; stored timestamps are never rewritten to manufacture a duration.

The task workspace groups creation, plans and actual history. An optional exclusive end time stops future admission, including startup catch-up, while allowing already admitted work to finish. This respects the user-selected distinction between scheduling a window and forcibly cancelling execution. Optional JSON fields preserve existing unbounded plans. Boundary, expired-startup, timezone and active-run tests pin the behavior.

Reminder deletion uses occurrence tombstones in schema v3, preserving scheduling receipts and suppressing later settlement updates. Sidebar deletion reuses the existing persistent archive authority and explicitly retains execution transcripts. Both actions require confirmation; failures remain visible for retry.

Windows toast delivery acknowledgements do not prove visible banners. The desktop preload therefore exposes a bounded text-only notification request to the authenticated primary app frame. Shell-owned, non-focusing windows render escaped text at the primary work-area bottom right, share one bounded window with independent results that expire after 20 seconds, and close at application quit.

## Natural-language schedules

Scheduled tasks now infer fixed intervals, relative waits, fixed durations, and manual-stop conditions from the task instructions. The creation form shows one reviewable summary by default and places recurrence, interval, and end controls behind Adjust time. Explicit instructions remain authoritative and make their matching manual controls read-only, preventing conflicts such as “5 minutes” in the instructions and “10 minutes” in the field. A missing schedule no longer silently means immediate execution: the user must add timing text or open the manual controls. A recurring plan always uses successful creation as its countdown origin, exposes no separate start-time control, and starts its first occurrence after one complete interval.

The client parser and Host admission share validation. Expressions such as `every 5 minutes`, `every half hour`, `for 1 hour`, and `until manually stopped` are persisted as numeric rules; conflicting intervals, missing units, durations no longer than the interval, and instruction/form disagreement are rejected. Daily and weekly Beijing clock phrases resolve to the next occurrence, without adding another countdown. Explicit cutoff clocks are parsed separately from the first occurrence. Monthly, yearly, workday, holiday, and count-limited schedules are rejected rather than approximated. Quoted payload text does not define timing; execution verbs before a reminder request preserve Agent execution.
