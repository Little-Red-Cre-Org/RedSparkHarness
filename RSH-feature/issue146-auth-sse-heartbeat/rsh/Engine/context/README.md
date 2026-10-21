---
description: "The context group map: request-context plugins that add durable, model-visible context without defining tools, for users and maintainers navigating the group."
kind: "package-group"
---

# context/ — Request-context plugins

English | [中文](README.zh.md)

## Summary

The context group defines the Native request-context service and provides opt-in contributors: workspace instruction files become guidance, `@file` mentions offer path completion, other sessions can be referenced as bounded snapshots, and the model can see the current time and the agent's tmux location. `dsh-base` includes `agent-instructions` by default, and a profile patch can disable it. Context is durable: injected instructions and references enter session history as user-role messages, so they persist, replay, and compact like other conversation content. This page maps the group; each package README owns the per-package contract.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`agent-instructions/`](agent-instructions/README.md) | Loads `AGENTS.md`/`CLAUDE.md` workspace instructions into context and refreshes them after file edits | — |
| [`session-reference/`](session-reference/README.md) | References other sessions: mention one and its bounded read-only snapshot becomes context | `ctx.sessionReferenceResolver` |
| [`file-reference/`](file-reference/README.md) | `@file` discovery contract, Native service declaration, and shared mention grammar | `ctx.fileReferences` |
| [`file-reference-local/`](file-reference-local/README.md) | Cordis local-workspace completion provider for `@file` mentions | — |
| [`time-context/`](time-context/README.md) | Cordis Agent pre-step Provider for current time, browser zone, and elapsed time | `ctx.sessionProjections` |
| [`native-time-context/`](native-time-context/README.md) | Native Provider that returns durable current-time, browser-zone, and elapsed-time messages to an application Consumer | `timeContext` |
| [`tmux-context-definition/`](tmux-context-definition/README.md) | Cordis-free Native Definition for the durable tmux-context service | `tmuxContext` |
| [`native-tmux-context/`](../../Modules/Official/terminal/native-tmux-context/README.md) | Native Provider that queries the agent's own tmux session, window, and pane through the selected shell | `tmuxContext` |
| [`tmux-context/`](tmux-context/README.md) | Compatibility Agent pre-step Provider for the agent's tmux session, window, and pane location | — |
| [`request-context-definition/`](request-context-definition/README.md) | Defines the Native request-context provider and acceptance types | `requestContexts` |
| [`request-context/`](request-context/README.md) | Native registry that orders scoped providers and delegates message acceptance to the Session-owning Program | `requestContexts` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Session-reference subsystem](../../Docs/subsystems/session-reference.md) — canonical mention URIs, snapshot semantics, and the stable error taxonomy.
- [Workspace-context decision record](../../../.agents/notes/archived/feature/2026-06-24-workspace-context.md) — why instruction context is per-agent/per-session and durably logged.
- [Generated configuration catalog](../../Docs/config-catalog.md) — every config field the group's packages accept.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
