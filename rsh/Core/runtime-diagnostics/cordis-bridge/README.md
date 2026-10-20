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

`hostCordisPlugin` takes the Cordis plugin, its configuration, and the service objects it may read. `nativePluginForCordis` wraps that host as a Native plugin. `requires` must match the package native manifest.

The package owns the Cordis context, not the services. A caller translates the Native services its Cordis plugin reads and hands the translated set to the host; `@deepseek-ai/dsh-native-persona` publishes the persona translation.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Cordis plugin it hosts and the native application that renders the contributions.

#### KV Cache effect

The consuming application owns request-prefix changes from the contributed sections.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only the persona translation ships. Other Cordis rows need their own translation before a Native preset can host them.
- The host runs one Cordis plugin per Native row.

No invariant companion is published. The bridge does not own a relation that independent observations can diverge on.

<a id="dev-note"></a>
### Dev Note

None.
