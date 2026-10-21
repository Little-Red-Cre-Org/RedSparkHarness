# Agent Note: Native Agent-owned background jobs

Status: implemented

English | [中文](2026-09-23-native-agent-jobs.zh.md)

## Problem

The native Host had Agent identity and tool approval, but no framework-free way to retain a long-running operation, fence it to its owner, request cancellation, and drain it before the Host released its providers. Reusing `ctx.jobs` would reintroduce the legacy service, scope, and Agent authorities into native profile execution.

## Decision

`@deepseek-ai/dsh-native-jobs` provides `jobs` after `agents`. It starts only under the exact registered `NativeAgent`, allocates kind-prefixed opaque ids, retains a private mutable record, and returns detached snapshots. All reads, waits, and cancellation repeat the exact-object check. A later Agent object with the same id cannot observe a prior job after the earlier Agent is unregistered.

Runners receive a cooperative `AbortSignal` and resolve one explicit terminal outcome. A synchronous throw or rejected runner becomes a failed job record, while `cancel()` only requests cancellation and leaves the runner's terminal outcome authoritative. Registry disposal blocks new admission, aborts every live runner, and waits for them to settle. Agent release makes the owner unavailable, aborts and drains its live runners, and only then publishes the paired Agent disposal event. Jobs own no Session writer or model rendering; an application that later projects native shell, subagent, or workflow work owns bounded output and durable events.

Native Agent teardown now receives the Host cancellation signal. Host shutdown closes event admission before owned providers drain, so remaining Agent entries release without trying to emit into that closed bus; ordinary explicit deregistration continues to emit paired lifecycle events.

## Alternatives considered

**Use the legacy JobRegistry from the native application:** This would create a second runtime authority and require Cordis Agent and scope objects.

**Authorize by Agent id alone:** An id can be reused after a prior Agent exits, so it would disclose or cancel old work to a replacement identity.

**Treat cancellation as a forced terminal state:** A shell, worker, or remote subagent may settle after an abort request; recording an invented result would misstate the work's outcome.

## Consequences

The provider has an explicit per-Agent concurrency configuration and has no browser, RPC, tool-schema, Session, or process-kill layer. Native producers must make their runner cancellation-cooperative and introduce their own Session projection with the model-visible result. Legacy `dsh-jobs` remains available to Cordis profiles until the later default-assembly phase.

## Verification

Native Host tests cover completion/output reads, exact-owner isolation, pre-start concurrency refusal, explicit cancellation, Host disposal drain, manual Agent-release cancellation and drain before lifecycle publication, and remaining Agent cleanup after event admission closes.
