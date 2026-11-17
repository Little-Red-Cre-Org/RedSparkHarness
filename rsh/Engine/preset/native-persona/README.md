---
description: "The Native persona row registers preset prompt sections without a Cordis runtime."
kind: "package-reference"
---

# @redspark/rsh-native-persona

English | [中文](README.zh.md)

## Summary

`dsh-native-persona` is the Native row for preset persona text. It registers the prefix and suffix sections directly on the preset scope's prompt registry, using the same owner as the Cordis `dsh-persona` row.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The row accepts the shared persona configuration: a required `prefix`, an optional `suffix`, and the optional `complete` and `includeRuntimeContext` flags. It must be installed in a preset scope that can read `promptSections`. The Native web and TUI templates install it on the `standard` and `minimal` scopes.

`nativePromptSections` presents the Native prompt registry through the shared `PersonaPromptSections` contract and registers sections on the installation scope rather than the registry root. The row imports no Cordis package.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the native application that renders the persona sections and records the assembled prompt.

#### KV Cache effect

The consuming application owns request-prefix changes from the contributed sections.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- `complete` replaces every other visible prompt section. `native-headless` uses that text as the whole system prompt.
- `includeRuntimeContext: false` suppresses the system-prompt runtime-context snapshot for that scope and its descendant Agents.

No invariant companion is published. Prompt ownership remains with the consuming application.

<a id="dev-note"></a>
### Dev Note

`@redspark/rsh-persona/native` owns the two persona sections, complete-prompt policy, and runtime-context suppression. Section names come from `@redspark/rsh-system-prompt/sections`; this row supplies the Native registry's orders. The Cordis entry and this Native installer differ in their registry adapter and how they bind the returned disposers: `ctx.effect` for Cordis and `NativeContext.effect` here.
