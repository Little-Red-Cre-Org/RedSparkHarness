# Agent Note: Omit an execution's own abort reason from root-notice cleanup failures

Status: implemented

English | [中文](2026-11-22-root-notice-expected-cancellation.zh.md)

## Problem

`NativeHeadlessApplication.queueRootWake` starts a root-notice turn through `recipient.run` with no caller signal. `NativeAgentExecution.dispose` aborts that execution with `{ kind: 'disposed' }` and rejects a still-queued `run()` with that same object. The wake's rejection handler recorded every rejection in `noticeFailures`. `disposeInternal` appends that array and, when any entry remains, throws `AggregateError` with message `native-headless: Agent cleanup failed`. Cancellation of a root-notice wake by that execution's own disposal was therefore reported as application cleanup failure. Host `close`, `release`, and `stop`, and `NativeWebSessionService.close`, only propagate that error.

## Decision

`queueRootWake` records a rejection in `noticeFailures` only when it is not strictly the same object as `recipient.signal.reason`, the reason created by that execution's `dispose` abort. Every other rejection is recorded, including a `{ kind: 'disposed' }` value that is a different object. The check does not inspect `kind`. `operationCancellation.signal.reason` is omitted only when it is that same object. `disposeInternal` is unchanged: any recorded failure still fails disposal with `native-headless: Agent cleanup failed`.

## Verification

`continuation-host.spec.ts` pins both outcomes. A queued root notice that rejects with `execution.signal.reason` lets `dispose()` resolve. A root notice that rejects with a different `{ kind: 'disposed' }` object makes `dispose()` throw `AggregateError` with message `native-headless: Agent cleanup failed` and `errors` equal to that object. These tests do not show that a Host request body, or the empty-body `native-session/subagent-follow` expectation, passes.

## Alternatives considered

### Why not omit every `{ kind: 'disposed' }` reason?

The kind is not unique to this execution's abort. A different object with the same fields can be a real cleanup failure, and filtering on the kind would drop it.

### Why not swallow the reason in Host `stop` or `NativeWebSessionService.close`?

Those callers only propagate disposal. Swallowing there would hide every `native-headless: Agent cleanup failed`, including rejections that are not this execution's abort reason.

### Why not drop the queued rejection inside `NativeAgentExecution.dispose`?

`dispose` still rejects a queued `run()` with its abort reason so the caller can observe cancellation. The notice path is the place that decides whether that reason is a cleanup failure.

### Why not compare with `operationCancellation.signal.reason`?

Application disposal aborts a different controller. A rejection matches expected cancellation only when it is `recipient.signal.reason`.

## Consequences

- An execution's own abort reason on a root-notice wake is expected cancellation and is absent from `noticeFailures`.
- A distinct rejection, including another `{ kind: 'disposed' }` object, still fails disposal and still propagates through the unchanged Host and session-service close paths.
- Classifying this rejection does not establish that a Host test body, or the empty-body follow expectation, already passes. Removing the misclassified cleanup error can leave an earlier body failure visible.
