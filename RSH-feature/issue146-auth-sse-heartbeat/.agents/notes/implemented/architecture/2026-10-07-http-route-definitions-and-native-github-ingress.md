# Agent Note: HTTP route Definitions and Native GitHub ingress

Status: implemented

English | [中文](2026-10-07-http-route-definitions-and-native-github-ingress.zh.md)

## Problem

The Cordis WebServer and Native Web listener need one HTTP route contract without making a feature package depend on Program transport code. A Native GitHub webhook also needs a truthful HTTP acceptance point: the selected root executor must durably admit this request's message before the endpoint returns success, while browser `/api` authentication, one application, and one Session writer remain owned by their existing Providers.

## Decision

`@deepseek-ai/dsh-http-routes` in `rsh/Core/util/http-routes` owns the generic Node `HttpRoute`, `HttpUpgradeRoute`, `HttpRouteListener`, and `HttpRouteTable` contracts. Its Host, Client, and Native entries are separate: Node route types and one exact/prefix/upgrade registry belong to Host; browser index-injection values belong to Client; the Cordis-free `./native` entry provides the shared table and augments `NativeServices.httpRoutes`. Removing a route or closing the table disconnects admitted requests with incomplete HTTP bodies, then drains their handlers; table close also awaits handlers whose routes were removed earlier. Native Runtime remains an optional peer so non-Native consumers need not install it.

`@deepseek-ai/dsh-http-routes-cordis` in `rsh/Compatibility/DSH/bridge/http-routes-cordis` owns the `ctx.webServer` Context augmentation, `webserver/index-inject` event, WebServer-only bind/compression config, and legacy Web route names. `dsh-host-webserver` remains the Program-owned socket, gzip, fallback, and index transport. It consumes the Core table; it is not moved into Core or Compatibility. Registration disposal is awaitable: it removes future admission and waits for handlers already admitted to that registration. HTTP selects exact paths before the longest matching prefix; upgrades use a separate exact table, so both protocols may claim the same pathname. The Native listener rejects reserved API/channel and Client-page shadows in its own route admission while preserving its `/api` token gate before generic dispatch.

The Native GitHub entry shares bounded untouched-raw-body HMAC verification with the Cordis entry. It resolves the rotating Credential reference for each request, rejects invalid signatures before JSON parsing, and admits one `createUserMessage` through the `rootExecution` Provider already supplied by `native-web-session-controller`. The existing `native-session-execution` Definition owns `NativeServices.rootExecution`; the Core HTTP Definition owns `NativeServices.httpRoutes`. The ingress attaches a settlement observer to `execute()` immediately, correlates `agent/inbox/spliced` to the exact `message.id`, and returns `202` only after that event. A failure or completion before the correlated event returns `503`. After admission, final root settlement is observed and logged. Unload removes route admission, aborts ingress-owned roots, and awaits route-handler and execution drain. The existing `rootExecution` remains the sole root/session authority, and `native-web-host` remains the sole application Provider.

The Native entry is an explicit package export selected by a profile; the default Web or P5 assembly is unchanged.

The earlier HTTP integration shipped as a direct-root transition: authenticated deliveries went to the configured root route while Native rule composition remained P4 follow-up. The P4 extension now supersedes that behavior with `@deepseek-ai/dsh-webhook/native`. Its trusted rules resolve before Session creation; `null` creates no Session or model request; a returned request is prepared through the selected Program's Workspace, Agent preset, permission, model-selection, maintenance, and root-execution Providers. Native `202` follows the request's correlated durable inbox event, not model completion. The Cordis root entry and profile keep their existing compatibility semantics, while Native consumers import the Cordis-free `./definition` contract.

Complete Session-request support currently requires the Native Web root to expose configured dynamic Workspace creation, Workspace registry, recoverable Session deletion, and the preset Providers. The current SDK root facade does not expose `createWorkspaceRoute`, so that Native composition fails during installation. ACP integration is tracked separately and is not claimed as supported by this Native Web path. Successful Workspace metadata creation is durable after path and policy admission; pre-inbox Session failure drains the fresh Agent/route and can recoverably delete only that Session, while admitted Session history remains durable after normal root settlement.

## Alternatives considered

**Move the full Cordis WebServer into Core or the Compatibility bridge.** Rejected because socket ownership, browser API ordering, compression, fallback, and page assembly belong to the selected Program listener; moving that class would widen the generic package and obscure transport policy.

**Keep the generic route table inside the Program WebServer and let Native build another registry.** Rejected because both listeners need the same route and drain semantics, while each feature should depend on the route Definition rather than import a concrete Program. Two registries would also create two sources of route matching and lifecycle behavior.

**Use `webhookRuntime.dispatch()` for Native and acknowledge immediately.** Rejected because its contract is intentionally fire-and-forget and cannot confirm durable admission of the request's exact message through the Native root writer.

**Add a second Native application, inbox observer, or Session writer for the webhook.** Rejected because the selected Web controller already supplies `rootExecution` and the Native Web Host already owns the sole `application`; another executor or writer would duplicate authority.

## Verification

The focused Native Session Controller, Cordis WebServer, and GitHub Loader suites exercise the real Native listener and signed request path, invalid-signature no-effect rejection, pre-admission `503`, correlated durable inbox admission before `202`, browser `/api` `401`, unload abort/drain, same-path HTTP plus upgrade dispatch, and awaited route disposal. A focused TypeScript build covers the changed Host and Client consumers. Strict NodeNext fixtures resolve the pure Native HTTP entry and the explicit Cordis bridge separately without `skipLibCheck`.

## Consequences

- Program listeners keep transport and reserved-path policy while feature modules consume one Core Definition.
- Cordis route disposer callers await teardown and are documented with that contract.
- Native GitHub `202` confirms durable inbox admission for every non-null rule request but does not promise model completion; Cordis `202` retains its in-memory dispatch meaning.
- The Native route remains opt-in and owns only the ingress roots it starts.
