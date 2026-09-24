---
description: "Native Agent registration, scoped lifecycle events, and asynchronous initiator attribution."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-agent

English | [中文](README.zh.md)

## Summary

`dsh-native-agent` provides the `agents` capability to a native Host profile. It registers live Agent identities in child native scopes, preserves each explicit initiator across asynchronous work, and waits for admitted initiator work before registry disposal. An Agent release makes the identity unavailable, drains its registered cleanup work, then publishes its paired disposal event. It neither owns Sessions nor implements the Agent loop.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The `./native` entry accepts only an empty configuration object and provides `agents`. `NativeAgentId()` rejects an empty identity. `register()` rejects a duplicate live identity, emits `agent/created` in the Agent scope, and returns an idempotent disposer that emits `agent/disposed` for that exact entry. `onDispose()` accepts cleanup only for an exact available Agent; release first stops further lookup and cleanup registration, then drains its registered callbacks before it emits `agent/disposed`. A creation-listener failure removes the entry and emits its paired disposal event before the failure reaches the caller.

`withInitiator()` and `withoutInitiator()` preserve their exact synchronous value or returned native Promise. They do not infer identity from an installation or registration owner. `dispose()` rejects new initiator boundaries, waits for returned Promise boundaries, then invalidates initiator reads and releases any remaining registrations. Explicit deregistration emits while the Host event bus accepts delivery; Host shutdown closes that bus before provider cleanup, so its remaining entries release without dispatch. An operation that begins disposal must not wait for that same disposal from inside its own boundary.

## Model Experience

None, as Agent identity and initiator attribution add no model request content.

#### KV Cache effect

Agent identity and initiator attribution add no model request content.

## Known Limitations and Deferred Work

- The registry does not create Sessions, execute model turns, authorize tools, or schedule subagents.
- Lifecycle events remain Host-local and do not provide an RPC or browser projection.

No invariant companion is published because the registry's in-memory lifecycle has no independent durable observation.

<a id="dev-note"></a>
### Dev Note

None.
