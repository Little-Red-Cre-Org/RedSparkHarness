---
description: "The Native Codex app-server product module for detached external subagents, protocol execution, and child-process lifecycle ownership."
kind: "package-reference"
---

# @deepseek-ai/dsh-codex-app-server

English | [中文](README.zh.md)

## Summary

Run a one-shot text delegation in a fresh Codex app-server thread and return its selected final answer or a safe failure diagnostic. The runner uses pinned @openai/codex@0.162.1 while keeping Codex settings and authentication product-owned. Native requests require the Engine to capture a Responses transport from the exact selected prepared model generation. The shipped SIWC `openai-codex` route supplies that transport, but reports output-token limits as unsupported; a parent `maxTokens` request therefore fails before child connection. Shipped profile templates keep the in-process subagent provider as their default and do not install this external driver.

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
| Native Codex external driver | Native admission uses the Responses transport captured from the selected prepared model generation. The shipped SIWC `openai-codex` route provides it, but does not enforce output-token limits; shipped profile templates retain their in-process default and omit this driver. Completed Codex product execution still needs independent validation. | Engine capture rejects a missing `PreparedAdapterCall.nativeResponses`; the driver checks the captured route and output-cap capability before connecting. |
| Native in-process spawn provider | The shipped Native profile template selects the in-process `spawn` provider except for `native-sdk-dsh-child`, which selects `dsh-sdk`; this Codex driver replaces neither route. | Native child execution is owned by [native-subagent](../../../../Engine/subagent/native-subagent/README.md). The `native-admission.spec.ts` case above covers only this package's pre-connect refusal. |

<a id="use-this-package"></a>
## Use this package

Mount the module in a Native Host composition that provides `childConnection`. The selected Native Subagent provider names the instance; this module registers that name as its external child driver.

The Host composition must provide `@deepseek-ai/dsh-llm` and `@deepseek-ai/dsh-native-subagent` as required peers at compatible versions in the same Host dependency graph.

```yaml
- name: '@deepseek-ai/dsh-codex-app-server'
  config:
    name: codex
    permissionMode: never
    env: {}
    limits:
      requestBytes: 1048576
      responseBytes: 4194304
      jsonDepth: 64
      sseEvents: 10000
```

| Field | Default | Meaning |
|---|---|---|
| `name` | `codex` | Non-empty Native external-driver name |
| `model` | Unset | Unsupported; the captured Native route selects the model, and setting this field rejects configuration |
| `permissionMode` | `never` | Native accepts only omitted or `never`; other modes reject configuration |
| `env` | `{}` | Native accepts only an empty map; the isolated launcher owns the scrubbed child environment |
| `limits` | Required | Positive safe-integer ceilings for `requestBytes`, `responseBytes`, `jsonDepth` and `sseEvents` |
| `disposeGraceMs` | `3000` | Grace period used by Core to release the managed child range |

The Cordis compatibility runner accepts only text prompt blocks and starts a fresh ephemeral Codex thread. Its model comes from the provider's deployment `config.model` (or Codex settings when unset); each request supplies no model override or `reasoningEffort`. Direct callers of the Official `startCodexProductRun` API may provide those optional fields. The Native route takes its provider, model and reasoning effort from the resolved Engine request. Engine admission captures Responses projection and forwarding from the matching prepared model generation; when the parent supplies `maxTokens`, the captured generation must enforce a hard output cap and the final projected `max_output_tokens` must fit that limit. When the Engine selects a reasoning effort, the final projected `reasoning.effort` must preserve it. Missing transport or cap support fails before child startup. The Codex permission policy is fixed to `never` on this Native route.

Codex settings and credentials remain product-owned. The app-server command resolves from the pinned package manifest and never uses a host `codex` executable found on `PATH`.

Callers choose Core's child environment mode explicitly: the Cordis bridge uses `scrub-overlay`, while the isolated Native launcher uses `replace` with a private environment and `SystemRoot` on Windows.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/native.ts` validates configuration, requires Core's `childConnection`, and registers the one `NativeExternalSubagentDriver`. It declares model and reasoning-effort route support and reports persona, tool filtering, structured output, and approval relay as unsupported. `src/run.ts` owns the product run and its protocol decisions. `src/wire.ts` implements the JSON-RPC framing on Core's shared transport.

An accepted compatibility run starts a managed child range, initializes the app-server, creates an ephemeral thread, submits one turn, and settles from that thread's terminal notification. A Native run requires the captured Engine Responses transport before this product process path; the shipped SIWC `openai-codex` provider supplies it when selected, while shipped profile templates omit this driver. Process failure, cancellation, and disposal remain attached to the same Core child connection; unloading the module drains its active runs.

The Native product runner builds Codex and Responses function definitions from the captured direct Engine schemas. It exposes a completed model response only after the Engine records it, matches each app-server call's thread, turn, call ID, name, namespace, and JSON arguments to its one-use grant, and executes the call through the captured Engine operation. Tool results return text and verified image data URLs; result-owned and accepted settlement contexts are appended once to the next durably recorded request. A concluding result closes later model admission and interrupts its exact Codex turn after every accepted tool reply is written, preserving the Engine result when the turn reports `interrupted`. A request arriving before Codex reports that interruption receives a local 403 without replacing the successful conclusion with a fatal model error.

The isolated Native product runner requires captured `projectRequest` and `forward` callbacks to apply the selected provider's policy and use its credentials. It records and forwards the same projected body; this package does not resolve provider credentials or implement those callbacks. The transport must come from the Engine-selected prepared model generation. A parent output-token ceiling is accepted only when that generation enforces the cap and the final projected body includes a valid `max_output_tokens` no greater than the ceiling. The Engine propagates a process-local generation capability bound to the outer operation's exact prepared model handle, so a same-route nested request captures its own transport from that generation without looking up a later adapter. This does not enable provider overrides, which the Native Codex driver rejects. The shipped SIWC `openai-codex` route supplies the captured transport when selected, but shipped profiles do not install the Codex driver and the provider cannot enforce output-token ceilings. Completed Native Codex execution and SDK event projections still need independent validation.

Disposal drains accepted Engine executions and the Core-managed child range, closes the local gateway, and removes the private Codex home. It allows one Node filesystem retry for retryable removal errors after the same resolved `disposeGraceMs`; persistent removal errors still reject disposal.

No runtime invariant companion is published because the package has no separate package-owned observations that can drift; Core owns the child range and the Official runner owns the app-server lifecycle.

The wire contract follows the stable upstream [`ThreadStartParams` schema](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-protocol/schema/json/v2/ThreadStartParams.json) and [`TurnStartParams` schema](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-protocol/schema/json/v2/TurnStartParams.json). The latter declares optional `effort`, `parentTurnId`, and `rootTurnId`. This detached task has no parent or root Codex turn identifiers, so both ancestry fields remain unset; the adapter binds the active turn from `turn/start` for dynamic-call checks and conclusions. An RSH Session ID is not a Codex turn ID.

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

- **Native product admission** — the isolated product runner enforces captured tool grants. The Engine and SIWC provider expose the prepared-generation Responses transport for an explicitly composed route; shipped Native profiles still select the in-process spawn provider and omit the Codex external driver, and successful Codex product execution remains unverified. Native configuration cannot select another model, inject child environment variables, or relax the fixed permission policy.
- **Text task input** — the initial task accepts text only. Accepted Engine tool results may contain verified images, which the captured image service resolves before the gateway builds data URLs.
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
