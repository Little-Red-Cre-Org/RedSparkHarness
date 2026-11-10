# Agent Note: What a Native session records when a tool or a child fails

Status: implemented

English | [中文](2026-11-10-native-failure-facts.zh.md)

## Problem

Migrating recorded sessions onto the Native profile turned up four places where the Native runtime lost facts the compatibility loop records. None of them breaks a happy-path run, which is why they survived: each one only shows up when something goes wrong, and the thing that goes wrong is exactly what the durable log is supposed to explain afterwards.

- A failing model call reached `turn/end` as `code: UNKNOWN`. The adapter had already classified it — `AUTH`, `RATE_LIMIT`, `SERVER` — and the Native executor dropped that classification when it rethrew.
- A hook that recorded its own audit events appended them straight to the Session, bypassing the application's single pending batch, so the next persist failed with `append seq mismatch`.
- The subagent tool handed the parent model the child's complete content, including its reasoning blocks.
- A child that stopped early was reported as `Subagent ended: <reason>` with the reason's internal identifier and the child's partial answer discarded.

The last two are worse than they look: the first leaks a child's private chain of thought into its parent's context, and the second tells a model that something ended without telling it whether the child refused, was truncated, or errored.

## Decision

Record each fact the way the compatibility loop records it, and let the recorded sessions prove it.

**Turn failures keep their classified code.** `native-model-execution` rethrows the adapter's `LlmError` rather than a plain `Error`, and the turn boundary reads `code` off any `HarnessError` instead of hardcoding `UNKNOWN`. A fallback still exists for a genuinely unclassified throw, so the field stays total.

**Interceptors record through the application's appender.** The interception facts carry the invocation's `appendEvent`, and both hook bridges write `hook/invoked` and `hook/result` through it. The application owns one contiguous pending batch; an event that bypasses it is not merely unsorted, it makes the *next* persist fail.

**A child result is its text.** The subagent tool filters the child's output to text blocks before rendering, matching the compatibility tool. Reasoning stays in the child's own log, where it was recorded, and does not become the parent's context.

**A non-completed child reports what happened and what it produced.** Each stop reason gets the compatibility headline (`hit its token limit before finishing`, `declined the task`, `was cancelled`, `failed`, or a named fallback for a merge-extensible reason), and the child's partial text is preserved **in the same block**, which is the shape the compatibility result renders.

## Consequences

A failed turn now says why: the Web client's existing `AUTH_STATUS` matcher recognizes a credential failure again, and an operator reading a cold Session can tell an expired key from a rate limit without the model-facing prose.

A hook can enforce a policy and record that it did. Before this, a `PreToolUse` hook that denied a call corrupted the log flush; the recorded `hook-cc-pretool-deny` scenario now covers exactly that path.

A parent model sees a child's answer and not its reasoning. This is a behavioural narrowing for the Native tool: a child that reasoned its way to a short answer no longer hands that reasoning to the parent.

A truncated child still contributes its partial answer, so a parent can act on what the child managed to produce instead of only knowing that it stopped.

## Alternatives considered

- **Leave `UNKNOWN` and let the message carry the diagnosis.** Rejected: the code is what the durable log and the Web client branch on; a message match is a string heuristic, and the Web client already had a code-shaped matcher written against the compatibility behaviour.
- **Add `appendEvent` to the bridge's own interface instead of the interception facts.** Rejected: the facts are what the registry hands every interceptor, and any interceptor recording audit facts needs the same capability. Putting it on the bridge would have made the second bridge duplicate it.
- **Keep passing every child block through and rely on the parent model to ignore reasoning.** Rejected: the compatibility tool never did that, and a model does not reliably distinguish "a child's private reasoning" from "context I should use".
- **Report only the headline for a non-completed child.** Rejected: it discards work the child actually did, and the compatibility tool preserves it.
