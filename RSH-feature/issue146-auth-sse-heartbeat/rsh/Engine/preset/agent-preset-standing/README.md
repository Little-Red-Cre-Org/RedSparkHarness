---
description: "Register one standing Agent composition in a native profile scope so users can select its tools and prompt contributions before a Session starts."
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-preset-standing

English | [中文](README.zh.md)

## Summary

Native profiles can expose a named Agent composition for users to select when they start a Session. Each installation registers its own scope, so its tools and prompt contributions stay distinct from sibling presets. The Program and `agent-presets` Registry own Session choice and Agent replacement.

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

Install one contribution in each native profile scope whose composition should appear in the selected `agent-presets` Registry.

### When to choose it

Choose this package when a native profile needs separately selectable, profile-owned scopes; the compatibility `agent-presets` entry continues to load preset directories and Cordis compositions.

### Minimal configuration

Add a native installation row to the profile composition and provide its exact scope identity and display text:

```json
{
  "id": "preset-minimal",
  "plugin": "@deepseek-ai/dsh-agent-preset-standing",
  "scope": "minimal",
  "config": {
    "id": "minimal",
    "name": "Minimal",
    "description": "Task tracking tools without Goal tools."
  }
}
```

| Field | Default | Meaning |
|---|---|---|
| `id` | required | Registry identifier; must match `[a-z0-9][a-z0-9-]*` |
| `name` | required | Non-empty name shown in the preset picker |
| `description` | omitted | Optional non-empty description shown with the name |

The accepted fields come from the schema in [`src/native.ts`](src/native.ts).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Provider contributes one `NativePresetComposition` under the scope assigned by the profile row. The shared Registry discovers the contribution, while the selected Program owns durable Session choice, scope parenting and Agent lifecycle.

| File | Role |
|---|---|
| [`src/native.ts`](src/native.ts) | Validate display configuration and register the installation scope |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Preset group](../README.md) — locate the package and its shared composition Registry.
- [`agent-presets`](../agent-presets/README.md) — select and restore a standing composition for a Session.
- [Scope subsystem](../../../Docs/subsystems/scope.md) — understand scope parenting and contribution visibility.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the plugins installed in this scope; their visible tools and prompt contributions are selected before the Agent's first model request.

#### KV Cache effect

The package adds no prompt content itself; the consuming profile's scoped Providers own model-visible changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Selection applies only to the native profile that installs this Provider; it does not load compatibility preset directories.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published because the shared Registry owns registration state, and this Provider has no independent runtime relationship to observe.

</details>
