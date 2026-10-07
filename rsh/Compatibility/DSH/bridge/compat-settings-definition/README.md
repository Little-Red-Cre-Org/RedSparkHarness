---
description: "Cordis declarations for the legacy Settings API, including Context.settings and registration options."
kind: "package-reference"
---

# @deepseek-ai/dsh-compat-settings-definition

English | [中文](README.zh.md)

## Summary

Use this package when a Cordis plugin consumes the legacy `Context.settings` API. Its root export adds the Settings service and registration options to Cordis declarations; `/events` adds Settings event types. It contains no Settings provider or storage, and Native consumers use the framework-neutral Settings definitions.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Cordis plugin type declarations import the root export to make `Context.settings` available:

```ts
import type {} from '@deepseek-ai/dsh-compat-settings-definition'
```

The `/events` export declares the compatibility Settings events. These imports only augment TypeScript declarations; the selected Settings provider creates the runtime service.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Cordis declarations — click to expand</summary>

The root export extends Cordis `Context` with `CordisSettingsService`, which builds on the framework-neutral `SettingsService`. The `/events` export declares the compatibility event payloads using the shared namespace and update-source types.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Cordis Context augmentation and registration options |
| [`src/events.ts`](src/events.ts) | Cordis Settings event declarations |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Settings subsystem](../../../../Docs/subsystems/settings.md) — shared, Cordis, and Native Settings declarations.
- [Core Settings definitions](../../../../Core/settings/settings-definition/README.md) — framework-neutral and Native interfaces.
- [Official Settings group](../../../../Modules/Official/settings/README.md) — concrete Settings providers.

-----

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Cordis only** — this package describes `Context.settings`; Native consumers use `dsh-settings-definition` instead.
- **No runtime provider** — declarations do not mount or store a Settings service.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
