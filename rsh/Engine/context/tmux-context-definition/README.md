---
description: "Share the Native tmux-context service types between an application and its Provider while leaving Session writes with the application."
kind: "package-library"
---

# @deepseek-ai/dsh-tmux-context-definition

English | [中文](README.zh.md)

## Summary

Native applications and Providers use this package to agree on the `tmuxContext` request and service types. The Provider prepares an optional message from committed Session events, while the application keeps its existing Session writer and appends that message before model dispatch.

## Table of Contents

- [Use this package](#use-this-package)
- [Implementation](#implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>

## Use this package

### When to use it

Use the Definition from a Native application or Provider that shares the `tmuxContext` service. The application owns durable Session appends; this package declares only the request and service types.

### Entry point

Import the request and service types from the package root. The service receives the exact Session, active turn and step, and cancellation signal; `seed()` and `record()` follow the owning application's loaded and committed event sequence.

```ts
import type { NativeTmuxContext, NativeTmuxContextRequest } from '@deepseek-ai/dsh-tmux-context-definition'
```

The package exports [`NativeTmuxContextRequest` and `NativeTmuxContext`](../../../Docs/subsystems/tmux-context.md), where the source declarations and JSDoc are documented verbatim.

<a id="implementation"></a>

## Implementation

The entry declares the Native service and augments `NativeServices`; it does not import Cordis or activate a Provider. The Official Provider and Native Headless import the same types, and Headless remains the only writer of the model-visible Session message.

<a id="further-exploration"></a>

## Further Exploration

- [tmux-context subsystem](../../../Docs/subsystems/tmux-context.md)
- [Native tmux-context Provider](../../../Modules/Official/terminal/native-tmux-context/README.md)
- [Native Headless](../../core/native-headless/README.md)

## Known Limitations and Deferred Work

- The package declares types only; callers must install a Provider and an application that consumes the service.
- No runtime invariant companion is published because this package declares service types only and has no independent runtime state to observe.

<a id="dev-note"></a>

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
