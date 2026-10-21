---
description: "Framework-independent Workspace identity and consumer operations shared by routing and storage Providers."
kind: "package-library"
---

# @deepseek-ai/dsh-workspace-definition

English | [中文](README.zh.md)

## Summary

This package owns the WorkspaceId brand, its stateless constructor and the Workspace consumer interface. Engine routing uses the same identity as the official Workspace Provider without depending on that Provider's storage or execution adapters.


## Table of Contents

- [Use this package](#use-this-package)
- [Implementation](#implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>

## Use this package

Import WorkspaceId to admit an external workspace identifier after parser validation. The constructor brands the string; it does not verify that a record or directory exists. The selected Workspace Provider resolves records and validates directory status before Program routing accepts them.

<a id="implementation"></a>

## Implementation

The public values and types are framework independent and shared by Host and Client. The official dsh-workspace/workspace-types export re-exports this Definition. There is one WorkspaceId brand and one Workspace interface; no new registry, domain, Session writer or durable format is introduced.

No ./invariant installer is needed: the constructor has no state or independently observable relationship. Record membership and directory validation belong to the selected Provider.

<a id="further-exploration"></a>

## Further Exploration

- [Workspace subsystem](../../../Docs/subsystems/workspace.md)
- [Official Workspace Provider](../../../Modules/Official/workspace/workspace/README.md)
- [Native root execution](../../core/native-session-execution/README.md)

<a id="model-experience"></a>

## Model Experience

None, as the Workspace identity constructor and consumer types contribute no model-visible text.

#### KV Cache effect

The package constructs no model request and does not change request prefixes or KV-cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- WorkspaceId does not validate record existence or directory status. Callers must use the selected Workspace Provider before routing execution.

No runtime invariant companion is published because the identity constructor and Workspace interface hold no state; membership and directory validation belong to the selected Provider.

<a id="dev-note"></a>

### Dev Note

The [decision record](../../../../.agents/notes/implemented/architecture/2026-10-05-native-session-execution-authority.md) defines installation ownership and supported capabilities.
