---
description: "Signed GitHub webhook adapter for deployments routing authenticated JSON events into the webhook runtime."
kind: "package-reference"
---

# @deepseek-ai/dsh-webhook-github

English | [中文](README.zh.md)

## Summary

`dsh-webhook-github` supports two selected entries over one raw-body HMAC verifier. The Cordis entry registers on `ctx.webServer`, dispatches through `ctx.webhookRuntime`, and returns `202` after in-memory dispatch. The explicit Native entry registers on the selected Native HTTP listener, dispatches through trusted `WebhookRule` callbacks, and returns `202` only after every non-null Session request has a durably admitted inbox message. Use the entry that matches the owning runtime and its admission contract.

## Table of Contents

- [Configuration](#configuration)
- [HTTP contract](#http-contract)
- [Native ingress](#native-ingress)
- [Dedicated listener composition](#dedicated-listener-composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="configuration"></a>
## Configuration

| Key | Meaning |
|---|---|
| `source` | Non-empty adapter instance carried to Cordis rules or Native webhook provenance, such as `primary-github`. |
| `path` | Exact non-root pathname without trailing slash, query, or fragment. |
| `secretEnv` | Credential reference containing the GitHub webhook secret. |
| `maxBodyBytes` | Positive safe-integer ceiling for the untouched request body. |
| `rootRoute` | Native-only id of the configured base route selected by `rootExecution`; each rule request's Workspace is separately admitted under that route. |

The Cordis entry requires the first four fields. The Native entry additionally requires `rootRoute`. The secret reference is resolved for every request, so rotation affects the next delivery without reloading the plugin.

<a id="http-contract"></a>
## HTTP contract

Only `POST application/json` is accepted. The adapter reads a bounded UTF-8 body, requires `X-Hub-Signature-256`, `X-GitHub-Delivery`, and `X-GitHub-Event`, resolves the secret, verifies HMAC before JSON parsing, and requires a top-level lossless-JSON object. It never logs the secret, signature, or payload.

| Status | Meaning |
|---|---|
| `202` | Cordis: verified JSON was dispatched in memory. Native: all matching rules finished, and every non-null Session request reached its correlated durable `agent/inbox/spliced` event. A `null` result or no matching rule creates no Session and makes no model request. |
| `400` | Required header, UTF-8, JSON, or top-level object was invalid. |
| `401` | Signature was invalid. |
| `405` | Method was not `POST`. |
| `413` | Declared or streamed body exceeded `maxBodyBytes`. |
| `415` | Media type was not `application/json`. |
| `503` | Credential, selected runtime, Workspace admission, rule execution, or pre-inbox Session admission failed. In a multi-rule delivery, another action may already have durably admitted its inbox message; that accepted action is not rolled back. |

GitHub event-specific field validation belongs to each trusted rule; the adapter guarantees only authenticated generic JSON. The Cordis entry does not wait for rule execution. Native acceptance waits for each non-null request's durable inbox admission, not model completion. Repeated deliveries are not deduplicated.

<a id="native-ingress"></a>
## Native ingress

Select the package's `./native` entry only in a Native profile that provides the Native Web listener, credentials, `rootExecution`, `webhookRules`, and the Workspace, Agent-preset, and permission-preset Providers. Configure `source`, `path`, `secretEnv`, `maxBodyBytes`, and the existing base `rootRoute`; each returned `WebhookSessionRequest.workspacePath` is canonicalized and admitted by that root's dynamic Workspace route policy. The root must expose `createWorkspaceRoute` and recoverable Session deletion. This package does not provide an application or root execution provider. `native-web-session-controller` remains the selected provider of `rootExecution`, and `native-web-host` remains the sole application.

The Native listener keeps its `/api` token and mounted-channel checks ahead of generic routes and rejects a webhook path that overlaps those routes or the Client page. GitHub HMAC still covers the original raw body before JSON parsing. The adapter awaits the Native rule registry: matching callbacks resolve before any Session creation; `null` rules create nothing, while each non-null request creates an ordinary Program-owned root Session using its title, prompt, Agent preset, permission preset, optional model selection, and admitted Workspace. `202` follows the correlated durable `agent/inbox/spliced` event for each request. Failure before inbox admission returns `503`; any sibling action already accepted remains durable. After admission, root settlement is observed and logged. Unloading removes route admission, aborts rule callbacks and pre-admission work, and waits for route handlers and owned executions to drain.

The complete request path is currently supported by Native Web when `workspaceRoutes` is explicitly configured on the selected root. The current SDK facade does not expose dynamic Workspace creation, so loading the Native webhook provider there fails at composition time; ACP facade support is pending its separate integration. Cordis keeps its compatibility rule runtime and timing.

<a id="dedicated-listener-composition"></a>
## Dedicated listener composition

The normal Web profile already owns `ctx.webServer`. Mount another `dsh-host-webserver` and this adapter inside a group that isolates only `webServer`; the adapter still inherits credentials and `webhookRuntime`. The [GitHub review guide](../../../../Docs/user/guide/github-review.md) uses `127.0.0.1:3081/github` behind a TLS reverse proxy while the UI remains on port 3080.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the selected runtime's rule contract; the adapter authenticates and dispatches data but does not assemble a model request.

#### KV Cache effect

Independent. Authentication and HTTP dispatch do not touch a model request; any new Session prefix belongs to the consuming rule and runtime.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No TLS** — the injected development WebServer is normally loopback-only behind a TLS reverse proxy or tunnel.
- **Generic payload validation only** — rules own validation of the GitHub event fields they consume.
- **No provider acknowledgement of downstream completion** — Cordis `202` precedes rule calls and Session creation; Native `202` confirms durable inbox admission for every non-null request, not model completion.
- **Multi-rule partial commit is possible** — if one Session request fails before admission, sibling requests are drained before `503`; any inbox already accepted remains durable and may be repeated if the provider retries.
- **Profile capability is explicit** — the current Native Web profile supports complete Session requests when dynamic Workspace routing is enabled. SDK does not yet expose that route creation operation, and ACP integration remains pending.
- **No form encoding** — GitHub must send `application/json`; `application/x-www-form-urlencoded` is rejected.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Authentication and input validation occur at the exact HTTP operation; dsh-host-webserver owns route/disposer symmetry.
