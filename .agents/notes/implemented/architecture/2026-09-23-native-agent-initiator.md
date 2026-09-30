# Agent Note: Native Agent identity and initiator registry

Status: implemented

English | [中文](2026-09-23-native-agent-initiator.zh.md)

## Problem

The native headless application runs real turns but had no live Agent identity, per-Agent scope, or asynchronous initiator owner. A tool contribution could receive a Session while background work still had no framework-free way to identify the Agent that started it.

## Decision

`@deepseek-ai/dsh-native-agent` provides `agents` to native Host profiles. `NativeAgentRegistry` records opaque nonempty Agent identities in explicit child `NativeScope` objects, emits paired `agent/created` and `agent/disposed` Host-local lifecycle edges, and removes an entry when creation notification fails. Each registration returns an idempotent disposer for its captured entry, so a stale disposer cannot remove a later same-id Agent.

The registry uses `AsyncLocalStorage` only in the Host package to preserve an explicit Agent through returned Promise work. `withInitiator()` and `withoutInitiator()` retain exact return values, reject new boundaries once disposal starts, and drain active boundaries before invalidating initiator reads. `onDispose()` accepts resource cleanup only while an exact Agent remains available; Agent release then makes the identity unavailable, drains those callbacks, and publishes `agent/disposed`. The registry treats initiator attribution, scope visibility, installation ownership, Session ownership, and authorization as separate relations.

Native headless now requires `agents`. It creates one child-scope Agent from each Session identity, runs model and tool activity inside that Agent boundary, and unregisters it after the turn settles. Native tool contributions receive the same Agent with their Session and cancellation signal. Legacy filesystem tool adaptation remains limited to its supported Session view and does not create a legacy Agent registry or Session writer.

## Alternatives considered

**Use the Cordis AgentRegistry from native headless:** That would make the native profile construct a Cordis service tree and introduce a second runtime authority.

**Infer the initiator from an installation scope or Session object:** One application installation can execute concurrent turns, so either value can assign another turn's identity to background work.

**Keep Agent identity local to headless:** Tools, approval policies, jobs, and subagents need the same explicit identity without importing an application implementation.

## Consequences

Native profile rows install `@deepseek-ai/dsh-native-agent` before native headless. Its Host-only native entry does not import Cordis, and the package manifest omits a Cordis peer. The registry does not replace the legacy Agent loop, durable Session, tool authorization, workflow, or client projections; those capabilities continue their explicit migration paths.

## Verification

The native Agent tests cover scoped paired lifecycle events, collision refusal, creation-listener rollback, concurrent initiator isolation, clearing boundaries, initiator disposal drain, and Agent-owned cleanup before lifecycle publication. Native headless and compatibility compositions install the same Provider and pass the exact registered Agent to native tool contributions.
