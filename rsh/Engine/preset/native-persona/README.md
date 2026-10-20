---
description: "The Native standard preset can run the shipped Cordis persona plugin through the Cordis bridge."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-persona

English | [中文](README.zh.md)

## Summary

`dsh-native-persona` is the Native row for the shipped Cordis persona plugin. It runs that plugin through `dsh-cordis-bridge` and publishes the translation that presents the Native prompt registry as the Cordis `systemPrompt` service.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The row accepts the Cordis persona configuration: a required `prefix`, an optional `suffix`, and the optional `complete` and `includeRuntimeContext` flags. It must be installed in a preset scope that can read `promptSections`. The Native web and TUI templates install it on the `standard` scope.

`personaServices` translates the Native prompt registry into the Cordis service surface the persona plugin reads, and registers the persona sections on the installation scope rather than the registry root.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the native application that renders the persona sections and records the assembled prompt.

#### KV Cache effect

The consuming application owns request-prefix changes from the contributed sections.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- `complete` does not replace the whole Native prompt.
- `includeRuntimeContext: false` does not suppress Native runtime-context sections.

No invariant companion is published. Prompt ownership remains with the consuming application.

<a id="dev-note"></a>
### Dev Note

None.
