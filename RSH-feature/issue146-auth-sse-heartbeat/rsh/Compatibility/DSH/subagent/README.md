---
description: "Compatibility packages that preserve legacy DSH subagent providers backed by the TypeScript SDK."
kind: "package-group"
---

# DSH subagent compatibility

English | [中文](README.zh.md)

## Summary

This group keeps the legacy Cordis DSH SDK and ACP child providers available under their existing package names and provider names. Each package README owns its launcher and process details; Engine owns neither Program dependency nor a second subagent implementation.

Native SDK children use the opt-in [`sdk-child` Module](../../../Modules/Official/subagent/sdk-child/README.md), which receives the Host-approved child connection and leaves admission, cancellation, parent Session writes, and process-range cleanup with Native Subagent and the selected Program. The [Subagent subsystem reference](../../../Docs/subsystems/subagent.md) defines the shared admission and lifecycle contract.

## Packages

| Package | Purpose |
|---|---|
| [`subagent-dsh-sdk/`](subagent-dsh-sdk/README.md) | Legacy Cordis `ctx.subagents` provider for a separate SDK-profile child runtime |
| [`subagent-acp/`](subagent-acp/README.md) | Legacy Cordis `ctx.subagents` provider for an out-of-process ACP child runtime |
