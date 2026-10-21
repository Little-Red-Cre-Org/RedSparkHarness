---
description: "The Workspace Engine group: shared workspace identity and consumer operations for routing and storage Providers."
kind: "package-group"
---

# rsh/Engine/workspace

English | [中文](README.zh.md)

## Summary

This group defines the workspace identity and operations shared by Engine routing and Workspace Providers. Use its library when a consumer needs to name or resolve a workspace without depending on a particular storage Provider. The official Provider owns workspace records and directory validation.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`workspace-definition/`](workspace-definition/README.md) | Workspace identity and consumer operations shared across routing and storage Providers |

<a id="related-documentation"></a>
## Related documentation

- [Workspace subsystem](../../Docs/subsystems/workspace.md) — workspace behavior and ownership.
- [Official Workspace Provider](../../Modules/Official/workspace/workspace/README.md) — workspace records and directory validation.

<a id="dev-note"></a>
## Dev Note

The [native Session execution decision](../../../.agents/notes/implemented/architecture/2026-10-05-native-session-execution-authority.md) defines how Workspace identity enters execution.
