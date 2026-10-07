---
description: "Selected DSH profiles can connect legacy Cordis Settings to four Engine services while keeping Cordis-specific registration outside Engine packages."
kind: "package-reference"
---

# @deepseek-ai/dsh-compat-settings-adapters

English | [中文](README.zh.md)

## Summary

This package connects legacy Cordis Settings to AgentLoop, default-model selection, agent presets, and subagent model selection. Select only the entry that matches a mounted Engine service. Each entry registers through that service's original Cordis context, and a missing Settings provider leaves the composition-provided value in use.

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

Select the adapter subpath beside its matching Engine service in a Cordis profile composition.

### When to choose it

Choose an entry when a Cordis profile uses the legacy Settings provider and the corresponding Engine service. Native services read the shared Settings definitions directly and do not load this package.

### Minimal configuration

The package has no entry configuration fields. A profile selects an adapter as a plugin row; for example, the default-model entry is:

```yaml
- id: agent-default-model-settings
  name: '@deepseek-ai/dsh-compat-settings-adapters/agent-default-model'
```

The other entries are `./agent-loop`, `./agent-presets`, and `./tool-subagent`; each requires its matching Engine service in the same composition.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Owner connections — click to expand</summary>

Each selected adapter first loads its matching Engine modules, then waits for the Engine service and registers its Settings section or namespace on that service's original Cordis context. A missing selected Engine peer fails activation before service injection. The Engine-owned callback remains responsible for validation and for restoring the composition value when the Settings service is absent or unloaded.

| File | Responsibility |
|---|---|
| [`src/agent-loop.ts`](src/agent-loop.ts) | AgentLoop Settings adapter |
| [`src/agent-default-model.ts`](src/agent-default-model.ts) | Default-model Settings adapter |
| [`src/agent-presets.ts`](src/agent-presets.ts) | Preset-selection Settings adapter |
| [`src/tool-subagent.ts`](src/tool-subagent.ts) | Subagent model-selection Settings adapter |
| [`src/settings-entry.ts`](src/settings-entry.ts) | Validated source callbacks shared by Settings adapters |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Cordis Settings declarations](../compat-settings-definition/README.md) — legacy `Context.settings` types and events.
- [Core Settings definitions](../../../../Core/settings/settings-definition/README.md) — framework-neutral service and value types.
- [Settings subsystem](../../../../Docs/subsystems/settings.md) — shared Settings behavior and ownership.
- [DSH compatibility bridges](../README.md) — selected compatibility package composition.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the model and preset selections consumed by the Engine services.

#### KV Cache effect

No request content is added or reordered.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- These adapters require a matching Engine service in the same Cordis composition; they do not provide one.
- The package adapts Settings registration only; the selected Settings provider owns storage and persistence.

<a id="dev-note"></a>
### Dev Note

None.
