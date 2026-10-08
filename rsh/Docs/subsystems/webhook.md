# Webhook runtime

English | [中文](webhook.zh.md)

The Webhook subsystem turns authenticated external deliveries into zero or more ordinary root Sessions. Provider adapters own authentication and generic JSON intake; trusted programmatic rules own conditions and external calls; Cordis and Native providers own their matching rule lifetimes and Session creation. The Native GitHub entry shares the selected Native HTTP listener, invokes trusted Native rules, and confirms correlated durable inbox admission for every non-null request before acknowledging HTTP. The [implemented webhook decision](../../../.agents/notes/implemented/feature/2026-08-22-fire-and-forget-webhook-sessions.md) records why Cordis keeps no delivery or completion state; the [HTTP route and Native ingress decision](../../../.agents/notes/implemented/architecture/2026-10-07-http-route-definitions-and-native-github-ingress.md) records transport and admission ownership.

## Shared values

`WebhookRuleId`, `WebhookSourceId`, and `WebhookDeliveryId` are opaque strings. A delivery id is provenance only: the runtime neither stores nor deduplicates it.

`WebhookEventMap` is merge-extensible by provider kind. `WebhookEventOf<K>` selects a known provider event and otherwise admits generic lossless JSON, allowing an out-of-tree adapter without changing the runtime package.

`VerifiedWebhookDelivery<K>` contains `kind`, configured `source`, provider `deliveryId`, normalized `event`, and non-negative safe-integer `receivedAt`. The runtime validates, detaches, and freezes the entire value before dispatching it to more than one rule.

`WebhookRule<K>` contains a unique id, provider kind, and `run(delivery, signal)`. The callback may execute arbitrary trusted code. It returns `null` or one `WebhookSessionRequest`, and it must observe the signal for asynchronous work that should stop when the registration unloads.

`WebhookSessionRequest` requires an absolute `workspacePath`, title, text prompt, agent preset, and permission preset. Optional `model` names an explicit provider/model route plus optional output-token cap and uses that adapter's reasoning default. Omission snapshots the complete current deployment selection, including reasoning effort, until the first request records its durable header.

## Fire-and-forget dispatch

`dispatch()` snapshots the matching rules, schedules each independently, and returns before any callback settles. Throws and rejections are contained per rule. Registration disposal removes the rule before aborting and draining its active calls, so no later delivery can enter code that is unloading.

The runtime has no queue, retry, deduplication, execution status, crash replay, Agent-status listener, or completion result. Repeated delivery may create repeated Sessions. The only active-operation table is private teardown bookkeeping and disappears with the process.

## Session creation

A non-null result is snapshotted before asynchronous preflight. The runtime validates permission and agent presets, resolves or creates the canonical Workspace, creates an Agent whose Session cwd equals the Workspace path, mounts the selected agent preset before publication, and durably attaches the Session before applying permission, title, and the initial follow-up.

The Native follow-up is a normal durable user-role message with `source.kind: "webhook"` and provider/source/delivery/rule provenance. Its correlated accepted inbox insertion is the admission commit point. HTTP `202` waits for each non-null request to reach that point; it does not wait for model completion. A `null` rule creates no Workspace route, Agent, Session, or model request. Native first resolves all matching rule callbacks, so callback failure creates no partial Session action. With several returned requests, a pre-admission failure returns an HTTP error after all sibling actions settle; any sibling whose inbox was already accepted remains durable.

Failed attachment disposes the new Agent before a prompt exists. A failure between attachment and prompt admission attempts Workspace detach and Agent disposal without replacing the original error. A Workspace automatically created during preflight remains because another concurrent caller may already use it.

## GitHub adapter

The Cordis `@deepseek-ai/dsh-webhook-github` entry registers an exact route on injected `ctx.webServer`, resolves its credential reference per request, verifies the untouched `application/json` body before parsing, and returns `202` after in-memory dispatch. Its normalized event guarantees a signed lossless-JSON object; rules validate the event-specific fields they consume.

The same package's explicit `./native` entry registers on the route listener provided by Native Web Assets, after that listener's `/api`, mounted-channel, and Client-page checks. It dispatches through `webhookRules`. Each `WebhookSessionRequest` is prepared through the selected Program: its canonical Workspace path must pass configured allowed roots and sandbox policy; its Agent preset, permission preset, title, and optional model selection are applied through the normal root owner; the prompt is durably enqueued as a user message and correlated to its exact `agent/inbox/spliced` event. Pre-inbox failures return `503`. After admission, the root's final outcome remains owned by `rootExecution` and is logged. Unload withdraws route admission, aborts rule callbacks and pre-admission work, and drains route handlers and owned execution. This path does not install a second application, Agent registry, or Session writer.

After canonical path, preset, permission, and optional model admission, Workspace registry creation is a durable commit. If later Session preparation fails, valid Workspace metadata may remain while this action's temporary route and Agent are drained. A Session whose inbox was admitted remains durable after its turn and route settle. If failure occurs before inbox admission, Native drains only the exact fresh execution and may move its Session bytes to recoverable deletion; it does not delete durable Workspace metadata.

Complete Native Web support requires dynamic `workspaceRoutes` and `createWorkspaceRoute` on the selected `rootExecution` Provider, alongside Workspace registry, Agent and permission presets, and recoverable Session deletion. The current SDK facade does not expose dynamic Workspace creation, so the Native Webhook provider refuses that composition instead of silently sending events to a base root. ACP wiring is not part of the current Native Web path. Cordis keeps its compatibility runtime and timing semantics.

The [GitHub review guide](../user/guide/github-review.md) documents the Cordis route on an isolated second WebServer so exposing webhook ingress does not expose the browser API. Native ingress is selected explicitly and reuses its existing Native Web listener.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `rsh/Scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxwebhookruntime--webhookruntime"></a>

### `ctx.webhookRuntime` — `WebhookRuntime`

Fire-and-forget rule runtime. Session creation is the only built-in action.

```ts cordis-catalog
/**
 * Register one trusted programmatic rule.
 * @param rule - unique id, provider kind, and arbitrary callback.
 * @returns awaitable effect disposer that aborts and drains this rule's active callbacks.
 */
register<K extends string>(rule: WebhookRule<K>): () => Promise<void>

/**
 * Start every currently matching rule and return before any callback settles.
 * @param delivery - authenticated provider data; snapshotted before dispatch.
 * @throws synchronously when the runtime is closing or the delivery is malformed.
 */
dispatch<K extends string>(delivery: VerifiedWebhookDelivery<K>): void
```

Source: [`rsh/Modules/Official/webhook/webhook/src/index.ts`](../../Modules/Official/webhook/webhook/src/index.ts)
<!-- END GENERATED cordis-surface -->
