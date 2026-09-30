---
description: "An optional native host owns the shared Cordis Context used by selected DSH compatibility bridges."
kind: "package-reference"
---

# @deepseek-ai/dsh-compat-dsh-runtime

English | [中文](README.zh.md)

## Summary

`dsh-compat-dsh-runtime` lets a native compatibility bridge share one Cordis Context with selected first-party DSH plugins. It validates the Cordis major version, mounts only an allowlisted plugin set, and disposes each mount with the native runtime. Native installations that do not select this package avoid the compatibility dependency.

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

Select this package only when a native profile needs an explicitly supported Cordis DSH adapter.

### When to choose it

Choose it for a compatibility bridge that needs the existing Cordis services or events. Use the native runtime packages directly when the path has no legacy DSH dependency.

### Minimal configuration

The native plugin accepts an empty configuration. It is selected through the native profile manifest rather than a Cordis Loader row.

| Field | Default | Meaning |
|---|---|---|
| configuration | `{}` | No user-configurable fields are accepted. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider creates one Cordis Context, installs `RshPluginHost`, and tracks every mounted Fiber by package name. The allowlist is checked before activation; failed activation disposes the partial Fiber and reports both activation and cleanup errors. Native ownership registers Context and mount cleanup before asynchronous activation settles.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Native runtime](../../../../Core/runtime-diagnostics/native-runtime/README.md) — native lifecycle and cleanup.
- [Plugin host](../compat-plugin-host/README.md) — Cordis descriptor ownership and adapter lifecycle.
- [Architecture](../../../../Docs/architecture.md#cordis) — profile composition and the optional compatibility bridge.

-----

<a id="model-experience"></a>
## Model Experience

### Cordis compatibility bridge

#### What the model sees

The `dsh-compat-dsh-runtime` bridge contributes no direct model-visible content; selected legacy tools remain the owners of their schemas and results.

#### Token effect

The package adds no prompt tokens or tool schemas. A mounted adapter can still expose the schemas owned by its consumer.

#### KV Cache effect

The package does not change the request prefix, so provider cache reuse is unaffected by selecting `dsh-compat-dsh-runtime`.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The package does not load a Cordis Loader profile, legacy application bundle, or arbitrary DSH plugin.
- Existing Cordis application profiles remain Cordis-based; profile composition must select this package only on the native compatibility path.
- The supported adapters cover the filesystem capability family. Each additional DSH plugin needs an explicit manifest, configuration mapping, and lifecycle tests.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The allowlist is intentionally maintained with the compatibility bridge. Expand it only with a package-level ownership record and lifecycle coverage.

</details>
