---
description: "Native profiles can select the existing Cordis local filesystem Provider as their single filesystem implementation."
kind: "package-reference"
---

# @deepseek-ai/dsh-compat-fs-local

English | [中文](README.zh.md)

## Summary

`dsh-compat-fs-local` lets a native consumer use the maintained local filesystem backend. It validates the selected legacy package declaration and local-backend configuration before mounting into the optional shared Cordis Context. The bridge provides one native `fs` service and awaits disposal of its plugin during host shutdown.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The configuration is the documented `dsh-fs-local` configuration, including its optional working directory. Unsupported fields fail before the legacy Context starts. A native profile must select no other `fs` Provider in the same scope.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the native consumer that decides which filesystem outcomes become model-visible and durable.

#### KV Cache effect

No request content is added or reordered.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This bridge selects only `dsh-fs-local`; it does not load a legacy base bundle or discover arbitrary filesystem plugins.
- Local filesystem access remains subject to the selected backend's host-file semantics.

No invariant companion is published because native host lifecycle diagnostics and focused bridge tests observe the sole owned Context.

<a id="dev-note"></a>
### Dev Note

None.
