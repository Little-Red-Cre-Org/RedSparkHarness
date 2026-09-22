---
description: "RSH plugin-role registry and Cordis lifecycle adapter."
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-host

English | [中文](README.zh.md)

## Summary

`dsh-plugin-host` records a mounted package's RSH role and capability domain while leaving plugin execution, services, events, configuration, and disposal with Cordis. `adaptCordisPlugin()` wraps a legacy Cordis entry for a Loader row; the wrapper requires `ctx.pluginHost`, reserves the descriptor, mounts the original entry in a child Fiber, and releases the descriptor when the wrapper Fiber unloads. `mountCordisPlugin()` provides the equivalent direct-mount helper for integration code.

The package does not publish an invariant companion. Descriptor reservation and removal have one lifecycle authority, the owning Cordis Fiber; package tests observe both facts through the registry and disposer.

## Table of Contents

- [Use the adapter](#use-the-adapter)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-the-adapter"></a>
## Use the adapter

Mount `RshPluginHost` before any adapted row, then publish a dedicated runtime subpath that keeps the legacy package's normal entry unchanged.

```ts
import { Context } from '@deepseek-ai/cordis'
import RshPluginHost, { adaptCordisPlugin } from '@deepseek-ai/dsh-plugin-host'

const ctx = new Context()
const legacyPlugin = () => {}

await ctx.plugin(RshPluginHost)

export default adaptCordisPlugin({
  packageName: '@example/filesystem-tool',
  apiVersion: 1,
  role: 'consumer',
  capability: 'filesystem',
}, legacyPlugin)
```

The descriptor's `packageName`, `role`, and `capability` are validated before the legacy plugin starts. A duplicate active package name fails mounting. Adapting a plugin does not sandbox it: a same-process Cordis plugin remains trusted code with the Context access that its own `inject` declaration receives.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

## Model Experience

None, as the adapter records ownership while Cordis retains model-facing registrations.

#### KV Cache effect

The adapter contributes no model request content, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

- **Legacy execution remains Cordis-native.** The adapter records RSH ownership metadata but does not create a second event bus, Loader, service container, or security isolation boundary.
- **Package metadata is declarative.** `dsh.runtime` declarations identify RSH roles for repository checks; external package loading and version negotiation remain owned by a future compatibility bridge.
