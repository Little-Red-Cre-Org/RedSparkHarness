# Agent Note: Native authorization attempts drain before releasing their key

Status: implemented

English | [中文](2026-10-09-native-authorization-drain.zh.md)

## Problem

The Cordis authorization service settles a withdrawn attempt immediately and leaves the flow's run to finish on its own. A native Host must unload Providers deterministically, and a late credential write from an orphaned run could land after its owner was disposed or after the next attempt for the same key began.

## Decision

`@deepseek-ai/dsh-authorization/native` provides the `authorization` service without Cordis. A surface starts an attempt with `begin()`, reads replayable `AuthorizationFrame` values from `frames()`, and answers through `answer()`, `decline()` and `cancel()`. Every cancellation path aborts the flow's signal and settles the attempt only after `run()` returns. Native credential record writes accept that signal and check it when a queued write starts, before reading; once mutate begins the write always commits, so a write that has not started is refused and one that has started finishes before the key is released.

The Cordis service keeps its existing orphaned-run semantics; both entries share the flow, session, frame and error types.

## Alternatives considered

**Reuse the Cordis service's withdrawal semantics.** Rejected because a released key could then race with a still-running flow and its write.

**Put prompt bookkeeping in each Host transport.** Rejected because every surface would repeat the same prompt ids, replay and cancellation rules.

## Consequences

A flow that ignores its signal keeps `cancel()` pending; native flows must honor the signal. Surfaces refresh the model catalog after `settled` or `credentials/record-updated`; there is no separate catalog event.
