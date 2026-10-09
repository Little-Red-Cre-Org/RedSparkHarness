---
description: "The Native Codex app-server product module for detached external subagents, protocol execution, and child-process lifecycle ownership."
kind: "package-reference"
---

# @deepseek-ai/dsh-codex-app-server

English | [中文](README.zh.md)

## Summary

Run a one-shot text delegation in a fresh Codex app-server thread and return its selected final answer or a safe failure diagnostic. The runner uses pinned @openai/codex@0.161.0 while keeping Codex settings and authentication product-owned. Native requests stop before process startup because the product cannot enforce parent tool authority or the inherited positive maxSteps ceiling.

## Table of Contents

- [Current support matrix](#current-support-matrix)
- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="current-support-matrix"></a>
## Current support matrix

| Route | Current status | Evidence boundary |
|---|---|---|
| DSH Cordis Codex compatibility runner | Executable one-shot text route through the Official product runner | After fixing sandboxMode propagation, the two affected real-product permission cases were rerun: the explicit bypass marker write passed; the never plus configured workspace-write case confirmed that config.toml contains workspace-write but skipped after the nested product tool returned blocked by policy. The write and inheritance remain unverified. The earlier three-file 64-pass/1-skip result predates this fixture correction and is superseded for inheritance attribution. |
| Native Codex external driver | No Native request can execute; every request is refused before `childConnection.connect()` because Codex 0.161 cannot enforce exact parent authority and the positive `maxSteps` ceiling. Deployment `permissionMode`, including full access, cannot override refusal. | The existing `native-admission.spec.ts` regression confirms pre-connect refusal under bypass-configured permissions. This establishes the refusal contract only. |
| Native in-process spawn provider | The shipped Native profile template selects the in-process `spawn` provider except for `native-sdk-dsh-child`, which selects `dsh-sdk`; this Codex driver replaces neither route. | Native child execution is owned by [native-subagent](../../../../Engine/subagent/native-subagent/README.md). The `native-admission.spec.ts` case above covers only this package's pre-connect refusal. |

<a id="use-this-package"></a>
## Use this package

Mount the module in a Native Host composition that provides `childConnection`. The selected Native Subagent provider names the instance; this module registers that name as its external child driver.

```yaml
- name: '@deepseek-ai/dsh-codex-app-server'
  config:
    name: codex
    permissionMode: never
    env: {}
```

| Field | Default | Meaning |
|---|---|---|
| `name` | `codex` | Non-empty Native external-driver name |
| `model` | Unset (Codex settings if used) | Optional Native model default; every Native request currently rejects before product startup, so this value is unused |
| `permissionMode` | `never` | Legacy compatibility-run approval and sandbox policy; Native requests currently stop before thread startup |
| `env` | `{}` | Explicit child environment over Core's credential-scrubbed parent environment |
| `disposeGraceMs` | `3000` | Grace period used by Core to release the managed child range |

The Cordis compatibility runner accepts only text prompt blocks and starts a fresh ephemeral Codex thread. Its model comes from the provider's deployment `config.model` (or Codex settings when unset); each request supplies no model override or `reasoningEffort`. Direct callers of the Official `startCodexProductRun` API may provide those optional fields. The Native driver has no executable request and rejects before product startup, so its declared route-model metadata does not establish model precedence for a running request. Permission modes map to `thread/start` fields: `never` sets `approvalPolicy: never`; `approve-for-me` sets `approvalPolicy: on-request`, `approvalsReviewer: auto_review`, and `sandbox: workspace-write`; `dangerously-bypass-approvals-and-sandbox` sets `approvalPolicy: never` and `sandbox: danger-full-access`. The Native driver rejects before using these deployment settings for a delegated request.

Codex settings and credentials remain product-owned. The app-server command resolves from the pinned package manifest and never uses a host `codex` executable found on `PATH`.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/native.ts` validates configuration, requires Core's `childConnection`, and registers the one `NativeExternalSubagentDriver`. It declares model and reasoning-effort route support and reports persona, tool filtering, structured output, and approval relay as unsupported. `src/run.ts` owns the product run and its protocol decisions. `src/wire.ts` implements the JSON-RPC framing on Core's shared transport.

An accepted compatibility run starts a managed child range, initializes the app-server, creates an ephemeral thread, submits one turn, and settles from that thread's terminal notification. The Native driver rejects before this process path because the pinned product cannot enforce the parent-owned authority and execution ceilings. Process failure, cancellation, and disposal remain attached to the same Core child connection; unloading the module drains its active runs.

No runtime invariant companion is published because the package has no separate package-owned observations that can drift; Core owns the child range and the Official runner owns the app-server lifecycle.

The wire contract follows the stable upstream [`ThreadStartParams` schema](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/app-server-protocol/schema/json/v2/ThreadStartParams.json) and [`TurnStartParams` schema](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/app-server-protocol/schema/json/v2/TurnStartParams.json). The latter declares optional `effort`, which carries `reasoningEffort`.

<a id="further-exploration"></a>
## Further Exploration

- [Codex compatibility bridge](../../../../Compatibility/DSH/bridge/subagent-codex/README.md) — the legacy Cordis adapter over this product API.
- [Subagent subsystem](../../../../Docs/subsystems/subagent.md) — shared delegation semantics and Native ownership.
- [Native subagent driver contract](../../../../Engine/subagent/native-subagent/README.md) — request, capability, result, and lifecycle contract.

<a id="model-experience"></a>
## Model Experience

### Detached Codex child request

#### What the model sees

The Codex app-server receives the request's text blocks as one task in a fresh ephemeral thread. The compatibility runner uses the model configured for its provider instance, or Codex settings when that model is unset; requests cannot supply a model or `reasoningEffort`. Direct Official API callers can supply those fields explicitly. The parent conversation history is not transferred.

#### Token effect

Codex consumes an independent context and turn for the submitted task. Child tokens are reported to the product provider and do not enter the parent's context through this module.

#### KV Cache effect

Independent of the parent model request. Reuse depends on Codex's own model, instructions, configuration, and ephemeral-thread request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Native authority and execution ceilings** — Codex 0.161 exposes no app-server request fields for Native tool grants or `maxSteps`/`maxTokens`. The Native driver rejects every external request before connecting until the product can enforce those parent-owned constraints; deployment permission settings cannot replace them.
- **Text input only** — image and other non-text blocks are rejected before process startup.
- **No inherited conversation** — each run creates a new ephemeral thread and has no resume or pooling path.
- **No optional Native request capabilities** — persona, tool filtering, structured output, and parent approval relay are unsupported and rejected.
- **No human approval channel** — the configured unattended policy answers known app-server requests without asking the parent; unknown requests fail closed.
- **Version-pinned wire contract** — upgrading Codex requires refreshing official schema evidence and running the protocol and real-product gates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
