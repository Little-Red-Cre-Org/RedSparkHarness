---
description: "The one-shot Codex subagent provider for users and maintainers choosing a product backend, installing a Profile bundle, or configuring an unattended Codex delegation."
kind: "package-bundle"
---

# @deepseek-ai/dsh-subagent-codex

English | [中文](README.zh.md)

## Summary

Use this Bundle to delegate a text task to an unattended Codex session in the parent workspace. The Official app-server starts a fresh thread and returns only the final answer or a safe failure diagnostic. Codex native settings and authentication remain in control; permissionMode selects the non-interactive policy.

Native Codex requests stop before startup because 0.161 cannot enforce parent authority or the inherited positive maxSteps limit. The Cordis route runs, but workspace-write inheritance is unverified: the correctly configured product probe returned blocked by policy. Native in-process spawn remains the executable baseline; the default route is unchanged.

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

Mount this provider when a delegation should run as a real Codex session in the parent's workspace. The common path is explicit: install the Bundle into a Profile, optionally configure the provider row, and expose it to the model through a delegation tool row.

### Installing the Bundle

Install the package into the target Profile, then restart that Profile. The installation brings the official wrapper and one compatible native platform payload into the Profile; the declared patch layer registers only the dormant provider and starts no Codex process.

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-codex
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-codex
dsh --profile <name>
```

Removing the package withdraws the provider and its private runtime closure on the next Profile start. Installation controls Host availability, not model permission: the model can only reach the provider through a delegation tool row you compose.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `codex` | Non-empty registry name on `ctx.subagents`; each mounted instance needs a unique value |
| `model` | native Codex settings | Optional non-empty model name fixed for every thread from this provider instance; omission sends no app-server override |
| `env` | `{}` | Explicit child environment layered over the credential-scrubbed parent environment |
| `permissionMode` | `never` | Native non-interactive approval and sandbox mode fixed for every thread from this provider instance |
| `disposeGraceMs` | `3000` | Grace between the shared managed-range owner's termination tiers |

| `permissionMode` value | `thread/start` fields | Native behavior |
|---|---|---|
| `never` | `approvalPolicy: never`; sandbox omitted | Never ask for approval; execution failures return to the model under the native sandbox |
| `approve-for-me` | `approvalPolicy: on-request`, `approvalsReviewer: auto_review`, `sandbox: workspace-write` | Route permission requests through Codex automatic review without a human |
| `dangerously-bypass-approvals-and-sandbox` | `approvalPolicy: never`, `sandbox: danger-full-access` | Skip approval and sandbox enforcement; this value must be selected explicitly |

The generated [configuration catalog](../../../../Docs/config-catalog.md#deepseek-aidsh-subagent-codex) is the exhaustive source for every accepted field and its JSDoc. A configured `model` passes unchanged on each ephemeral `thread/start`; omission leaves native model selection in force. The provider does not discover models, rewrite aliases, select `modelProvider` or `serviceTier`, or set a fallback. Credential-shaped ambient variables are removed before the explicit `env` overlay, so an API key intended for the child must be supplied there.

### Exposing the tool

Each delegation tool row names one provider and needs its own `toolName`, so the model sees static tools rather than a dynamic provider selector. Full Agent Presets carry a matching default tool row with `disabled: true`; copy a preset and remove that field to expose `subagent_codex` only to agents composed from the copy.

```yaml
- id: jobs
  name: '@deepseek-ai/dsh-jobs-local'
- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'
- id: tool-subagent-codex
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: codex
    toolName: subagent_codex
    backgroundMode: one-shot
    maxDepth: provider-managed
