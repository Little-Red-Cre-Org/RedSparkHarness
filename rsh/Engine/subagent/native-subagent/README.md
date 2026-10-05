---
description: "The native foreground Subagent Definition and selected in-process spawn Provider delegate through the active Program executor."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-subagent

English | [中文](README.zh.md)

## Summary

The native foreground Subagent Definition and selected in-process spawn Provider delegate through the active Program executor.

## Table of Contents

- [Configuration](#configuration)
- [Ownership](#ownership)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The native entry requires sessionExecution and promptSections, optionally consumes tools, and provides subagents. Configuration requires providerName. The shipped native-sdk profile installs this Provider with the native tool-subagent Consumer; other native profiles may compose the same modules explicitly.

<a id="ownership"></a>
## Ownership

Resolve captures the exact parent owner, latest logged provider/model/effort, workspace and budgets. Child route overrides clear inherited effort unless explicitly selected. Each fresh child has its own durable Session and descriptor. The existing executor enforces depth, owns the sole writer, and releases child-scoped prompt and tool restrictions. Children disable builtin tools, inherit selected sandbox policy, and cannot request permission expansion. Cancellation and unload drain accepted execution; cleanup failures reject.

<a id="model-experience"></a>
## Model Experience

### Delegation input

#### What the model sees

The child receives its task, deployment persona, delegation permissions and filtered registered tools. Prompt rendering and tool schemas are recorded before each model request. The `subagent` tool receives actual child content and stop reason after cleanup; SDK Session-tree observers receive accepted child events.

#### Token effect

The child task and prompt consume child tokens. Returning its final or partial output adds parent history.

#### KV Cache effect

The child starts a fresh conversation; its request does not reuse the parent conversation prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Persona is literal scoped text; template-variable interpolation is unsupported.
- Background jobs, continuable children, external backends, catalogs and subagent.finished result notifications are not provided by this entry.
- No invariant companion is published: the Program retains Agent, Session and writer authority; the Provider owns only its accepted calls and scoped setup.

<a id="dev-note"></a>
### Dev Note

[Native spawn ownership](../../../../.agents/notes/implemented/architecture/2026-10-05-native-subagent-spawn.md).
