---
description: "Pure shared Subagent descriptors, assistant-output folding, stop-reason types and delegation permission text."
kind: "package-reference"
---

# @deepseek-ai/dsh-subagent-protocol

English | [中文](README.zh.md)

## Summary

Pure shared Subagent descriptors, assistant-output folding, stop-reason types and delegation permission text.

## Table of Contents

- [Configuration](#configuration)
- [Ownership](#ownership)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The root export and descriptor and assistant-output leaves require no runtime installation. Native and Cordis Consumers use the same descriptor payload, output folding, adjacent-Agent attribution and initial continuation guidance.

<a id="ownership"></a>
## Ownership

Descriptors record child mode, selected provider and label. The output fold consumes accepted Session events and retains actual final or partial assistant content. It creates no Session, writer or execution.

Providers extend `SubagentStopReasonMap` through declaration merging on this package root, and `SubagentStopReason` derives from that map. The Cordis-backed `dsh-subagent` Service Definition re-exports both types.

Settlement helpers select the ending from accepted-work accounting and construct the shared runtime-owned notice, including its child attribution and closing content. The consuming Provider owns cleanup completion and durable inbox admission.

<a id="model-experience"></a>
## Model Experience

### Delegation input

#### What the model sees

The exported `SUBAGENT_DELEGATION_CONTEXT` text constrains child permission scope. A consuming executor must render and log it through its prompt authority.

#### Token effect

Descriptors and folding add no model input. Rendering the delegation text consumes prompt tokens.

#### KV Cache effect

Folding changes no request prefix; the consuming executor owns prompt placement.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Execution, ownership and cancellation belong to consuming Programs and Providers.
- No invariant companion is published because this package owns no mutable registry or lifecycle.

<a id="dev-note"></a>
### Dev Note

[Native spawn ownership](../../../../.agents/notes/implemented/architecture/2026-10-05-native-subagent-spawn.md).
