---
description: "Open configured Native tool groups on demand without granting operation permissions."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-groups

English | [中文](README.zh.md)

## Summary

This optional Native plugin opens configured tool groups on demand within one Session. The same captured selection controls model schemas and execution without changing operation permissions.

## Table of Contents

- [Configuration](#configuration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="configuration"></a>
## Configuration

Install this optional Native plugin after its referenced tools in the same profile scope. It requires `tools` and `activeSessions`; the application must use `builtinTools: false`. Configuration has exactly two fields: `initial`, the initially visible tool names, and `groups`, an array of unique `{ name, description, tools }` entries. Unknown fields and uninstalled tool names reject activation. Names outside these lists stay hidden. `request_tool_group` and the installed `run_code` transport remain available; neither belongs in a deferred group.

Example installation row for a profile with the Native filesystem tools:

```json
{
  "id": "tool-groups",
  "plugin": "@deepseek-ai/dsh-tool-groups",
  "scope": "root",
  "config": {
    "initial": ["read"],
    "groups": [
      { "name": "editing", "description": "Create or edit workspace files", "tools": ["write", "edit"] }
    ]
  }
}
```

The model requests `request_tool_group({ "group": "editing" })`. The ordinary tool card displays its group and returned tool schemas. A persisted grant becomes callable at the next model request, including for nested program bindings. The current batch retains its captured capabilities. Operation approval, sandbox restrictions and scoped tool restrictions still apply. Repeated requests are idempotent in effect.

Grants accumulate within a Session and survive cold or warm resume. New and forked Sessions start from `initial`; inherited events cannot grant capabilities to another Session. Restoration intersects recorded tool names with the current group definition, so adding a tool to a group does not silently grant it to resumed tasks.

<a id="dev-note"></a>
## Dev Note

The [decision](../../../../../.agents/notes/implemented/feature/2026-10-10-on-demand-tool-groups.md) explains request-bound selection. No invariant companion is published: schemas and execution derive from the same registry selection, while the application owns persisted request headers.

<a id="model-experience"></a>
## Model Experience

### Tool-group discovery and expansion

#### What the model sees

The [request tool](../../../../Docs/tool-catalog.md#deepseek-aidsh-tool-groups) uses configured group names and descriptions; the catalog's planning group is an example. Its result supplies complete schemas for the requested group, including program-call parameter descriptions. System prompt sections retain their initial tool guidance; per-request schemas and execution use the current captured selection. The application logs each changed request header, and `tool-groups/opened` records durable grants.

#### Token effect

Initial requests include the configured base tools and directory. Each grant adds the selected group schemas to the result and subsequent requests. No separate model classifies the task or chooses a phase.

#### KV Cache effect

Smaller initial schemas can reduce input tokens. Opening a group can require another model round and changes the schema prefix; savings depend on model pricing and cache behavior. Selection itself makes no model request.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Groups are explicitly configured, not inferred from task phases. The profile installs every referenced tool before this plugin; late registration and changing group definitions require profile reconfiguration.
- Tool visibility does not make unrestricted shell or code runtimes read-only.
- This plugin is opt-in and does not enable itself in daily profiles.
