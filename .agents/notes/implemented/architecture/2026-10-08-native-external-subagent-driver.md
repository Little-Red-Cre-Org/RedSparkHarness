# Agent Note: Native external child ownership

Status: implemented

English | [中文](2026-10-08-native-external-subagent-driver.zh.md)

## Problem

A Native Subagent Provider needs to run a product-owned child while the selected Program retains Agent, Session and writer authority. The parent also needs durable readiness and settlement facts whose timing reflects the actual child lifecycle.

## Decision

The Host selects at most one `NativeExternalSubagentDriver`, and `providerName` must select that exact driver. `resolve()` issues a canonical one-use request bound to the exact active parent and invocation-root owners, their owner epochs, the selected driver and the resolved child route, workspace and limits. The Provider accepts only that returned request object; copies, replay and replaced owners fail before launch.

The driver receives `NativeExternalSubagentRequest`, a detached DTO with parent and root Session ids and epochs, resolved route, workspace, limits and authored task. It receives no Native Agent, Session, Cordis Context or writer. `start()` resolves only after the product reports actual child readiness. Native then appends and flushes `subagent/external-start` through the parent’s sole writer before notifying Consumers.

The driver’s `result` reports the child outcome or ordinary execution failure. Native separately awaits `dispose()` to confirm that the complete child range is quiescent before appending and flushing `subagent/external-end`. Parent detach closes new admission, cancels accepted children and awaits their range cleanup and terminal persistence while detached Consumers still have access to the writer.

An ordinary result rejection reaches the run caller after successful cleanup and does not fail parent or root owner drains or Provider disposal. A range-cleanup failure or parent start/end persistence failure is retained for the exact parent and root owners and for Provider disposal; no terminal event claims quiescence after failed cleanup.

## Alternatives considered

Passing Native owners or the Session writer to the product driver would give a product adapter authority over Program-owned identity and durable history. The detached DTO leaves those authorities with the selected Program and Provider.

Treating `result` settlement as proof of cleanup would allow `subagent/external-end` before the product has stopped every process in its range. The separate `dispose()` completion is the cleanup confirmation.

## Consequences

The external contract provides one-shot execution and parent-owned lineage only. Product readiness handshakes, process-range ownership and product-specific protocol remain the selected adapter’s responsibility; no local Session or child transcript is implied.
