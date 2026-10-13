---
description: "Package map for native child-provider adapters and the shared ACP policy-metadata library."
kind: "package-group"
---

# subagent/ — native subagent adapters and protocol

English | [中文](README.zh.md)

## Summary

This family lets you run native child providers or exchange versioned Native ACP policy metadata. `sdk-child`, `acp-child`, and `codex-app-server` provide product adapters, while `acp-protocol` reads and writes shared metadata. The Engine owns admission, lineage, and parent Session writes; the protocol library does not provide transport or enforce policy.

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
| [`acp-child/`](acp-child/README.md) | Runs an opaque ACP child through the CLI-owned fixed `native-acp-dsh-child` launcher under parent route and file-policy limits | `externalSubagentDriver` |
| [`codex-app-server/`](codex-app-server/README.md) | Provides a Native Codex app-server driver; rejects requests before child startup when Responses from the exact prepared model generation is unavailable or a requested parent `maxTokens` cap cannot be enforced. Successful Codex product execution remains unverified. | `externalSubagentDriver` |
| [`subagent-claude-code/`](subagent-claude-code/README.md) | Runs the Claude Agent SDK under Native parent admission, process ownership, and workspace read limits | `externalSubagentDriver` |

<a id="related-documentation"></a>
## Related documentation

See the [Subagent reference](../../../Docs/subsystems/subagent.md) for admission and lifecycle ownership, and the selected package guide for its route and feature limits.

## Dev Note

None.
