# Agent Note: Native foreground Subagent spawn

Status: implemented

English | [中文](2026-10-05-native-subagent-spawn.zh.md)

## Problem

Native SDK descendant observation has no production Subagent Consumer or selected Provider. Scoped tool restrictions alone cannot constrain implicit Headless builtin tools, and delegated approval requests can expand child authority. Transient cancellation closes durable events outside active-owner observations.

## Decision

Compose a native foreground service and spawn Provider with the native tool-subagent Consumer. Reuse Program-owned Session execution, logged request configuration, depth and writer ownership. The Cordis-free protocol package owns shared descriptors, output folding, permission text and the merge-extensible Subagent stop-reason map; the service package re-exports its stop-reason types, while Providers extend the map on the protocol package root. Resolve child budgets, route, persona and tool restrictions explicitly; disable implicit builtin tools. Delegated approvals record the existing rejection audit without consulting a permission-expanding answerer. Use the existing owner repair operation for every interrupted invocation.

## Alternatives considered

A second Agent loop or writer duplicates execution authority. A parallel tool registry cannot constrain the existing dispatcher. Invented finished notifications would confuse accepted Session settlement with the Provider’s completed result.

## Consequences

The native-sdk profile supports real foreground spawn and parent-visible actual output after child cleanup. One existing recorded scenario verifies both SDKs, actual tool restrictions, depth, token budget, scoped persona, delegated rejection, partial model-error output, child cancellation and cold parent recovery. The TypeScript and Python SDK consumers also project actual settled Provider results as `subagent.finished` under the exact observed lineage. Background jobs, continuable children, external backends, catalog projection and persona-variable interpolation remain separate capabilities; [SDK descendant event observation](2026-10-05-native-sdk-descendant-events.md) owns the wire projection.
