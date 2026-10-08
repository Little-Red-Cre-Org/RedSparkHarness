---
description: "Defines the Node HTTP route contracts and one drainable route table shared by selected Web listeners."
kind: "package-library"
---

# @deepseek-ai/dsh-http-routes

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-http-routes` gives selected Node HTTP listeners one route contract and one drainable in-memory table. Cordis Web and Native Web listener Providers use it; feature owners register routes and retain their disposer. HTTP matching checks exact paths before the longest matching prefix, while upgrades use a separate exact-path table. The Host and Native entries contain only Node route types; browser index inputs are exposed by the Client entry.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### When to use it

Use this library when a Node HTTP listener needs shared route registration and teardown behavior. The Cordis WebServer and Native Web carrier consume the Host protocol; the browser page assemblers import index-injection values from `./client`.

### Entry point

```text
import { HttpRouteTable } from '@deepseek-ai/dsh-http-routes/native'

const routes = new HttpRouteTable()
const dispose = routes.register({ kind: 'exact', path: '/health', handler })
await dispose() // removes future admission and drains this route's handlers
await routes.close() // removes all routes and drains admitted handlers
```

Duplicate `(kind, path)` registrations throw. HTTP and upgrade routes are stored separately, so one HTTP route and one upgrade route may claim the same pathname.

Removing a route or closing the table disconnects admitted requests whose HTTP bodies are incomplete, then drains their handlers. Requests with complete bodies continue through their normal handler lifecycle.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [`src/host.ts`](src/host.ts) | Node HTTP route, upgrade, and listener contracts |
| [`src/route-table.ts`](src/route-table.ts) | Exact-first route selection and admitted-handler draining |
| [`src/native.ts`](src/native.ts) | Cordis-free Native entry for the shared table and listener types |
| [`src/client.ts`](src/client.ts) | Browser-safe index-injection data and rendering |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [HTTP routes subsystem](../../../Docs/subsystems/http-routes.md) — route matching, listener ownership, and disposal semantics.
- [Cordis HTTP compatibility library](../../../Compatibility/DSH/bridge/http-routes-cordis/README.md) — the legacy `ctx.webServer` contract.
- [WebServer package](../../../Programs/Web/host/webserver/README.md) — the Cordis listener Provider and transport behavior.

-----

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

No invariant companion is published because this package exposes route contracts and a drainable table but owns no cross-package invariant registration.

- The table is in-memory and belongs to one listener lifetime; it does not persist routes or impose authentication policy.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
