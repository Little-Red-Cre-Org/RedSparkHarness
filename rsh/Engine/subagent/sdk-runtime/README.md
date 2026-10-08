---
description: "Engine-owned, provider-neutral TypeScript SDK protocol runtime and Session API shared by the public Program facade and Native SDK child adapter."
kind: "package-library"
---

# @deepseek-ai/dsh-sdk-runtime

English | [中文](README.zh.md)

## Summary

`dsh-sdk-runtime` owns the single TypeScript implementation of the Harness SDK wire client and high-level Session API. It runs over one managed child connection and does not choose an executable or construct a product profile. The public [`dsh-sdk-client`](../../../Programs/SDK/packages/client/README.md) facade keeps the supported caller API and supplies the same-version `dsh` launcher; Native Modules use the runtime through the fixed launcher capability supplied by that Program.

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

The package exports the shared `HarnessClient`, `DeepSeekHarness`, Session handle, result and notification types, and the runtime seam used by the Native child Module. It depends on the named [SDK wire protocol](../sdk-protocol/README.md) and Core's `ChildConnection`; its native entry adds only the `sdkChildRuntimeLauncher` service contract to the Native Host type surface. The launcher remains implemented by Programs so this Engine package neither locates `dsh` nor accepts caller-controlled argv.

The `createNativeSdkChildHarness` helper binds the same client implementation to a Program-selected runtime and managed connection. A run performs the protocol initialize handshake before prompts, and requested `maxSteps` must be negotiated by the Native server at an effective positive value no greater than the requested cap. `maxTokens` retains its per-model-output meaning. Session cancel, steer, fork, notification subscriptions, EOF handling, and managed-range disposal all use the shared implementation.

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/api.ts`](src/api.ts) | High-level run and Session API; Native child composition helper |
| [`src/client.ts`](src/client.ts) | JSON-RPC client, handshake, subscriptions, and managed child teardown |
| [`src/native.ts`](src/native.ts) | Engine-owned contract for the injected Program launcher capability |
| [`src/types.ts`](src/types.ts) | Shared runtime and caller option types |
| [`src/index.ts`](src/index.ts) | Package export surface |

The normal caller-facing API and executable resolution remain in [Programs SDK](../../../Programs/SDK/packages/client/README.md). The Engine runtime does not contain another agent loop; the selected Native server routes work through the existing Native Session executor.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [SDK wire protocol](../sdk-protocol/README.md) — shared requests, results, and notifications.
- [Public TypeScript SDK facade](../../../Programs/SDK/packages/client/README.md) — supported caller entry and fixed launcher behavior.
- [Native SDK child Module](../../../Modules/Official/subagent/sdk-child/README.md) — opt-in delegation adapter and authority limits.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the selected runtime server, which assembles model requests and records its Session events.

#### KV Cache effect

Each child Session has its own request history; this transport does not alter request prefixes or provider cache reuse.

## Known Limitations and Deferred Work

- **No built-in approval UI or policy** — TypeScript callers supply `onApprovalRequest`; omission fails closed to `unavailable`, and the callback receives an abort signal for cancellation and close.
- **No product launcher here** — executable discovery and fixed profile assembly remain in Programs by design.
- **No live catalog or credential claim** — controlled protocol fixtures do not establish a user's provider login, subscription catalog, or network inference.

<a id="dev-note"></a>
### Dev Note

The public package names remain `@deepseek-ai/dsh-sdk-runtime` and `@deepseek-ai/dsh-sdk-client`; moving the shared implementation does not add a second transport or alter the caller-facing Program facade.
