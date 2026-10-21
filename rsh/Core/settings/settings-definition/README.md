---
description: "Shared Settings interfaces for providers, APIs, and consumers, including a Cordis-free Native service definition."
kind: "package-reference"
---

# @deepseek-ai/dsh-settings-definition

English | [中文](README.zh.md)

## Summary

Use this package to share Settings service, namespace, descriptor, and edit types between providers and consumers. The `/types` export holds wire-safe views; `/native` defines the Native service and augments `NativeServices` without importing Cordis. The package defines interfaces only; providers own storage and resolved values.

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

Providers and configuration APIs use the root export for framework-neutral Settings declarations. Browser consumers use `/types`; Native providers and consumers use `/native`.

```ts
import type { SettingsService } from '@deepseek-ai/dsh-settings-definition'
import type { NativeSettingsService } from '@deepseek-ai/dsh-settings-definition/native'
```

These imports resolve type contracts at compile time. They do not create a Settings service or load a provider. Cordis plugins use [`compat-settings-definition`](../../../Compatibility/DSH/bridge/compat-settings-definition/README.md) for `Context.settings` declarations.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Declaration ownership — click to expand</summary>

The root export defines the provider-neutral Settings service and registration scope. `/types` defines the namespace identity and JSON-safe values used by configuration surfaces. `/native` defines Native storage, service, descriptor, edit, and scope types, and adds `NativeServices.settings` through module augmentation.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Shared Settings provider and consumer types |
| [`src/types.ts`](src/types.ts) | Namespace identity and Client-safe value declarations |
| [`src/native.ts`](src/native.ts) | Native Settings interfaces and Native service augmentation |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Settings subsystem](../../../Docs/subsystems/settings.md) — service types, Cordis API, Native API, and events.
- [Official Settings group](../../../Modules/Official/settings/README.md) — concrete Settings implementations.
- [Cordis compatibility declarations](../../../Compatibility/DSH/bridge/compat-settings-definition/README.md) — `Context.settings` and registration options.
- [Settings declaration ownership note](../../../../.agents/notes/implemented/architecture/2026-10-07-settings-definition-ownership.md) — why Core and Compatibility declarations have separate owners.

-----

<a id="model-experience"></a>
## Model Experience

### Provider-owned Settings values

#### What the model sees

`SettingsNamespaceView` and `NativeSettingsDescriptor` describe configuration surfaces; these declarations add no content to a model request. A Settings value affects a request only when its provider or consuming plugin explicitly reads it and applies it; that consumer owns the model-visible contract.

#### Token effect

None from these declarations. A consumer determines whether a configured value changes request content or token use.

#### KV Cache effect

None from this package. A consumer that changes prompt content determines whether that change affects its provider's cache key.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No provider implementation** — importing these declarations does not load storage or make settings available at runtime.
- No invariant companion is published because this package exports service contracts only; Settings providers own persistence and runtime behavior.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
