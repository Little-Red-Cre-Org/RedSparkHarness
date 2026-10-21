---
description: "Webhook rule runtime for maintainers registering trusted external-event policies that create Workspace Sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-webhook

English | [中文](README.zh.md)

## Summary

`dsh-webhook` provides trusted programmatic webhook rules through either the Cordis `ctx.webhookRuntime` or the explicit Native `./native` provider. Both expose `register(rule)` and dispatch verified deliveries; adapter packages own provider authentication. A rule may decline with `null` or request one ordinary root Session inside an admitted Workspace.

## Table of Contents

- [Rule interface](#rule-interface)
- [Session request](#session-request)
- [Composition](#composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="rule-interface"></a>
## Rule interface

`WebhookRule<K>` has a branded unique `id`, a provider `kind`, and `run(delivery, signal)`. A callback may execute arbitrary trusted code and returns either `null` or one `WebhookSessionRequest`. Matching callbacks resolve before the Native provider creates any Session, so a callback failure creates no partial Session actions. When several requests are returned, the Native provider waits for every action to settle; one failed action produces an HTTP failure while any sibling whose inbox was already accepted remains durable.

`VerifiedWebhookDelivery` carries provider kind, configured source id, provider delivery id, normalized lossless JSON, and receipt time. The runtime snapshots and freezes the complete value before sharing it. `deliveryId` is provenance only; repeated delivery runs the rules again.

Registration is an effect. Its awaitable disposer first hides the rule, then aborts and drains active callbacks. Callbacks must observe the supplied signal; same-process code that ignores cancellation cannot be forcibly stopped safely.

<a id="session-request"></a>
## Session request

`WebhookSessionRequest` requires `workspacePath`, `title`, `prompt`, `agentPreset`, and `permissionPreset`; optional `model` names an explicit provider/model route plus an output-token cap. Native validates the path against the selected root's canonical allowed roots and sandbox policy before creating or reusing durable Workspace metadata. Agent preset, permission preset, title, and an explicit model selection are applied to the real Session and ordinary root execution. With no explicit model, the selected route's normal model-selection defaults apply.

Native creates the Session through the selected Program's root maintenance and execution operations, then attaches it to the Workspace and durably enqueues a normal user message with `source.kind: "webhook"` plus provider, source, delivery, and rule provenance. The inbox-spliced event is the admission commit point. Native `202` waits for that event, not for model completion. Afterward the Program settles the turn, retires the exact idle Agent and temporary route, and keeps the durable Session history and Workspace link. A failure before inbox admission drains only the fresh execution created for that request and recoverably removes its Session; a successfully created Workspace record can remain.

The Cordis compatibility provider keeps its existing `Agent.followup()` commit point and process-local fire-and-forget behavior. It does not add a Native Agent or Session authority.

<a id="composition"></a>
## Composition

Load the Cordis provider on the Web Host plane after Agents, model defaults, agent presets, permission presets, titles, and the Workspace registry. User-authored rule plugins inject `webhookRuntime` and yield the disposer returned by `register()` through their own effect. Native compositions load `@deepseek-ai/dsh-webhook/native` with the selected `rootExecution`, Workspace registry, Agent preset and permission preset Providers, recoverable Session deletion, and dynamic `workspaceRoutes` enabled on that root. Explicit model requests additionally require model selection and model directory Providers.

The package root is the Cordis compatibility provider. Only its Cordis and legacy-only Agent helper peers are marked optional; a Cordis profile must provide them, and the workspace CLI profile declares them explicitly. Native runtime and public declaration peers remain required at package level, including peers used only for types. The `dsh.native` service `requires` and `optional` lists describe Provider capabilities separately from package installation requirements. Native consumers can import the neutral `./definition` contract without installing Cordis, while consumers of `./native` must install its declared peers. Missing required peers fail during module resolution. Native Web supports the complete rule-to-Session path when its root has dynamic Workspace creation configured. The current SDK facade does not expose that creation capability, so the Native provider rejects that composition during installation; ACP facade support remains pending its separate integration.

The [GitHub review guide](../../../../Docs/user/guide/github-review.md) shows a rule module, dedicated ingress port, secret setup, and Workspace routing.

<a id="model-experience"></a>
## Model Experience

### Rule-authored initial prompt

#### What the model sees

For each matching rule, the model sees exactly the non-empty text returned as `WebhookSessionRequest.prompt`. The generic runtime adds no private framing; a rule incorporating external text owns its trust labeling. The shipped GitHub example labels selected PR fields as untrusted JSON metadata.

#### Token effect

One data-dependent user-role message is retained in the new Session and contributes tokens until ordinary compaction replaces or removes that history.

#### KV Cache effect

The initial prompt begins a new Session, so it establishes rather than invalidates that Session's reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Process-local fire-and-forget only** — a crash loses rule calls that have not admitted a prompt; there is no queue, replay, or retry.
- **No built-in deduplication** — repeated provider deliveries may create repeated Sessions; rules that need idempotency own it.
- **Trusted callbacks must cooperate with cancellation** — runtime teardown aborts and awaits them but cannot terminate arbitrary same-process code.
- **Workspace metadata is durable** — after canonical path and policy admission, Workspace creation is a durable commit and may remain when later Session preparation or admission fails. Temporary route, Agent, observer, writer, and Workspace attachment cleanup still drains independently.
- **No completion acknowledgement** — Native `202` means every non-null rule action reached durable inbox admission. It does not report model completion. A multi-rule failure may follow a sibling action that was already accepted; accepted messages remain durable.
- **Profile capability is explicit** — the current Native Web composition supports full Session requests. SDK currently lacks the root's dynamic Workspace creation capability and ACP integration is pending; the Native provider refuses installation without the required route operation.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
