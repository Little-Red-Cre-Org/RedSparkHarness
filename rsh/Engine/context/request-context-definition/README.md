---
description: "Share Native request-context types while leaving request acceptance and Session writes with the consuming Program."
kind: "package-library"
---

# @deepseek-ai/dsh-request-context-definition

English | [中文](README.zh.md)

## Summary

This package declares the Native request-context service and the request, provider, visibility, and prepared-result types shared by applications and Providers. A Provider prepares detached messages and candidate state; the consuming Program owns admission, the durable Session append and flush, and the point when prepared state commits.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>

## Use this package

### When to use it

Use the Definition when a Native request-context Provider and its consuming Program share `requestContexts`. The request supplies the exact active Session owner, final admitted inputs, one durable event snapshot, and tool registrations captured by the model or PTC execution route.

### Entry point

Import `NativeRequestContextProvider`, `NativeRequestContextRequest`, `PreparedNativeRequestContext`, and `NativeRequestContexts` from the package root. A Provider returns detached messages and a `commit()` action; it does not append to the Session. The Program checks final admission synchronously, appends through its existing writer, and flushes before the Provider state commits.

```ts
import type {
  NativeRequestContextProvider,
  NativeRequestContextRequest,
  NativeRequestContexts,
  PreparedNativeRequestContext,
} from '@deepseek-ai/dsh-request-context-definition'
```

The request, provider, visibility, prepared-result, and service declarations are documented verbatim on the [request-context subsystem page](../../../Docs/subsystems/request-context.md).

<a id="understand-the-implementation"></a>

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package augments `NativeServices` with `requestContexts` and exports a branded provider id. It contains no registry runtime, Cordis dependency, or installable Provider entry.

</details>

<a id="further-exploration"></a>

## Further Exploration

- [request-context subsystem](../../../Docs/subsystems/request-context.md)
- [Native request-context Provider](../request-context/README.md)
- [Native Headless](../../core/native-headless/README.md)
- [Architecture](../../../Docs/architecture.md#turn-flow)

## Known Limitations and Deferred Work

- This package declares types only; a Native Provider and a consuming application must supply the service and request lifecycle.
- It does not define a Session event type or grant Providers Session write authority.
- No invariant companion is published because the package has no runtime state to observe.

<a id="dev-note"></a>

### Dev Note

None.
