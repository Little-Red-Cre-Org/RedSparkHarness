---
description: "Native profiles can select an explicit sandbox mode and workspace root for every Session-aware filesystem mutation."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-sandbox-policy

English | [中文](README.zh.md)

## Summary

`dsh-native-sandbox-policy` supplies the mode and root used by a selected sandbox filesystem. Profiles must name `read-only`, `workspace-write`, or `danger-full-access` and an absolute fallback root. Session calls use the immutable Session workspace, so a bridge never silently falls back to an unrestricted local backend.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

`mode` and `workspaceRoot` are required. `workspaceRoot` must be absolute and unknown fields reject profile activation. The native service provides `sandboxPolicy`; sandboxing filesystem Providers require it before activation.

<a id="model-experience"></a>
## Model Experience

Indirectly, through filesystem tools and their native application that render a policy denial and record its result.

#### KV Cache effect

No request content is added or reordered by this package.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The policy has one profile-wide mode and does not project Session override events.
- It confines filesystem bridge decisions only; it is not an operating-system isolation mechanism.

No invariant companion is published because policy resolution has one owning Provider and no independent durable observation.

<a id="dev-note"></a>
### Dev Note

None.
