# Agent Note: Native SDK Session execution

Status: implemented

English | [中文](2026-10-05-native-sdk-session-execution.zh.md)

## Problem

The shipped `native-sdk` profile names an application package that has no installer, leaving the existing SDK wire protocol without a native Session owner.

## Decision

The native SDK server is one profile-selected application. `initialize` binds the workspace and model route, and `session/prompt` queues text on the shared native-headless executor by Session id. The executor owns model requests, durable events, and writer settlement; the SDK application owns JSON-RPC stdio, per-Session prompt ordering, status notifications, and process shutdown. The TypeScript and Python client defaults remain `sdk`, so this native path is explicitly selected.

The native server keeps the existing three request methods and emits `session.event` and `session.status`. A prompt response follows its durable `agent/inbox/spliced` receipt; failures before that receipt reject the JSON-RPC request. Persistent storage determines whether a Session resumes, including after a process restart. Inline image admission and subagent notifications stay outside this first native SDK slice. Unsupported input fails at the wire request rather than being silently altered.

## Alternatives considered

**A second SDK-specific Agent loop.** It would duplicate Session persistence and model admission and could diverge from other native Programs; the existing executor already owns those operations.

**Switching both SDK defaults immediately.** This would expose incomplete image and subagent support to existing callers, so native selection remains explicit until parity is established.

## Consequences

The SDK can drive and observe native Session turns through the public `dsh` launcher with no Cordis boot. Status is whole-session activity, not a result attributed to one queued prompt. A later parity slice may add image admission and subagent events without changing this wire transport.
