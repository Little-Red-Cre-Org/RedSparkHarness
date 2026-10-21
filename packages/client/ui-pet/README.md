---
description: "Extensible desktop-pet registry, Agent-state presentation, and General personalization controls for RedSpark clients."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-pet

English | [中文](README.zh.md)

## Summary

This plugin turns the RedSpark mascot into an optional Agent-state display. It owns the durable desktop-pet preference, registers the built-in Kitsune character with normal and chibi variants, occupies `conversation.pet` in the welcome hero and active Conversation, and adds General > Personalization > Desktop pet controls. `ui-conversation` only declares and places the slot, so it does not know any character, asset, setting, or state rule.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Add both Host and Client halves to a Web composition. Users can enable the pet and select its character and variant in General settings. The same stored `petId` and `variant` drive the centered welcome character and the in-app floating Conversation character, so changing either selection updates both placements.

Third-party Client plugins can call `ctx.pet.register()` with a stable id, a display name, and one or more four-frame horizontal sprite atlases. An Electron-compatible atlas is either a bounded PNG data URL or an application-served absolute PNG path such as `/plugins/provider/atlas.png`; it cannot be a remote URL, query-bearing URL, or path containing traversal. Independent capability plugins can call `ctx.pet.setActivity(sessionId, source, activity)` and retain the returned disposer while a more specific state such as `coding`, `working`, or `sleeping` applies.

<a id="understand-the-implementation"></a>
## Understand the implementation

`PetRuntime` owns registry entries, preferences, and temporary activity reports. Session-standard state supplies the default mapping: idle, running/thinking, pending interaction/waiting, error, and a short completion reaction. The browser presentation reads one immutable snapshot for both placements. A loopback browser persists preferences through the shared Host settings scope; a remote browser uses an explicitly process-local copy so its controls remain responsive without claiming durable storage. An optional Electron carrier receives only a validated atlas frame and localized status, then owns the transparent draggable always-on-top window. The Host half registers the `ui-pet` settings schema; accepted changes use the shared settings scope.

<a id="further-exploration"></a>
## Further Exploration

- [ui-conversation](../ui-conversation/README.md) — declares and places the generic `conversation.pet` slot.
- [Slots](../../../docs/subsystems/slots.md) — Client composition and lifecycle rules.
- [Web client](../../../docs/subsystems/web-client.md) — browser package loading and standard Session props.

<a id="model-experience"></a>
## Model Experience

None, as pet state is browser presentation and never enters a model request or Session log.

#### KV Cache effect

None; the package does not assemble provider input.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Desktop carrier is optional** — browsers show the welcome and Conversation placements only. Electron shows the selected frame in a separate transparent draggable always-on-top window when the user enables Desktop display.
- **Built-in assets are deployment-owned** — the Web app serves the two RedSpark atlases under `/brand/`; a distributable third-party provider serves a PNG under an application-local absolute path such as `/plugins/provider/atlas.png`, or supplies a bounded PNG data URL.
- **Four-frame presentation** — semantic states share the available idle, blink, wave, and happy frames until a future animation format provides dedicated state clips.

<a id="dev-note"></a>
### Dev Note

**Runtime invariant:** No invariant companion is published because the registry, durable settings scope, and component tests directly cover the owned relationships. The selected definition resolves to a registered pet and variant at render time, with first-registered fallbacks if durable ids are unavailable. Registration and activity reports are removed only by their owning disposers.
