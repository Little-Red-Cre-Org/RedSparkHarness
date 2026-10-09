---
description: "Share portable code-run requests and provider operations between code-runtime implementations and consumers."
kind: "package-library"
---

# @deepseek-ai/dsh-code-runtime-definition

English | [中文](README.zh.md)

## Summary

This package lets code-runtime Providers implement one request and result contract, while Engine Consumers use that contract without importing a concrete backend. The root entry exports portable bindings, outcomes, and runtime interfaces. It contains no worker, process launcher, Cordis Service, or model-facing tool.

## Table of Contents

- [Use this package](#use-this-package)
- [Implementation](#implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>

## Use this package

### When to use it

`dsh-tools` and native applications consume `CodeRuntimeDefinition`. `native-code-runtime` implements the native Host contract, while `compat-code-runtime` adapts the same operations to a Cordis Service. Consumers select a Provider separately and pass the request through its `run()` operation.

### Entry point

Import the portable types when implementing a backend or declaring a Consumer dependency:

```ts
import type { CodeRunRequest, CodeRuntimeDefinition, NativeCodeRunRequest } from '@deepseek-ai/dsh-code-runtime-definition'
```

## Implementation

The package owns portable binding, JSON value, request, result, failure, and language-independent reserved-name declarations. `CodeRuntimeDefinition` accepts the shared `CodeRunRequest`; native Providers also accept `NativeCodeRunRequest`, which carries the exact live Native Session as host-side policy context and adds the stop callback used to cancel caller-owned bindings. Providers do not serialize that Session to workers. `NativeCodeRuntime` adds awaited Provider disposal. Backend configuration, isolation, cancellation, and process or worker resources remain with the selected implementation.

The package publishes no `./invariant` companion because its values and interfaces hold no runtime registry or state. Providers and Consumers share the same declarations through the root entry.

## Further Exploration

- [Code runtime subsystem](../../../Docs/subsystems/code-runtime.md)
- [Native worker-thread Provider](../../../Modules/Official/code-runtime/native-code-runtime/README.md)
- [Cordis code-runtime bridge](../../../Compatibility/DSH/bridge/compat-code-runtime/README.md)
- [Native code-runtime decision](../../../../.agents/notes/implemented/architecture/2026-09-23-native-code-runtime.md)

No runtime invariant companion is published because this package contains only portable execution contracts; each selected Provider owns backend state and validates its own execution lifecycle.

## Model Experience

None, as this package declares execution operations but constructs no model request or Session event.

#### KV Cache effect

The package does not add or reorder model request content.

## Known Limitations and Deferred Work

- The package does not execute programs or validate backend configuration; a selected Provider owns those operations.

<a id="dev-note"></a>

### Dev Note

The Cordis Service and native Host Provider remain separate implementations of the same portable execution contract.
