---
description: "The core group map: the session log, system-prompt assembly, tool registry, agent vocabulary, and default loop that form the product API spine."
kind: "package-group"
---

# rsh/Engine/core

English | [中文](README.zh.md)

## Summary

Use the core packages to build or extend an agent that records durable session history, assembles system prompts, exposes tools, selects a default model, and runs model turns. These packages define the shared APIs used by every composition, while executable product assemblies live under [`rsh/Compatibility/DSH/bundle`](../../Compatibility/DSH/bundle/README.md). Choose this group when developing agent behavior or replacing one of those capabilities; start with [`dsh-base`](../../Compatibility/DSH/bundle/base/README.md) when you need the default runnable composition.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`scope/`](scope/README.md) | Scoped registration and event routing that isolate one agent's contributions | library — no ctx key |
| [`session/`](session/README.md) | The append-only session event log every agent's history derives from | `ctx.sessions` |
| [`system-prompt/`](system-prompt/README.md) | System-prompt assembly from ordered sections, tool schemas, and variables | `ctx.systemPrompt` |
| [`tools/`](tools/README.md) | The tool registry and guarded execution pipeline the loop dispatches through | `ctx.tools` |
| [`agent-tool-presentation/`](agent-tool-presentation/README.md) | Per-agent tool-presentation selector for presets | no ctx key |
| [`agent/`](agent/README.md) | The `Agent` handle plugins program against, plus its live registry and events | `ctx.agents` |
| [`agent-default-model/`](agent-default-model/README.md) | The deployment default model selection entry points apply to fresh agents | `ctx.agentDefaultModel` |
| [`agent-loop/`](agent-loop/README.md) | The default agent driver: creates agents and runs the turn and step lifecycle | `ctx.agentLoop` |
| [`native-headless/`](native-headless/README.md) | One-shot native profile application with file tools and durable Session history | native `application` service |
| [`native-model-execution/`](native-model-execution/README.md) | Records native model streams as Session assistant events | native `modelExecution` service |

`scope` supplies the shared scoping primitive; `agent` owns the public `Agent` contract, while `agent-loop` is its default implementation, so extension plugins depend on `agent` and the driver stays swappable. `agent-default-model` owns the deployment selection an entry point applies when a session has none of its own. Runnable compositions live under [`rsh/Compatibility/DSH/bundle`](../../Compatibility/DSH/bundle/README.md); this group owns only the swappable spine pieces.

-----

<a id="related-documentation"></a>
## Related documentation

- [Core subsystem](../../Docs/subsystems/core.md) — the package-by-package loop map and the `Agent` handle contracts.
- [Session subsystem](../../Docs/subsystems/session.md) — the session event vocabulary and derived history.
- [System-prompt subsystem](../../Docs/subsystems/system-prompt.md) — prompt section, dynamic context, and tool-schema types.
- [Tools subsystem](../../Docs/subsystems/tools.md) — the tool execution pipeline and presentation vocabulary.
- [Scoped registration subsystem](../../Docs/subsystems/scope.md) — the scoped-layer primitive these registries build on.
- [Architecture](../../Docs/architecture.md) — the turn flow and where new behavior goes.
- [Base bundle](../../Compatibility/DSH/bundle/base/README.md) — the default product composition.
- [SDK minimal bundle](../../Compatibility/DSH/bundle/sdk-minimal/README.md) — a complete standalone composition with a deliberately smaller feature set.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
