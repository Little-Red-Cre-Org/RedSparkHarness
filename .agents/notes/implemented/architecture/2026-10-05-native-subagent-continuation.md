# Agent Note: Native continuable child admission

Status: implemented

English | [中文](2026-10-05-native-subagent-continuation.zh.md)

## Problem

A parent needs to address the same child across turns and process restarts without creating another Agent driver, Session writer or inbox. Message acceptance is independent of the child's response.

## Decision

The selected Subagent Provider owns continuation handles over the Program's existing continuation authority. Fresh materialization persists the shared descriptor before admitting initial input. Direct-child cold activation authorizes durable parent identity, workspace and depth, restores route, persona and tool restrictions from the descriptor, and resolves activation budgets from immutable deployment defaults. Native control tools record actual calls and results through NativeTools; adjacent messages use the shared logged attribution and return guidance.

## Alternatives considered

A second child history or message queue duplicates Session ownership. Reusing the live parent's mutable budget or model choices changes a stored child's composition. Returning a result from message admission confuses acceptance with child completion.

## Consequences

Continuable deployment requires controls bound to the same Provider and Tools registry. run_in_background:false retains ordinary one-shot execution. Delivery is serialized per recipient, and startup or cold-admission failure drains newly materialized ownership. Interrupt parks unclaimed input; another message wakes it. Parent disposal and Provider unload drain child execution and preserve cleanup failures. Both SDKs observe accepted child events through their existing Session-tree subscriptions. Catalogs, external backends, persona interpolation and automatic finished-result notifications remain independent capabilities.
