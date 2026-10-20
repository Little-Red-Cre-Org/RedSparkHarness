---
description: "The Native standard preset can run the shipped Cordis persona plugin through the Cordis bridge."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-persona

English | [中文](README.zh.md)

## Summary

`dsh-native-persona` is the Native row for the shipped Cordis persona plugin. It runs that plugin through `dsh-cordis-bridge` and reads `promptSections`.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The row accepts the Cordis persona configuration: a required `prefix`, an optional `suffix`, and the optional `complete` and `includeRuntimeContext` flags. It must be installed in a preset scope that can read `promptSections`. The Native web and TUI templates install it on the `standard` scope.

<a id="model-experience"></a>
## Model Experience

The prefix and suffix become persona system-prompt sections for agents in that preset scope. The consuming application renders them and records the assembled prompt.

#### KV Cache effect

Changing the prefix or suffix changes the rendered system prompt for that preset scope.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- `complete` does not replace the whole Native prompt.
- `includeRuntimeContext: false` does not suppress Native runtime-context sections.

No invariant companion is published. Prompt ownership remains with the consuming application.

<a id="dev-note"></a>
### Dev Note

None.
