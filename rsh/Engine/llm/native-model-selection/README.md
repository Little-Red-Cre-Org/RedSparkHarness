---
description: "Persist a Session model choice and use the exact selected Provider for subsequent requests."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-model-selection

English | [中文](README.zh.md)

## Summary

Save a model choice for one Session and reconstruct it after cold restore. Concurrent choices compare the latest durable intent revision; a stale choice fails without replacing the accepted choice. The selected Program records model-change notices and request controls before dispatch.

## Table of Contents

- [Configuration](#configuration)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>

## Configuration

The native entry requires `activeSessions`, `agents` and `modelDirectory`, and provides `modelSelection`. It accepts no configuration. Consumers supply explicit request defaults and an exact active root owner; delegated invocations retain their Program-owned configuration.

<a id="understand-the-implementation"></a>

## Understand the implementation

Exact Provider resolution validates the proposed choice. The sole Program writer compares the observed intent revision, appends `model/selection`, and flushes before acknowledging it. Resolution can run concurrently; each owner serializes comparison and persistence. Caller, Agent and Provider cancellation fence admission, and removal drains accepted operations. The browser-safe `./types` projection includes inherited fork history and opens no storage.

Selection capture separates requested controls from advisory defaults. The [model executor](../../core/native-model-execution/README.md) captures actual metadata and dispatch together; the [Headless Consumer](../../core/native-headless/README.md) logs those prepared controls before requesting a response. Effective defaults in an older header do not become a human selection. The service owns neither another writer nor a global default. [Decision](../../../../.agents/notes/implemented/architecture/2026-10-05-native-model-selection-and-prepared-dispatch.md).

<a id="model-experience"></a>

## Model Experience

### Session model intent

#### What the model sees

Selection facts stay outside model history. A provider or model change adds a persisted notice naming the old and new routes; an effort-only change records the changed request header without a route notice.

#### Token effect

Catalog reads consume no model tokens. A route notice adds one short message to subsequent requests.

#### KV Cache effect

Switching models can change cache availability. This package promises no cache preservation across models.

#### Understand the implementation

The [durable projection](../../core/native-model-execution/src/model-selection.ts) and [selection admission](src/service.ts) use the complete Session history; Headless records controls and route notices from prepared dispatch.

<a id="known-limitations-and-deferred-work"></a>

## Known Limitations and Deferred Work

- Catalogs are advisory; exact resolution determines availability. SDK, ACP and Web selection surfaces are separate Consumers. This package supplies no interactive login, settings editor or global default.

<a id="dev-note"></a>

### Dev Note

No invariant companion is published: selection records use the exact Program writer, with no independent durable observation. Host and Client compiler faces remain separate.