```

The `one-shot` policy keeps omitted or `false` `run_in_background` calls in the foreground, while explicit `true` returns a parent-owned Job id for `job_output` or `job_kill`; the base host and full presets already provide the generic Job registry and controls.

### What you get

A foreground call gives the model the selected final Codex answer, or an error with the stop reason and optional safe diagnostic for a failed run. A background call first returns a Job id; the generic job controls later deliver a completion notice and expose the same final answer or failed status through `job_output`. Codex commentary, reasoning, tool activity, raw stderr, and workspace diffs never enter the parent session.

### Failure and recovery

An install that omits optional dependencies, uses an unsupported platform, or loses the selected payload leaves the provider dormant and fails the first delegation at `initialize` with a safe `unknown` category and any observed process outcome; there is no host-CLI fallback. Raw wrapper text stays on Host stderr. A cancelled run settles as `aborted`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the Cordis compatibility adapter delegates to the Official app-server product package; the full contract lives in [Use this package](#use-this-package).

### Design concept

- **One fresh process, thread, and turn per run.** The Official product starts a fresh app-server, creates one ephemeral thread, and executes exactly one turn; there is no continuation, resume, or pooling.
- **Native configuration is authoritative.** Codex configuration and authentication stay native through the parent cwd, `HOME`, and `CODEX_HOME`; the compatibility provider supplies only its optional model, permission mode, and explicit environment overlay.
- **Unattended by design.** Approval, user-input, and MCP requests are answered or declined without a human; unknown server requests fail the run.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, provider registration |
| [`src/run.ts`](src/run.ts) | Cordis task and result translation into the Official product API |
| [`src/wire.ts`](src/wire.ts) | Compatibility re-export of the Official wire type |
| [`cordis.patch.yml`](cordis.patch.yml) | The Profile patch layer that registers the dormant provider |

### Run flow

The adapter accepts only non-empty text blocks, derives the child cwd from the parent Session, and translates the Cordis request and configured provider fields into `startCodexProductRun`. The [Official app-server package](../../../../Modules/Official/subagent/codex-app-server/README.md) owns process startup, the versioned JSON-RPC protocol, ephemeral thread and turn lifecycle, answer selection, failure diagnostics, and managed-range cleanup; this package converts that result into the legacy `SubagentRun` surface.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from this provider to the seam it plugs into and the sibling product provider.

- [Subagent subsystem](../../../../Docs/subsystems/subagent.md) — the service contract, provider contract, and terminal result semantics.
- [dsh-subagent seam](../../../../Engine/subagent/subagent/README.md) — the registry and start API this provider registers on.
- [Official Codex app-server product](../../../../Modules/Official/subagent/codex-app-server/README.md) — protocol, native driver, process, and cleanup authority.
- [Claude Code subagent provider](../../../../Engine/subagent/subagent-claude-code/README.md) — the sibling product backend over the official Agent SDK.
- [Claude Code and Codex backends](../../../../../.agents/notes/implemented/feature/2026-08-04-claude-code-and-codex-subagent-backends.md) — the design record for the product providers.
- [Generated configuration catalog](../../../../Docs/config-catalog.md#deepseek-aidsh-subagent-codex) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### Child request

#### What the model sees

The Codex child receives the standalone text blocks as one turn in a fresh ephemeral thread. Its workspace is the parent Session cwd; the selected Provider instance fixes any configured model, environment, non-interactive approval policy, and sandbox mode, while an omitted model and every other product setting come from native Codex configuration. The executable version comes from the Bundle's pinned platform payload.

#### Token effect

The child pays for an independent Codex context and turn. Child tokens do not enter the parent's context.

#### KV Cache effect

Independent of the parent request cache. Reuse depends only on Codex's own provider, model, instructions, tools, and ephemeral-thread request.

### Parent scheduling and results, indirectly

#### What the model sees

Through `dsh-tool-subagent`, a foreground call gives the parent the selected final Codex answer or an error containing the stop reason and optional safe diagnostic for a non-completed result. The diagnostic can distinguish a coarse action category, protocol stage, applicable numeric HTTP status, and observed process outcome without copying product prose or stderr. A background call first returns a Job id; the generic job controls later deliver a completion notice, expose the same final answer or failed status detail through `job_output`, and let `job_kill` request cancellation. Codex commentary, reasoning, tool activity, raw stderr, workspace diffs, usage, product ids, commands, paths, and protocol payloads are not copied into the parent Session.

#### Token effect

Foreground input grows by the retained final answer or error. Background input also includes the start acknowledgement, completion notice, and any `job_output`, `job_kill`, or later status results; child tokens still do not enter the parent context. This provider adds no parent tool schema by itself.

#### KV Cache effect

Append-only: foreground adds one result after the reusable parent prefix, while background appends the Job acknowledgement, notice, and later control or collection results. Background scheduling can add a notice-driven turn, but none of these messages rewrites the earlier prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when this provider is a poor fit or needs special operational care. They are current package constraints, not a general Codex comparison or a task backlog.

- **One fresh process, thread, and turn per run** — there is no continuation, resume, pooling, progress stream, or product-session persistence.
- **Static instance selection** — Profile rows fix provider names, optional models, and tool bindings; calls cannot choose or change either a provider or model dynamically, and every exposed tool needs a unique `toolName`.
- **Authentication and account state remain native** — the Bundle supplies the CLI but does not create an account, log in, trust a project, or rewrite Codex settings; configuration and authentication failures surface with their lifecycle stage and the safe `unknown` fallback rather than a separate public taxonomy.
- **The native platform payload is required at delegation time** — installs that omit optional dependencies, unsupported platforms, and missing or damaged payloads fail at the first run; there is no host-CLI fallback.
- **Compatibility is version-pinned** — a Codex upgrade requires regenerated upstream schema evidence and handshake, answer-selection, approval, cancellation, keyless real-product, and credentialed DeepSeek nonce checks.
- **No human approval path** — known unattended approval requests are denied and unknown server requests fail closed; the three Profile modes never create a DSH interaction channel or per-call allow policy.
- **Assistant payload is final text only** — a failed run may additionally expose the separate safe diagnostic; reasoning, commentary, intermediate messages, tool traffic, usage, raw stderr, and workspace diffs remain outside the parent Session, while generic Job ids, notices, and status come from the shared job runtime.
- **No optional shared capabilities** — `agentOptions`, output schemas, child personas, tool filtering, and harness depth enforcement are rejected by the shared service for this provider.
- **No wall-clock timeout or side-effect rollback** — the caller cancels long work, and files or external systems changed before cancellation are not restored.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

- **Platform payload selection** — `@openai/codex@0.161.0` declares six platform-specific optional payloads; the workspace lockfile resolves the matching package for supported targets.
- **Version-pinned protocol** — the Official runtime package pins `@openai/codex@0.161.0`. Its v2 [`ThreadStartParams` schema](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/app-server-protocol/schema/json/v2/ThreadStartParams.json) includes the permission fields, and [`TurnStartParams`](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/app-server-protocol/schema/json/v2/TurnStartParams.json) defines optional reasoning `effort`. The keyless real-product test generates schema from the Official package's pinned dependency.

</details>

**Runtime invariant:** No companion is published. Lifecycle pairing belongs to the shared subagent service, and managed-range ownership belongs to the subprocess service.
