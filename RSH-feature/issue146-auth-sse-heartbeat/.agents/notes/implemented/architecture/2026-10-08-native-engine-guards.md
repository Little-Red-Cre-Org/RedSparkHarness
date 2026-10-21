# Agent Note: Native profiles install the Cordis base guards through registry and execution policies

Status: implemented

English | [中文](2026-10-08-native-engine-guards.zh.md)

## Problem

The Cordis base bundle installs three guards that native profiles lacked: provider-policy LLM retry, the declared tool-call timeout and the repeat-tool reminder. Each depended on a Cordis waterfall (`agent/request-error`, `tools/execute` or `tools/post-execute`) with no native counterpart. As a result, a native turn failed on the first transient provider error, a budgeted native tool could wait past its budget, and a model could repeat one call indefinitely without the advisory notice.

## Decision

Each guard package gains a Cordis-free `./native` installer next to its unchanged Cordis entry. The existing logic moved into a runtime-neutral `src/core.ts`: the retry decision and wait, the deadline enforcement, and the repeat detector with its configuration schema and text. Both entries call that same code; only plugin registration, service injection and lifecycle wiring differ per runtime. The installers use three narrow seams owned by existing services rather than a new event bus:

- `modelExecution.onRecovery` offers each recorded failed attempt, including an adapter that throws, together with the route's resolved retry policy and the caller's Session writer callbacks. Policies registered later run first and delegate at most once, matching the Cordis waterfall. A `retry` decision dispatches a fresh attempt for the same step. A model that declares no policy gets the LLM runtime default, as under Cordis.
- `tools.aroundExecution` wraps every body with the frozen tool declaration, including the new `timeoutMs` field. A policy must delegate exactly once and may pass a replacement signal, which is combined with the caller's signal.
- `tools.onSettlement` and `settlementContexts()` give the Session owner synchronous user-message contexts for each recorded result. Native headless and PTC dispatch call it once per settlement and prepend the contexts before the tool's own contexts, matching where Cordis places the reminder.

All five shipped native profiles install the three guards. The repeat reminder uses the base bundle's `[3, 5, 8]` thresholds and 500-character preview. `dsh-tool-fs-search` declares its glob and grep budgets, and keeps its internal timer as a fallback.

## Alternatives considered

A shared native event bus would re-create Cordis dispatch inside the native runtime. A retry wrapper inside each model Provider would duplicate policy and durable events for every adapter. Counting repeats from Session events after a step would miss nested program calls, and would place reminders after unrelated tool results. Reading projected retry history from the Session would need a native projection service that does not exist yet.

## Consequences

Parity tests run the same scenarios through the Cordis and native paths. They compare durable `llm/retry` and `llm/retry-started` events, delays, the `TOOL_TIMEOUT` result and reminder messages, and a native headless integration test drives all three guards through a real loop. Native retry history is in memory for the current step, so a Session resumed after a crash in the middle of a retry chain starts a new budget. A compaction that replaces the latest user message resets a native repeat chain. If the caller cancels after a native deadline fires, the registry reports the cancellation. Existing native profile directories are not rewritten; users who want the guards there add the three installations or recreate the profile.
