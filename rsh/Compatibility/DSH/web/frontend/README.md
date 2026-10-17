---
description: "Run a legacy Cordis browser shell that uses the existing Client module table. Desktop Hosts can serve its built page while Native Web stays Cordis-free."
kind: "package-library"
---

# @deepseek-ai/dsh-web-compatibility

English | [中文](README.zh.md)

## Summary

Desktop Hosts can keep serving the Cordis browser shell and its existing Client module table through this package. It exports `AppWebEntry` and builds the legacy page and repository worker preview from shared application source. Use the Native Web package for the default Cordis-free browser distribution.

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

DesktopHost consumes this package when a product must serve the compatibility page and keep `/plugins/*` on its existing Cordis module route.

### When to use it

Use the compatibility page for an existing Host that selects Cordis plugins through the Client module table. Use `@deepseek-ai/dsh-web-frontend` when the Host supplies Native module selection and wants a Cordis-free page.

### Entry point

The smallest import creates the browser entry; the Host provides its mount point and loader globals before calling `run()`.

```ts ignore-check
// Client-only entry: the Host aggregate cannot compile this package's Client declarations.
import { AppWebEntry } from '@deepseek-ai/dsh-web-compatibility'

const entry = new AppWebEntry(document.getElementById('root')!)
void entry.run()
```

`run()` resolves after the application mounts or the boot page reports a failure. A Host that embeds this entry in a separate page must import `@deepseek-ai/dsh-client-web/base.css` from its browser entry.

Run `pnpm --filter @deepseek-ai/dsh-web-compatibility run build` to build `dist/index.html`. Run `pnpm --filter @deepseek-ai/dsh-web-compatibility run build:preview` to build the worker preview. `pnpm run build:web` builds the Native and compatibility distributions in sequence.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The page uses shared application source, while this package owns the Cordis boot entry and static module table. DesktopHost selects the served page and handles the compatibility module route. The worker preview uses a separate Vite entry and VFS image.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Compatibility shell exports |
| [`src/boot.ts`](src/boot.ts) | `AppWebEntry` startup and loader handoff |
| [`src/platform.ts`](src/platform.ts) | Cordis and static Client module table |
| [`vite.config.ts`](vite.config.ts) | Compatibility page and worker-preview outputs |
| [`../../../../Programs/Web/application/legacy.html`](../../../../Programs/Web/application/legacy.html) | Legacy browser entry over shared application source |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read the Desktop and Native package pages to choose the browser owner for an application.

- [Desktop application](../../../../Programs/Desktop/README.md) — owns the desktop runtime and Host integration.
- [Native Web package](../../../../Programs/Web/client/web/README.md) — Cordis-free browser boot API.
- [Client group map](../../../../Programs/Web/client/README.md) — maps the shared browser packages.

-----

<a id="model-experience"></a>
## Model Experience

None, as the compatibility browser shell renders product UI but contributes no model request content.

#### KV Cache effect

None; this package does not assemble provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The worker preview omits persistent task scheduling because its browser filesystem has no SQLite backend.

- **Task scheduling is disabled in the worker preview** — the private worker platform does not provide SQLite persistence.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published because this library has no independently mutable registry or durable state.
