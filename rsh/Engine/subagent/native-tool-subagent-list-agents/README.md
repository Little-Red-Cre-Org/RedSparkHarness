---
description: "Read-only native list_agents tool for continuable subagents in the selected Program."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-tool-subagent-list-agents

English | [中文](README.zh.md)

## Summary

The `list_agents` tool lets a running native agent recall its continuable children by durable id, label and current residency status. The shipped native SDK and ACP profiles install it with the selected Subagent Provider.

## Table of Contents

- [Configuration](#configuration)
- [Ownership](#ownership)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="configuration"></a>
## Configuration

The `./native` entry requires `tools` and `subagents` and accepts only empty configuration. It rejects a Tools registry different from the Provider's selected registry. Profiles may omit this package while retaining `send_message` and `interrupt_agent`.

<a id="ownership"></a>
## Ownership

The tool asks the selected Subagent Provider to enumerate the Program's existing Session corpus; it owns no storage, Agent, writer or message permission. `children` is the default scope. `descendants` walks direct-parent links in stable pre-order, crossing ordinary Sessions and one-shot children while returning only continuable children. The Program checks the selected workspace, every inspected parent link and subagent delegation depth. A closed child is `ready`; a resident child is `running` during work or `idle` between turns. An unreadable candidate or intermediate yields a per-item diagnostic without hiding healthy siblings. Listing does not authorize message delivery or interruption.

<a id="model-experience"></a>
## Model Experience

### Child discovery

#### What the model sees

The model receives `list_agents` with optional `scope: children | descendants`. Successful results are JSON rows with durable id, label and status; descendants also include parent and depth. Diagnostic rows contain id, reason and, for descendants, position. The ordinary tool result is logged before another model request.

#### Token effect

The schema adds request tokens; each result remains in later model history.

#### KV Cache effect

Installing or removing the tool changes the schema prefix. Listing creates no model request by itself.

## Known Limitations and Deferred Work

- The selected storage list is unpaginated; large Session corpora cost a full header scan.
- An observed status can change before a later control call.
- No invariant companion is published: the Program owns catalog and Agent residency, and the Provider owns descriptor interpretation.

<a id="dev-note"></a>
### Dev Note

[Native catalog ownership](../../../../.agents/notes/implemented/architecture/2026-10-06-native-subagent-catalog.md).
