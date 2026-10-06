---
description: "Native filesystem events can use the existing observation policy without duplicating decision or observation authority."
kind: "package-reference"
---

# @deepseek-ai/dsh-compat-fs-policy

English | [中文](README.zh.md)

## Summary

`dsh-compat-fs-policy` applies the legacy filesystem observation policy to native `fs/*` events. It forwards decisions and observations from native code into the shared Cordis Context, retaining per-session seen-state and stale-version guards. The compatibility runtime suppresses only a matching synchronous `fs/observed` echo while either bridge is forwarding it. Removing the bridge removes only its own listeners and state.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The bridge accepts no configuration fields. It provides `fsObservationPolicy`, so a native profile cannot select it together with the native observation-policy Provider in one scope.

<a id="model-experience"></a>
## Model Experience

Indirectly, through native filesystem consumers that render the policy's accepted or rejected mutation outcomes.

#### KV Cache effect

No request content is added or reordered.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only native-to-legacy event forwarding is supported.
- The bridge adapts the selected observation policy and does not mount unrelated legacy plugins.

No invariant companion is published because the native event subscription and its legacy Context have one owner.

<a id="dev-note"></a>
### Dev Note

None.
