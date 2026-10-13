---
description: "Automatic, bounded routing of explicit architecture and diagram delivery requests to the pinned Archify Skill for users and maintainers configuring or debugging DeepSeek Harness."
kind: "package-reference"
---

# @deepseek-ai/dsh-archify

English | [中文](README.zh.md)

## Summary

Agents can turn explicit architecture, workflow, sequence, data-flow, and lifecycle diagram requests into validated Archify deliverables without exposing Archify in ordinary skill catalogs. The package combines a bounded direct-user-text route with the pinned upstream Skill and CLI, then uses existing shell, filesystem, and `present` surfaces for the work and delivery. Normal requests read no Archify instructions and add no model context. In Cordis profiles, use `/archify` when a person wants to load the same instructions deliberately.

The Cordis profile entry is the package root and exposes `Config`. The package also exports a Cordis-free Host plugin at `./native`; both entries use the same configuration fields and normalization, provider, bounded matcher, and resource guidance. The Native plugin requires `skills`, `shellEnv`, and `requestContexts`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The standard `dsh-base` bundle mounts this package before `dsh-tool-skill`, so supported profiles route eligible requests without a separate profile installation.

### When to choose it

Keep the default when agents should create a typed architecture or runtime-flow artifact only after the user clearly asks to generate, draw, export, or deliver one. Ordinary explanation, code, and discussion requests stay outside the route. Use `/archify` for an explicit load when the request deliberately omits the route's action or diagram words; patch `autoInvoke: false` when a deployment wants manual invocation only.

### Minimal configuration

The shipped Cordis base row needs no configuration. A later profile patch can adjust the route without changing the upstream payload; Native compositions pass the same fields to `./native`.

```yaml
- id: archify
  name: '@deepseek-ai/dsh-archify'
  config:
    autoInvoke: true
```

| Field | Default | Meaning |
|---|---|---|
| `autoInvoke` | `true` | Automatically inject Archify instructions after a matching direct user request. |
| `maxUserTextChars` | `4096` | Maximum direct-user characters the automatic route can observe completely; longer input is ineligible for automatic loading. |
| `requestPhrases` | built-in list | Action phrases that qualify a request for automatic loading. |
| `diagramPhrases` | built-in list | Diagram-domain phrases that must accompany one action phrase. |

The generated [configuration catalog](../../../../Docs/config-catalog.md#deepseek-aidsh-archify) is the exhaustive source for accepted fields.

### Observable success and failures

Loaded instructions enumerate the installed JSON schemas and examples and require shell-based resource discovery before authoring. `DSH_ARCHIFY_SKILL_DIR` belongs to the shell environment, not `run_code`'s `process.env`. Self-contained Bash and PowerShell examples read package resources and execute the CLI while keeping candidate and output paths in the user workspace. Delegated diagram tasks must carry the same resource guidance. A missing PATH command does not mean the bundled CLI is unavailable.

A matching request contributes one `archify-auto-invocation` instruction message and makes the upstream body model-visible for that step. The message source has the same public type in both entries; see the [Skills subsystem reference](../../../../Docs/subsystems/skills.md#automatic-archify-invocation). The hidden Skill stays out of `dsh-tool-skill` catalogs because it is model-disabled, while the Cordis `/archify` route remains user-invocable. The package does not run the CLI itself: the loaded instructions require the agent to create a candidate, validate it, deliver JSON and HTML, and call `present` for accepted artifacts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Both entries register one bundled `archify` provider and lazily read the installed `@tt-a1i/archify-dsh@0.1.0` `SKILL.md` body after stripping its frontmatter. The provider advertises `{ modelInvocable: false, userInvocable: true }`, so existing direct invocation can load it while the generic model catalog cannot advertise it. Both contribute the resolved upstream directory to existing shell tools as managed `DSH_ARCHIFY_SKILL_DIR`; rendered instructions use that variable instead of exposing an absolute install path.

The Cordis entry registers at `agent/pre-step`. It observes eligible text blocks from claimed direct user messages up to `maxUserTextChars`; if any direct-user text would be truncated, it declines automatic routing even when the observed prefix contains both phrase families. Only a complete bounded observation with an action phrase and a diagram phrase can match, and a direct `/archify` gesture always bypasses automatic loading. A match resolves the winning Skill with the agent scope and abort signal, then appends a `createUserMessage` with the typed `archify-auto-invocation` source.

The `./native` entry is a Host plugin that installs the same provider and shell environment contributor. When `autoInvoke` is enabled, its `requestContexts` provider applies the same complete-observation rule, resolves the skill with the request scope, owner Session cwd, and abort signal, then returns a user message with the same source type. Nonmatching requests do not load the upstream Skill body.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Cordis entry, provider registration, and automatic instruction route. |
| [`src/native.ts`](src/native.ts) | Cordis-free Native Host plugin and request-context route. |
| [`src/shared.ts`](src/shared.ts) | Shared config schema, hidden provider, resource guidance, and bounded matcher. |
| [`src/types.ts`](src/types.ts) | Public automatic-invocation message source type. |
| — | No runtime invariant companion is published because this plugin emits one sourced instruction only after checking the same claimed direct-user message that it records; there are no independently observed relationships that can diverge. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Skill subsystem reference](../../../../Docs/subsystems/skills.md) — provider precedence and invocation policy.
- [tool-skill package](../tool-skill/README.md) — the generic model catalog and direct `/name` loading path.
- [Present tool](../../fs/tool-present/README.md) — durable delivery of generated workspace files.
- [Archify upstream](https://github.com/tt-a1i/archify) — the reused schemas, validation, renderer, viewer, and CLI.

<a id="model-experience"></a>
## Model Experience

### Conditional Archify instructions

The Session-log and request-prefix details below describe the Cordis entry. The Native entry supplies the same bounded match and message source through `requestContexts` during request preparation.

#### What the model sees

Only a complete, in-budget matching direct user request adds the rendered upstream `<skill_content name="archify">` block as an `archify-auto-invocation` Session message. The hidden provider adds no generic catalog entry or tool schema.

#### Token effect

Unmatched requests add zero Archify tokens. A matched request adds the full pinned upstream instructions once for that admitted user batch; direct `/archify` loads the same body through `dsh-tool-skill` instead.

#### KV Cache effect

Unmatched requests preserve the prior request prefix. A matched or direct invocation adds an append-only user instruction message, so its request uses a different prefix from that point; a changed upstream dependency or route configuration can change later matching requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

These limits define the current routing and delivery boundary.

- **Phrase routing is intentionally strict** — a request that lacks one configured action or diagram phrase, or exceeds the complete-observation limit, remains outside automatic routing; use `/archify` or configure the phrase lists when a deployment needs another controlled trigger.
- **Delivery remains agent-mediated** — the package injects instructions but does not run Archify or present every generated path; the agent must complete validation and use the existing `present` tool.
- **Upstream visual assurance remains human-owned** — the pinned CLI validates typed artifacts, but visual polish still requires the upstream visual-check flow and human review where that flow is unavailable.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
