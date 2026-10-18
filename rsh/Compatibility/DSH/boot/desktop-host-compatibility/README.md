---
description: "The private Desktop Host assembly for explicitly selected legacy Cordis profiles, including its Fetch routes and Native-profile rejection."
kind: "package-library"
---

# @deepseek-ai/dsh-desktop-host-compatibility

English | [中文](README.zh.md)

## Summary

This private package provides the compatibility Host assembled by Desktop for profiles that explicitly select Cordis. `createLegacyDesktopRuntime` boots the selected legacy plugin composition and returns Fetch handlers for its API, page assets, and stream route. Desktop owns profile selection and Native startup; this package rejects profiles containing `rsh.client.json`.

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

DesktopHost imports this private assembly only when the installed profile selects the legacy runtime. Native profiles use the Native Host and do not load this package.

### Entry point

The DesktopHost provides the installed runtime and project directories after selecting the compatibility assembly:

```ts
import { createLegacyDesktopRuntime } from '@deepseek-ai/dsh-desktop-host-compatibility'

const runtimeDir = '/path/to/installed/dsh'
const projectDir = '/path/to/desktop-project'
const runtime = await createLegacyDesktopRuntime(runtimeDir, projectDir, false)
```

The returned `fetch` handler serves the selected profile's API and page assets; `dispose` tears down its Cordis services. Startup rejects a project containing `rsh.client.json` so Native Client routes remain owned by the Native Host.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host composes the selected legacy profile with Desktop-owned route and stream handling. It uses the compatibility frontend's emitted page and the shared HTTP-routes injection renderer.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Private package entry point |
| [`src/legacy-host.ts`](src/legacy-host.ts) | Legacy profile boot, API and stream handlers, and teardown |
| [`src/web-assets.ts`](src/web-assets.ts) | Compatibility page and asset routes |
| [`src/runtime.ts`](src/runtime.ts) | Fetch and disposal interface returned to DesktopHost |
| [`config/desktop.cordis.patch.yml`](config/desktop.cordis.patch.yml) | Desktop-owned Cordis route composition |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Desktop](../../../../Programs/Desktop/README.md) — profile selection and runtime assembly.
- [DesktopHost entry](../../../../Programs/DesktopHost/src/index.ts) — the process owner that selects this package.
- [app-boot](../app-boot/README.md) — profile loading, patch composition, and boot lifecycle.
- [Compatibility frontend](../../web/frontend/README.md) — the page served by this Host.
- [HTTP routes](../../../../Core/util/http-routes/README.md) — the shared injection renderer.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the selected legacy plugin tree, which owns model-visible content; this Host adapter adds no model input.

#### KV Cache effect

This Host adds no request prefix. Cache behavior belongs to the selected profile and its model Provider.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Profiles containing `rsh.client.json` require the Native Host and are rejected by this compatibility runtime.
- No invariant companion is published because this assembly mounts the selected legacy tree through app-boot, whose owner already holds those relations; the Host itself only routes Fetch requests to that tree and owns no independently mutable state to compare.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
