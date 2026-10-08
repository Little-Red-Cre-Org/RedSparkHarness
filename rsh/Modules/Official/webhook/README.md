---
description: "Package map for verified external events, programmatic rules, and fire-and-forget DSH Session creation."
kind: "package-group"
---

# webhook/ — verified external events to DSH Sessions

English | [中文](README.zh.md)

## Summary

The Webhook family receives authenticated provider events and runs trusted programmatic rules. A rule can create an ordinary root Session inside a Web Workspace. Dispatch is process-local and fire-and-forget, with no delivery database, queue, retry, deduplication, or Agent-completion state.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`webhook/`](webhook/README.md) | Cordis and Native trusted-rule registries with Workspace-backed Session creation | Cordis: `ctx.webhookRuntime`; Native: `webhookRules` |
| [`webhook-github/`](webhook-github/README.md) | Signed GitHub HTTP adapter; Cordis and Native dispatch through their selected rule runtime | Cordis: `ctx.webhookRuntime`, `ctx.webServer`; Native: `httpRoutes`, `webhookRules`, `rootExecution` |

<a id="related-documentation"></a>
## Related documentation

Provider adapters authenticate and normalize deliveries. Rules own trusted conditions and external calls, then return `null` or one Session request. Native `202` waits for each non-null request's durable inbox admission, while Cordis retains its in-memory fire-and-forget contract. The [Webhook subsystem reference](../../../Docs/subsystems/webhook.md) owns shared types and timing guarantees. The complete Native path currently requires configured dynamic Workspace routing on the selected root; the current SDK facade lacks route creation, and ACP integration remains pending.

<a id="dev-note"></a>
## Dev Note

None.
