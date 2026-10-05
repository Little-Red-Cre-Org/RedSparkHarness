# Agent Note: Native one-shot background Subagents

Status: implemented

English | [中文](2026-10-05-native-subagent-background.zh.md)

## Problem

Foreground delegation blocks its initiating tool call. Native SDK assemblies need real child execution that survives an ordinary parent turn and remains observable and cancellable under the same parent Agent.

## Decision

Use the existing NativeJobs registry and job controls with the selected spawn Provider. Delegate with Agent lifetime through the existing Session execution authority. Publish the child id and job handle only after onReady confirms initial durable turn facts. Startup cancellation remains caller-owned until publication; subsequent cancellation belongs to Jobs, parent Agent disposal or Provider unload. Background children retain the foreground permission, budget, depth and scoped-tool restrictions.

## Alternatives considered

A parallel result registry or output buffer duplicates Jobs ownership and retention. UUID reservation alone does not establish a durable child. Returning on cancellation without awaiting delegated cleanup leaves owned execution active.

## Consequences

Jobs retains bounded live text, replaces it with the real final output and settles only after delegated cleanup. A durable aborted child with the original cancellation reason, or an AbortError caused by that exact reason, settles as cancelled; unknown failures and cleanup errors remain failed. The shipped native-sdk profile installs the Jobs Provider and tool Consumers. One existing recorded scenario covers both SDKs, parent-turn survival, actual child output, cancellation and durable child closure. Continuable child messaging, catalogs, external transports, persona interpolation and finished-result notifications remain separate capabilities.
