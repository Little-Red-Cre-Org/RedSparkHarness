---
description: "Cordis-free Native browser boot API and framework-free progress page for Hosts composing selected Client plugins."
kind: "package-library"
---

# @deepseek-ai/dsh-client-web

English | [中文](README.zh.md)

## Summary

`dsh-client-web` provides the Cordis-free browser API for importing selected Native Client rows, installing them in a `NativeHost`, and mounting the required renderer. Its framework-free boot page reports progress and failures before the renderer mounts. The package root and `./native` export the same Native API; `./native-wire` exposes only the Host-injected wire declarations. The package contains no Cordis loader or compatibility module table. The model never sees this package.

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

Use `bootNativeClient` when a Host has selected Client rows and supplied their browser module graph. The call imports each selected module, validates its Native plugin export, resolves the composition, and mounts the required `clientRenderer`. The returned host owns the composition lifetime: call and await `stop()` on navigation or shutdown, or call `replace()` with the full successor selection and module graph during reload.

The optional `AbortSignal` prevents activation after a pending import settles and stops an active composition when aborted. `./boot-page` exposes the shared framework-free loading page; `./base.css` exposes the browser base styles. `@deepseek-ai/dsh-web-compatibility` owns `AppWebEntry`, Cordis Loader startup, and the shared module table. The default Web `index.html` uses the Native API, while the compatibility package builds its legacy page and worker preview separately.

The shell base styles apply automatic CJK/Latin spacing to ordinary content in supporting browsers. Semantic code and terminal, diff, read, and search output containers retain literal source spacing and column alignment; browsers without `text-autospace` support ignore both declarations.

### What boot looks like

The Host provides a module manifest, an import operation, and selected installation rows. `bootNativeClient` imports the selected rows, validates their Native plugin exports, resolves the complete installation, and starts one `NativeHost` with a renderer mount plugin. `replace()` imports and resolves a successor before replacing the live installation; a failed import or resolution leaves the current UI mounted.

### The boot page

The boot page uses plain DOM and local CSS, so bundle and plugin-activation failures remain visible: it shows one spinner node whose CSS arc grows as entries activate, and reports per-entry status. The spinner and its animation phase persist until the full UI replaces the boot page. A failed renderer handoff restores the boot page to the mount point before reporting the error. A plugin that fails import or activation is reported by name with the reason (missing service, import error, or state) instead of a blank page.

### The shared module table

The Cordis module table belongs to [`dsh-web-compatibility`](../../../../Compatibility/DSH/web/frontend/README.md), not this Native package. Native browser bundles use Host-authored module manifests and explicit Native plugin exports.

### Configuration

The package accepts no plugin config of its own; the generated [configuration catalog](../../../../Docs/config-catalog.md) lists every plugin config in the repo for comparison.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the boot kernel is built; observable behavior is covered in [Use this package](#use-this-package).

### Design concept

The package owns the Native browser composition API and its progress page. The Host owns module graph construction, selection, and asset delivery; `bootNativeClient` imports only selected rows and gives the renderer the mount point after installation succeeds.

### Two-stage boot

`bootNativeClient()` imports each selected module through the Host-supplied graph, validates its `plugin` export, resolves the complete Native installation, and starts a mount plugin that requires `clientApplication` and `clientRenderer`. The returned host serializes replacements and owns unmount and provider cleanup. The compatibility Loader and its boot protocol live in the separate compatibility package.

### Boot page mechanics

The boot page is plain DOM with local CSS whose fallback fonts and colors match the theme tokens that arrive during loading. `internal/status` events drive one spinner node and per-entry labels; hydration preserves the node and animation phase through the application commit, and `fail()` renders the thrown reason. React mounting, slot rendering, and assembly live in `ui-renderer`; `ui-layout` owns the assembled browser-title projection.

### Source map

| File | Role |
|---|---|
| [`src/native-boot.ts`](src/native-boot.ts) | Native Client row installation, progress reports, and renderer mount with owned cleanup |
| [`src/index.ts`](src/index.ts) | Package root re-exports the Native browser API |
| [`src/boot-page.ts`](src/boot-page.ts) | Shared Cordis-free progress page used by Native and compatibility shells |
| [`src/native-wire.ts`](src/native-wire.ts) | DOM-free declarations for the Host-injected browser payload, also re-exported from `./native` |
| [`src/base.css`](src/base.css) | Browser base styles, emitted as `lib/base.css` and exported as `./base.css` |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the Native composition contract is not enough: the Native runtime, renderer, and explicitly separate compatibility shell.

- [Native runtime](../../../../Core/native/system/README.md) — Native plugin resolution and lifecycle.
- [UI renderer](../ui-renderer/README.md) — receives the mount point and binds slot data to React.
- [Compatibility browser owner](../../../../Compatibility/DSH/web/frontend/README.md) — legacy Cordis startup and worker preview.
- [Client group map](../README.md) — the browser half this package belongs to.

-----

<a id="model-experience"></a>
## Model Experience

None, as the boot kernel is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the boot kernel does not support. They are current package constraints, not a task backlog.

- **The application waits for the full roster** — one failed entry keeps the framework-free boot page visible with a per-entry report; partial UI availability is not supported.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** The Native API package has no Cordis dependency or Loader entry. The Host-provided graph and selected Native plugin rows determine the composition; `NativeHost` owns installation and renderer cleanup. No runtime invariant companion is published because this API exposes no independently mutable package-owned registry state.
