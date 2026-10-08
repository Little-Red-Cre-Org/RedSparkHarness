---
description: "Compatibility packages that preserve legacy DSH subagent providers backed by the TypeScript SDK."
kind: "package-group"
---

# DSH subagent compatibility

English | [中文](README.zh.md)

## Summary

This group keeps the Cordis DSH SDK child provider available to compatibility profiles under its existing package name and provider name. It drives a fresh `dsh --profile sdk` child through the public TypeScript SDK client; Engine owns neither this Program dependency nor a second subagent implementation.

Native SDK children use the opt-in [`sdk-child` Module](../../../Modules/Official/subagent/sdk-child/README.md), which receives the Host-approved child connection and leaves admission, cancellation, parent Session writes, and process-range cleanup with Native Subagent and the selected Program. The [Subagent subsystem reference](../../../Docs/subsystems/subagent.md) defines the shared admission and lifecycle contract.

## Packages

| Package | Purpose |
|---|---|
| [`subagent-dsh-sdk/`](subagent-dsh-sdk/README.md) | Legacy Cordis `ctx.subagents` provider for a separate SDK-profile child runtime |
