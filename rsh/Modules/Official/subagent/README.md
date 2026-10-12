---
description: "Package map for native child-provider adapters and the shared ACP policy-metadata library."
kind: "package-group"
---

# subagent/ — native subagent adapters and protocol

English | [中文](README.zh.md)

## Summary

This family lets you run native child providers or exchange versioned Native ACP policy metadata. `sdk-child` and `codex-app-server` provide provider adapters, while `acp-protocol` reads and writes shared metadata. The Engine owns admission, lineage, and parent Session writes; the protocol library does not provide transport or enforce policy.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Choose an adapter for a product route, or use the protocol library when an ACP peer needs the shared policy values.

| Package | Role | Contribution |
|---|---|---|
| [`acp-protocol/`](acp-protocol/README.md) | Defines versioned Native ACP subagent policy metadata; provides no transport or execution | ACP metadata |
| [`sdk-child/`](sdk-child/README.md) | Runs a child through the standard `dsh --profile native-sdk` launcher over the Host-approved managed connection | `externalSubagentDriver` |
| [`codex-app-server/`](codex-app-server/README.md) | Provides the Codex app-server driver for Native external subagents; currently refuses Native requests until authority and execution ceilings can be enforced | `externalSubagentDriver` |
| [`subagent-claude-code/`](subagent-claude-code/README.md) | Runs the Claude Agent SDK under Native parent admission, process ownership, and workspace read limits | `externalSubagentDriver` |

<a id="related-documentation"></a>
## Related documentation

See the [Subagent reference](../../../Docs/subsystems/subagent.md) for admission and lifecycle ownership, and the selected package guide for its route and feature limits.

## Dev Note

None.
