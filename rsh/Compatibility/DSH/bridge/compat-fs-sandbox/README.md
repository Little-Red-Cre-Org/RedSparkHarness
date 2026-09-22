---
description: "Native profiles can use the legacy sandbox filesystem only with an explicit native per-Session policy."
kind: "package-reference"
---

# @deepseek-ai/dsh-compat-fs-sandbox

English | [中文](README.zh.md)

## Summary

`dsh-compat-fs-sandbox` selects the existing sandboxing filesystem for a native profile. It requires `sandboxPolicy`, adapts that policy into the isolated Cordis Context, and provides the only native `fs` service. A denied mutation stays denied and this bridge never falls back to bare local storage.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The configuration is the local-backend configuration accepted by `dsh-fs-sandbox`. Profiles must also install `dsh-native-sandbox-policy` with an explicit mode and absolute root. Missing policy, unsupported configuration, or a duplicate `fs` Provider rejects activation.

<a id="model-experience"></a>
## Model Experience

Indirectly, through a native tool that turns a denied filesystem result into model-visible error text and records it.

#### KV Cache effect

No request content is added or reordered.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Filesystem confinement remains the legacy backend's accepted containment model, not kernel isolation.
- Session mode overrides are not projected by the native policy in this phase.

No invariant companion is published because the selected policy and filesystem Provider have one owned installation lifecycle.

<a id="dev-note"></a>
### Dev Note

None.
