---
description: "Package map for native child-provider adapters that use the shared Subagent admission and lifecycle contracts."
kind: "package-group"
---

# subagent/ — native child-provider adapters

English | [中文](README.zh.md)

## Summary

The `subagent/` group contains product adapters for the Native Subagent Provider. The Engine owns admission, lineage, and the parent Session writer; each adapter owns only its selected product transport and reports readiness and settlement through the public external-driver contract.

## Packages

| Package | Role | Native capability |
|---|---|---|
| [`sdk-child/`](sdk-child/README.md) | Runs a child through the standard `dsh --profile native-sdk` launcher over the Host-approved managed connection | `externalSubagentDriver` |
| [`codex-app-server/`](codex-app-server/README.md) | Provides the Codex app-server driver for Native external subagents; currently refuses Native requests until authority and execution ceilings can be enforced | `externalSubagentDriver` |

## Related documentation

See the [Subagent reference](../../../Docs/subsystems/subagent.md) for admission and lifecycle ownership, and the selected package guide for its route and feature limits.

## Dev Note

None.
