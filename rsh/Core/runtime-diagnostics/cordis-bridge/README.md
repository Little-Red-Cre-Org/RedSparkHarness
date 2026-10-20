---
description: "A Native activation can host one Cordis plugin by creating a Cordis context and translating the services that plugin reads."
kind: "package-reference"
---

# @deepseek-ai/dsh-cordis-bridge

English | [中文](README.zh.md)

## Summary

`dsh-cordis-bridge` hosts one Cordis plugin inside a Native activation. It creates a Cordis context, provides the services that plugin reads, and disposes that context with the Native row.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

`hostCordisPlugin` takes the Cordis plugin, its configuration, and the service objects it may read. `nativePluginForCordis` wraps that host as a Native plugin. `requires` must match the package native manifest. `personaServices` presents the Native `promptSections` registry as the Cordis `systemPrompt` service and registers persona sections on the installation scope.

<a id="model-experience"></a>
## Model Experience

Indirectly. A bridged persona contributes system-prompt sections. The consuming application renders those sections and records the assembled prompt.

#### KV Cache effect

The consuming application owns request-prefix changes from the bridged sections.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- `complete` and runtime-context suppression are not carried into the Native prompt registry.
- Only the persona service translation ships. Other Cordis rows need their own translation before a Native preset can host them.

No invariant companion is published. The bridge does not own a relation that independent observations can diverge on.

<a id="dev-note"></a>
### Dev Note

None.
