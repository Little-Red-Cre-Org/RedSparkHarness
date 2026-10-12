---
description: "The one-shot Claude Code subagent provider for users and maintainers choosing a product backend, installing a Profile bundle, or configuring an unattended Claude Code delegation."
kind: "package-bundle"
---

# @deepseek-ai/dsh-subagent-claude-code

English | [中文](README.zh.md)

## Summary

Install this Profile Bundle for the retained Cordis compatibility entry, or compose its Native entry when Claude Code should run as the bounded external subagent driver. Each run accepts one self-contained text task and returns final text or a safe failure; product reasoning, tool traffic, stderr, usage, and workspace diffs stay out of the parent Session. Compatibility runs use Claude's native settings and the configured permission mode. Native runs require an explicit Claude model and a Host-resolved credential, and constrain `Read` to the parent workspace. The platform-pinned runtime starts on demand and never falls back to the host `claude` executable.

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

Mount this provider when a delegation should run as a real Claude Code session in the parent's workspace. The common path is explicit: install the Bundle into a Profile, optionally configure the provider row, and expose it to the model through a delegation tool row.

### Installing the Bundle

Install the package into the target Profile, then restart that Profile. The installation brings the pinned Agent SDK and one compatible platform CLI payload into the Profile; the declared patch layer registers only the dormant provider and starts no Claude process.

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-claude-code
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-claude-code
dsh --profile <name>
```

Removing the package withdraws the provider and its private runtime closure on the next Profile start. Installation controls Host availability, not model permission: the model can only reach the provider through a delegation tool row you compose.

### Configuration

These fields configure the retained Cordis compatibility entry only; the Native entry has a separate, explicit configuration.

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `claude-code` | Non-empty registry name on `ctx.subagents`; each mounted compatibility instance needs a unique value |
| `model` | native Claude settings | Optional non-empty model name fixed for every compatibility run from this provider instance; omission sends no SDK override |
| `env` | `{}` | Explicit compatibility SDK/CLI environment layered over the credential-scrubbed parent environment |
| `permissionMode` | `dontAsk` | Compatibility non-interactive permission policy fixed for every run from this provider instance |
| `disposeGraceMs` | `3000` | Grace between the shared managed-range owner's termination tiers |

| `permissionMode` value | Compatibility behavior |
|---|---|
| `dontAsk` | Deny operations that are not already authorized instead of prompting |
| `acceptEdits` | Accept file edits; any remaining permission prompt is denied by the unattended callback |
| `auto` | Let Claude Code's native classifier allow or deny permission requests |
| `plan` | Run in native planning mode, deny execution approval, and return the completed plan as the final answer |
| `bypassPermissions` | Explicitly set the SDK's dangerous confirmation and bypass permission checks |

The generated [configuration catalog](../../../../Docs/config-catalog.md#deepseek-aidsh-subagent-claude-code) documents the retained Cordis entry. Its provider name, optional model, environment, and permission mode do not configure the Native entry. The compatibility entry preserves prior Claude behavior: a configured model passes unchanged to each query, credential-shaped ambient variables are removed before the explicit `env` overlay, and the SDK loads host user, project, and local settings relative to the parent Session cwd.

### Native external driver

The `./native` entry accepts `name` (default `claude-code`), requires an explicit product `model`, and accepts `apiKeyEnv` (default `ANTHROPIC_API_KEY`) for a credential resolved through the Host credentials service. Optional `baseUrl` selects an HTTP(S) Anthropic endpoint, and `disposeGraceMs` defaults to `3000`. Claude Code owns the model protocol; Native returns only final text and enables Claude's `Read` only when the parent grants the built-in `read_file` tool. The provider runs with fixed `dontAsk`, maps parent `maxSteps` to SDK `maxTurns`, and rejects `maxTokens`, route overrides, persona, tool filtering, output schema, and parent approval before process startup. A private `CLAUDE_CONFIG_DIR` contains only generated user settings; managed settings may still apply, so those settings are not the read authority. A `PreToolUse` hook resolves each requested path and denies `Read` outside the canonical parent workspace, including when SDK settings add a wider readable directory. Child confinement uses the selected backend's reported enforcement; Windows ACL and older-kernel Landlock may report `partial`, so this entry does not claim full OS isolation. It fails before startup when no selected backend can apply the parent sandbox policy.

### Exposing the tool

Each delegation tool row names one provider and needs its own `toolName`, so the model sees static tools rather than a dynamic provider selector. Full Agent Presets carry a matching default tool row with `disabled: true`; copy a preset and remove that field to expose `subagent_claude_code` only to agents composed from the copy.

```yaml
- id: jobs
  name: '@deepseek-ai/dsh-jobs-local'
- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'
- id: tool-subagent-claude
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: claude-code
    toolName: subagent_claude_code
    backgroundMode: one-shot
    maxDepth: provider-managed
```

The `one-shot` policy keeps omitted or `false` `run_in_background` calls in the foreground, while explicit `true` returns a parent-owned job id for `job_output` or `job_kill`; the base host and full presets already provide the generic Job registry and controls.

### What you get

A foreground call gives the model the strict final Claude Code answer, or an error with the stop reason and optional safe diagnostic for a failed run. A background call first returns a job id; the generic job controls later deliver a completion notice and expose the same final answer or failed status through `job_output`. Claude Code reasoning, tool activity, intermediate messages, stderr, and workspace diffs never enter the parent session.

### Failure and recovery

An install that omits optional dependencies, uses an unsupported platform, or loses the selected payload leaves the provider dormant and fails the first delegation at the SDK startup boundary with a safe `query-start` / `unknown` failure fact; there is no host-CLI fallback. The original product error stays on the internal cause chain and in the provider's Host log. A cancelled run settles as `aborted`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the provider drives a real Claude Code CLI and where the observable behavior comes from; the full contract lives in [Use this package](#use-this-package).

### Design concept

- **One fresh query per run.** Every run has an independent SDK query, cancellation controller, CLI process, and non-persisted product session; there is no continuation, resume, or pooling.
- **Compatibility and Native settings stay distinct.** The Cordis entry keeps host user, project, and local settings. The Native entry uses its private user settings, leaves managed settings active, and enforces the parent workspace read limit in a `PreToolUse` hook.
- **Unattended by design.** `AskUserQuestion` is disabled and permission prompts are denied except in bypass mode, so the query never waits for a user interface.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, provider registration |
| [`src/run.ts`](src/run.ts) | Cordis adapter over the shared product controller |
| [`src/controller.ts`](src/controller.ts) | Shared SDK query, process lifecycle, and result acceptance |
| [`src/native.ts`](src/native.ts) | Bounded Native external-subagent driver |
| [`src/process.ts`](src/process.ts) | Managed-range termination escalation on disposal |
| [`cordis.patch.yml`](cordis.patch.yml) | The Profile patch layer that registers the dormant provider |

### Run flow

A start accepts only non-empty text blocks and derives the child cwd from the parent request. Both entries invoke the official SDK `query()` through the shared controller, which publishes a run only after the SDK has supplied a live CLI handle owned by the subprocess service and accepts only a successful terminal SDK result followed by normal iterator completion. The Cordis adapter preserves the existing SubagentRun result and diagnostic handling; the Native adapter uses parent admission, sandbox, workspace, tool, and lifecycle authority, then returns only Claude's final text.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from this provider to the seam it plugs into and the sibling product provider.

- [Subagent subsystem](../../../../Docs/subsystems/subagent.md) — the service contract, provider contract, and terminal result semantics.
- [dsh-subagent seam](../../../../Engine/subagent/subagent/README.md) — the registry and start API this provider registers on.
- [Codex compatibility bridge](../../../../Compatibility/DSH/bridge/subagent-codex/README.md) — the legacy Cordis adapter for the Codex product.
- [Official Codex app-server product](../codex-app-server/README.md) — the native app-server protocol and external-child driver owner.
- [Claude Code and Codex backends](../../../../../.agents/notes/implemented/feature/2026-08-04-claude-code-and-codex-subagent-backends.md) — the design record for the product providers.
- [Generated configuration catalog](../../../../Docs/config-catalog.md#deepseek-aidsh-subagent-claude-code) — every accepted Cordis config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### Child request

#### What the model sees

The Claude Code child receives the standalone text task as one fresh SDK query. Compatibility configuration fixes its optional model, environment, and non-interactive permission mode, while an omitted model and other product settings come from Claude's host configuration. The Native entry instead requires its own explicit model and Host-resolved credential, and limits `Read` to the parent workspace when the parent grants `read_file`. Both use the executable version from the pinned SDK platform payload.

#### Token effect

The child pays for an independent Claude Code context and query. Child tokens do not enter the parent's context.

#### KV Cache effect

The compatibility entry keeps the prior product-owned request path. The Native entry runs Claude Code's model and permitted product tools for a bounded standalone task, then sends only final text through the parent-owned Subagent result.

### Parent scheduling and results, indirectly

#### What the model sees

Through `dsh-tool-subagent`, a foreground call gives the parent the strict final Claude Code answer or an error containing the stop reason and optional safe diagnostic for a non-completed result. That diagnostic can distinguish a coarse action category, lifecycle stage, and observed process outcome without copying raw product text or version-specific subtype names. A background call first returns a Job id; the generic job controls later deliver a completion notice, expose the same final answer or failed status detail through `job_output`, and let `job_kill` request cancellation. Claude Code reasoning, tool activity, intermediate messages, stderr, workspace diffs, usage, tool inputs, and raw protocol payloads stay product-local. Compatibility runs also keep product session ids private. Native runs persist the SDK-returned session id only as the opaque `remoteId` on the parent `subagent/external-start` and matching `subagent/external-end` events, and in correlated parent `tool/result` metadata; they do not project Claude protocol data.

#### Token effect

Foreground input grows by the retained final answer or error. Background input also includes the start acknowledgement, completion notice, and any `job_output`, `job_kill`, or later status results; child tokens still do not enter the parent context. This provider adds no parent tool schema by itself.

#### KV Cache effect

Append-only: foreground adds one result after the reusable parent prefix, while background appends the Job acknowledgement, notice, and later control or collection results. Background scheduling can add a notice-driven turn, but none of these messages rewrites the earlier prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when this provider is a poor fit or needs special operational care. They are current package constraints, not a general Claude Code comparison or a task backlog.

- **One fresh query and process per run** — there is no continuation, resume, pooling, progress stream, or product-session persistence.
- **Static instance selection** — Profile rows fix provider names, optional models, and tool bindings; calls cannot choose or change either a provider or model dynamically, and every exposed tool needs a unique `toolName`.
- **Compatibility settings remain host-owned** — when the compatibility `model` is omitted, Claude's project and user settings choose it. Native instead requires an explicit model and uses a private user config; managed settings remain active, while a `PreToolUse` hook enforces the selected parent workspace for `Read`.
- **Authentication and account state remain native** — the Bundle supplies the CLI but does not create an account, log in, or rewrite Claude settings; configuration and authentication failures surface with their lifecycle stage and the safe `unknown` fallback rather than a separate public classification.
- **The SDK platform payload is required at delegation time** — installs that omit optional dependencies, unsupported platforms, and missing or damaged payloads fail at the first query; there is no host-CLI fallback.
- **No Native human interaction path** — Native fixes `dontAsk`, disables `AskUserQuestion`, MCP servers, and plugins, and denies permission requests instead of suspending; Compatibility keeps its configured `permissionMode`.
- **Assistant payload is final text only** — a parent tool result may separately include a safe failure diagnostic, and shared Job controls own background status; reasoning, intermediate messages, tool traffic, usage, stderr, and workspace diffs remain product-local.
- **Bounded Native capabilities** — Native uses Claude's model protocol and permits the product `Read` tool only when the parent grants `read_file`; it rejects route overrides, output schemas, child personas, tool filtering, parent approval, and `maxTokens` because this provider cannot enforce them.
- **No wall-clock timeout or side-effect rollback** — the caller cancels long work, and files or external systems changed before cancellation are not restored.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

- **Payload size disclosure** — the current darwin-arm64 platform payload packs to about 92 MB and unpacks to about 325 MB; these are disclosure numbers, not installation thresholds.
- **Version-pinned protocol** — the runtime dependency is pinned to Agent SDK 0.3.263; upgrading pins a new SDK version and requires re-running the keyless real-product and loader-composition evidence.

</details>

**Runtime invariant:** No companion is published. Lifecycle pairing belongs to the shared subagent service, and managed-range ownership belongs to the subprocess service.
