---
description: "Automatic, bounded routing of explicit architecture and diagram delivery requests to the pinned Archify Skill for users and maintainers configuring or debugging DeepSeek Harness."
kind: "package-reference"
---

# @deepseek-ai/dsh-archify

English | [中文](README.zh.md)

## Summary

Agents can turn explicit architecture, workflow, sequence, data-flow, and lifecycle diagram requests into validated Archify deliverables without exposing Archify in ordinary skill catalogs. The package combines a bounded direct-user-text route with the pinned upstream Skill and CLI, then uses existing shell, filesystem, and `present` surfaces for the work and delivery. Normal requests read no Archify instructions and add no model context. Use `/archify` when a person wants to load the same instructions deliberately.

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

The shipped base row needs no configuration. A later profile patch can adjust the route without changing the upstream payload.

```yaml
- id: archify
  name: '@deepseek-ai/dsh-archify'
  config:
    autoInvoke: true
```

| Field | Default | Meaning |
|---|---|---|
| `autoInvoke` | `true` | Automatically inject Archify instructions after a matching direct user request. |
| `maxUserTextChars` | `4096` | Maximum direct-user characters scanned before the route gives up. |
| `requestPhrases` | built-in list | Action phrases that qualify a request for automatic loading. |
| `diagramPhrases` | built-in list | Diagram-domain phrases that must accompany one action phrase. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-archify) is the exhaustive source for accepted fields.

### Observable success and failures

Loaded instructions enumerate the installed JSON schemas and examples and require shell-based resource discovery before authoring. `DSH_ARCHIFY_SKILL_DIR` belongs to the shell environment, not `run_code`'s `process.env`. Self-contained Bash and PowerShell examples read package resources and execute the CLI while keeping candidate and output paths in the user workspace. Delegated diagram tasks must carry the same resource guidance. A missing PATH command does not mean the bundled CLI is unavailable.

A matching request contributes one durable `archify-auto-invocation` instruction message and makes the upstream body model-visible for that step. The hidden Skill stays out of `dsh-tool-skill` catalogs because it is model-disabled, while `/archify` remains user-invocable. The package does not run the CLI itself: the loaded instructions require the agent to create a candidate, validate it, deliver JSON and HTML, and call `present` for accepted artifacts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package registers one bundled `archify` provider at rank 600 and lazily reads the installed `@tt-a1i/archify-dsh@0.1.0` `SKILL.md` body after stripping its frontmatter. The provider advertises `{ modelInvocable: false, userInvocable: true }`, so existing direct invocation can load it while the generic model catalog cannot advertise it. It contributes the resolved upstream directory to existing shell tools as managed `DSH_ARCHIFY_SKILL_DIR`; rendered instructions use that variable instead of persisting a host-specific package path.

At `agent/pre-step`, a route scans only text blocks from claimed direct user messages, at most `maxUserTextChars` characters. It requires both configured phrase families, skips a direct `/archify` gesture, resolves the winning Skill with the agent scope and abort signal, and appends a `createUserMessage` with the typed `archify-auto-invocation` source. The Session log therefore retains exactly the model-visible instruction injection; nonmatching requests do not read the upstream file.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Bundled provider, validated route configuration, bounded match, and durable injection source. |
| [`tests/archify.spec.ts`](tests/archify.spec.ts) | Default bypass, automatic route, explicit invocation, and production-loop Session coverage. |
| [`tests/profile-lifecycle.spec.ts`](tests/profile-lifecycle.spec.ts) | Real headless-profile boot through the loader. |
| [`tests/archify.integration.spec.ts`](tests/archify.integration.spec.ts) | Upstream CLI delivery, Unicode-path, failure-preservation, and `present` acceptance. |
| — | No runtime invariant companion is published because this plugin emits one sourced instruction only after checking the same claimed direct-user message that it records; there are no independently observed relationships that can diverge. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Skill subsystem reference](../../../docs/subsystems/skills.md) — provider precedence and invocation policy.
- [tool-skill package](../tool-skill/README.md) — the generic model catalog and direct `/name` loading path.
- [Present tool](../../fs/tool-present/README.md) — durable delivery of generated workspace files.
- [Archify upstream](https://github.com/tt-a1i/archify) — the reused schemas, validation, renderer, viewer, and CLI.

<a id="model-experience"></a>
## Model Experience

### Conditional Archify instructions

#### What the model sees

Only a matching direct user request adds the rendered upstream `<skill_content name="archify">` block as an `archify-auto-invocation` Session message. The hidden provider adds no generic catalog entry or tool schema.

#### Token effect

Unmatched requests add zero Archify tokens. A matched request adds the full pinned upstream instructions once for that admitted user batch; direct `/archify` loads the same body through `dsh-tool-skill` instead.

#### KV Cache effect

Unmatched requests preserve the prior request prefix. A matched or direct invocation adds an append-only user instruction message, so its request uses a different prefix from that point; a changed upstream dependency or route configuration can change later matching requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

These limits define the current routing and delivery boundary.

- **Phrase routing is intentionally strict** — a request that lacks one configured action or diagram phrase remains ordinary prose; use `/archify` or configure the phrase lists when a deployment needs another controlled trigger.
- **Delivery remains agent-mediated** — the package injects instructions but does not run Archify or present every generated path; the agent must complete validation and use the existing `present` tool.
- **Upstream visual assurance remains human-owned** — the pinned CLI validates typed artifacts, but visual polish still requires the upstream visual-check flow and human review where that flow is unavailable.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
