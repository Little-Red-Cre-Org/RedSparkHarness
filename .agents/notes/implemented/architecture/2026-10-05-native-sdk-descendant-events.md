# Agent Note: Native SDK descendant event observation

Status: implemented

English | [中文](2026-10-05-native-sdk-descendant-events.zh.md)

## Problem

Both SDKs discover descendant subscriptions from subagent.started, but the native application only publishes root execution events. Real Session-execution delegation therefore remains invisible to those subscriptions.

## Decision

The Program observes active delegated owners and authenticates their display root through its existing executor and exact SDK route. The admitted root or an already observed descendant must own the durable parent relation. A lineage notification precedes the child's backend-accepted Session events. Owner detachment withdraws the event listener while retained lineage permits the selected Subagent Provider to publish its actual settled result. Shutdown drains accepted execution before flushing the transport and then releases lineage observations. Root execution retains its own event projection and sole writer.

## Alternatives considered

A second event store would duplicate the Session log. Publishing every active owner would disclose other Programs sharing the selected Providers. Deriving subagent.finished from a Session header or turn-end event would invent the Subagent Provider result and stop reason.

## Consequences

TypeScript and Python session-tree subscriptions receive actual delegated descendants without changing their root response projection. Their shipped native profile projects `subagent.finished` only from actual one-shot or continuable Provider settlement matched to the exact observed lineage; completion, failure, cancellation, and shutdown settlement use the Provider result and durable child history. The event is not another durable result authority. One existing recorded Session scenario exercises these paths and a separate Program sharing Providers through both SDKs; durable child history retains its parent relation.
