---
description: "Browser UI renderer: React slot bindings, ctx.uiRenderer, and the assembled application root for the dsh web client."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-renderer

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-renderer` mounts the assembled dsh web client GUI after the complete client plugin roster settles. Its `./native` entry supplies a shared framework-independent slot runtime and React renderer to native Client plugins that register an application root. Business plugins stay plain React components that receive session and workspace data through typed props and never wire subscriptions themselves — the Cordis renderer binds the runtime's bare observable sources into selector hooks at the slot outlets. Existing product Client plugins remain Cordis compositions until each is migrated.

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

This package is infrastructure: the web shell and the boot kernel are its only direct consumers. A composition needs it whenever it wants a React-rendered GUI — `dsh-client-web` loads the roster, waits for every entry to activate, then calls `ctx.uiRenderer.mount(container)`.

### What mounting does

`mount(container)` installs the slot renderer, hydrates the existing boot DOM when present, renders the assembled application into the container before the next paint, and returns a disposer that unmounts the React root. The renderer performs the sole context-level `renderSlot('root')` call; the registered root occupant owns product layout and document metadata.

### For business plugins

A business plugin registers a component through the slot system; the renderer binds the runtime's session and workspace observable sources into selector hooks at the outlet. The plugin receives the standard session props (session id, conversation snapshot hooks) through its composed props — it never imports the renderer or touches React internals.

### For native Client profiles

Select `@deepseek-ai/dsh-client-ui-renderer/native` for a Cordis-free Client composition that uses React slots. Its plugin provides `clientSlots` and `clientRenderer`; selected native UI plugins register the `root` slot and provide `clientApplication`. The Web native boot package mounts that application, and the native host owns slot registrations, the renderer, and React unmount cleanup. A failed initial render releases its React root before the mounting error reaches the host, so a corrected composition can use the same container. The existing product Client roster still needs native providers before it can use this path.

The native entry's declarations expose the shared slot API, so the renderer requires `dsh-client-ui-slots` as a peer; applications provide that package and the React peers.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package realizes one boundary: the object layer (runtime, React-free) owns business state; this renderer is the only place ctx-to-React integration happens — slot renderer, `SessionProvider`, and the `useSyncExternalStore` adapter.

### Activation and mount

The plugin activates after `slots`, `sessions`, and `layout`; it installs `createSlotRenderer()` and reflects the `uiRenderer` service. `mountApp` looks for the boot kernel's `[data-dsh-boot]` element: when present it hydrates through `BootHandoff` (a one-frame pass-through that preserves the loading DOM), otherwise it creates a fresh root and flushes the render synchronously.

### Slot bindings

`createSlotRenderer` connects the slot registry to React: entry lists become reactive sources, and each outlet renders through the installed renderer. Business plugins pass bare observable sources through typed slot `hooks`; the renderer binds them at the outlet via the uSES adapter.

### Identity

React, React DOM, Cordis, ui-slots, and ui-primitives retain one browser identity through the web shell's static module table; this package arrives as a dynamic client bundle.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the surrounding machinery and the composition model.

- [ui-slots](../ui-slots/README.md) — the slot registry pure core this renderer binds to React.
- [web](../web/README.md) — the shell that loads the roster and calls `mount`.
- [ui-session](../ui-session/README.md) — the adapter that supplies the standard Session sources and hooks this renderer binds.
- [Web client architecture](../../../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — the loading chain, object layer, and layering red lines.
- [Slot system standard](../../../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md) — the definitive composition model.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side render assembly that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the application frame appears and how far per-region readiness goes; they are current package constraints.

- **The first application frame waits for every client entry** — the boot kernel hands over the mount point only after the loader roster settles; per-region readiness remains deferred.
- **Slot rendering has no Suspense integration or per-entry lazy loading** — the complete plugin roster settles before the renderer mounts the root.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
