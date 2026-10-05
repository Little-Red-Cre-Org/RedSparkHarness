# Agent Note: Native todo writes use the selected Session authority

Status: implemented

English | [中文](2026-10-05-native-todo-session-authority.zh.md)

## Problem

Task-list updates must remain durable and attributable when the application selects the native Tool registry. Loading the Cordis projection registry would make that consumer depend on the compatibility runtime.

## Decision

The native todo Consumer registers through the selected native Tools and writes `todo/write` through the admitted invocation's durability callback. It requires the exact active Agent and Session owner, and rejects writes outside an open turn. Shared normalization and model instructions keep the parallelism policy and list constraints equal across both entries. The native read operation awaits the retained writer's history and folds whole-list replacements and turn starts; it owns no second task-list store.

## Alternatives considered

A separate mutable native list would create another state authority and require synchronization on resume and fork. Importing the Cordis projection service into the native consumer would retain the compatibility dependency. Synchronous Session history scans would violate the asynchronous historical-read policy.

## Consequences

The native entry requires `tools` and `activeSessions`. Explicit native templates install exactly one Session execution Provider so tool admission and durable writes share its selected owner, including native-web. Its returned counts follow durable acceptance; the native registry cancels and drains admitted calls when the registration leaves. The legacy entry and its UI projection remain available for compatibility profiles. This choice does not switch product defaults or migrate the native Client task-list UI.
