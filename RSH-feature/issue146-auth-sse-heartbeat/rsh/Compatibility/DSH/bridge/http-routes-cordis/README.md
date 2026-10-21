---
description: "Provides the Cordis Context and event declarations for the selected HTTP WebServer Provider."
kind: "package-library"
---

# @deepseek-ai/dsh-http-routes-cordis

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-http-routes-cordis` carries the Cordis compatibility contract for `ctx.webServer` and `webserver/index-inject`. Cordis consumers import it where they read the WebServer service or its injection event. The bridge exposes legacy Web route names and WebServer configuration types over the framework-neutral route definitions in `@deepseek-ai/dsh-http-routes`; it neither listens nor dispatches requests.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### When to use it

Import this bridge in a Cordis program that consumes the WebServer service or contributes structured index inputs. Native listener code imports route contracts from the Core package directly and does not load this compatibility package.

### Entry point

```text
import type {} from '@deepseek-ai/dsh-http-routes-cordis'
import type { Context } from '@deepseek-ai/cordis'

declare const ctx: Context
const removeRoute = ctx.webServer.register(route)
await removeRoute()
```

The returned route disposer stops new admission and resolves after handlers already admitted to that registration settle.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Cordis Context service and event augmentation, plus legacy WebServer types |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [HTTP routes subsystem](../../../../Docs/subsystems/http-routes.md) — generic route and listener contracts.
- [WebServer package](../../../../Programs/Web/host/webserver/README.md) — the selected Cordis HTTP listener.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `cordis_inspect_query` Service catalog: it exposes `ctx.webServer.register(HttpRoute)`, `registerUpgrade(HttpUpgradeRoute)`, and `webserver/index-inject` as model-facing Cordis coding guidance.

#### KV Cache effect

The route contract enters context only when queried; a later query appends at the then-current tail without rewriting the unchanged prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

No invariant companion is published because this package only augments Cordis TypeScript declarations; it owns no runtime installer or invariant registration.

- This package describes Cordis consumers only; it does not provide a listener or a Native route capability.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
