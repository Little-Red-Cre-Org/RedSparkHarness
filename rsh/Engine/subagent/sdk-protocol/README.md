---
description: "The SDK wire protocol for client and server implementers: the newline-delimited JSON-RPC transport and the named request, result, and notification types spoken between a Harness runtime and its SDK clients."
kind: "package-library"
---

# @deepseek-ai/dsh-sdk-protocol

English | [中文](README.zh.md)

## Summary

`dsh-sdk-protocol` defines the named request, result, and notification types spoken by the Harness runtime and SDK clients, and re-exports the shared JSON-RPC line transport from [Core](../../../Core/util/json-rpc-line/README.md). The serving side is the [`dsh-sdk-jsonrpc-server`](../../../Programs/SDK/packages/server/README.md) plugin; the clients are the TypeScript [`dsh-sdk-client`](../../../Programs/SDK/packages/client/README.md) and the [Python SDK](../../../Programs/SDK/python/README.md), which mirrors these types without importing them. Use this library when implementing or debugging an SDK wire end; it registers no plugin or configuration.

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

Use this package when you build or debug an SDK wire end — the serving plugin, a client library, or custom tooling that speaks the SDK protocol. It gives you one transport for JSON-RPC 2.0 over caller-owned byte streams and the typed shapes for every SDK method and notification.

### Framing and transport

The [Core transport](../../../Core/util/json-rpc-line/README.md) owns newline framing, request correlation, error mapping, listener attachment, and closure. This package re-exports its classes so existing SDK clients and servers retain one transport identity.

### The SDK methods

The compatibility profile serves the original three request methods and four notifications. The native-sdk profile also serves per-Session cancellation, next-step steering, closed-turn forks and live model chunks.

| Direction | Method | Payload types |
|---|---|---|
| client→server | `initialize` | `InitializeParams` → `InitializeResult` |
| client→server | `session/prompt` | `SessionPromptParams` → `SessionPromptResult` (durable enqueue receipt) |
| client→server | `session/cancel` | `SessionCancelParams` → `SessionCancelResult` (native-sdk only) |
| client→server | `session/steer` | `SessionSteerParams` → `SessionSteerResult` (native-sdk only) |
| client→server | `session/fork` | `SessionForkParams` → `SessionForkResult` (native-sdk only) |
| client→server | `shutdown` | no params → `{}` |
| server→client | `session.chunk` | `SessionChunkNotification` (native-sdk live model projection) |
| server→client | `session.event` | `SessionEventNotification` (every session in the runtime, unfiltered) |
| server→client | `session.status` | `SessionStatusNotification` (whole-agent `running`/`idle` transition) |
| server→client | `approval/request` | `ApprovalRequestParams` → `ApprovalRequestResult` (Native SDK child relay only) |
| server→client | `approval/cancel` | `ApprovalCancelNotification` (cancels the matching approval request) |
| server→client | `subagent.started` | `SubagentStartedNotification` |
| server→client | `subagent.finished` | `SubagentFinishedNotification` (in-process runs only) |

`HarnessSdkRequestMap`, `HarnessSdkIncomingRequestMap`, and `HarnessSdkNotificationMap` index these shapes by method name; the package root exports them together with the transport.

`approval/request` carries the parent operation and request identities, SDK session, builtin tool, and call id; the response repeats both identities with one closed outcome. `approval/cancel` cancels only that outstanding request. This relay is installed only in the private SDK child composition when the live parent authority grants it.

### Payload semantics

`SessionPromptResult.messageId` identifies the queued user message; it does not identify a later assistant message, turn ending, or prompt result. `SdkPromptContentBlock` accepts ordinary durable content plus `SdkEncodedImageBlock { type: "image", data, mimeType }`; the server converts encoded images to durable references before enqueue. `InitializeParams.reasoningEffort` is an optional non-empty adapter-owned identifier for the selected provider/model route; omission preserves that model's default. `InitializeParams.maxTokens` is an optional positive safe integer that caps each conversation-model output for SDK-created agents and their in-process descendants; omission lets the selected adapter's exact-model default apply. Native SDK clients may also request positive safe-integer `maxSteps`; the Native server returns an effective per-turn cap no greater than either the request or the profile ceiling, then runs the existing Native Headless loop with it. Clients requesting this field reject missing or larger negotiated values. Native SDK-only `workspaceWriteRoot` must be absolute and adds a narrower fence to builtin `write_file`; `cwd` remains the read and general workspace boundary. The compatibility Cordis server explicitly rejects `maxSteps`, `allowedTools`, and `workspaceWriteRoot` rather than silently ignoring them. The server resolves the exact route during initialization and rejects `session/prompt` until that handshake succeeds, so a missing adapter, unavailable model, or unsupported effort cannot fall back to constructor defaults. `SubagentFinishedNotification.lastAssistantMessage` carries the child's last non-empty assistant message, or its accumulated assistant text when no such message exists; the field is absent when the child produced neither. `serverInfo.name` stays the wire-stable `deepseek-harness-sdk-runtime`. Notification payloads depend on `SessionEvent` (`dsh-session`), `ContentBlock` (`dsh-llm`), and `SubagentStopReason` (`dsh-subagent-protocol`), so the Session types and stop-reason vocabulary are part of the wire contract.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design behind the wire library; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The package is built on one separation: a single newline-delimited transport class shared by both wire ends, and named types that index the protocol methods. The package root is the only import surface — source modules are not exported as deep imports. It is a pure library with no plugin, config, or registration; the serving plugin and the clients own all behavior around it.

### Source map

| File | Role |
|---|---|
| [`src/transport.ts`](src/transport.ts) | Re-exports the Core JSON-RPC line transport |
| [`src/types.ts`](src/types.ts) | Named request/result and notification payload types, indexed by method |
| [`src/index.ts`](src/index.ts) | Consumer interface: the transport and the named wire types |
| — | No runtime invariant companion is published; SDK methods and payloads are type declarations, while the shared transport owns its own pending requests in Core. |

### Frame dispatch

Frame dispatch is owned and tested by the [Core transport](../../../Core/util/json-rpc-line/README.md); the SDK protocol adds only its named method and payload types.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the wire contract is not enough. They move from the serving plugin to the clients and the runnable application.

- [JSON-RPC serving plugin](../../../Programs/SDK/packages/server/README.md) — the runtime plugin that serves this protocol over stdio.
- [TypeScript SDK client](../../../Programs/SDK/packages/client/README.md) — the client that drives this protocol.
- [Python SDK](../../../Programs/SDK/python/README.md) — the Python counterpart that mirrors these shapes.
- [SDK application bundle](../../../Compatibility/DSH/bundle/sdk-app/README.md) — the `dsh --profile sdk` application that boots the server.

-----

<a id="model-experience"></a>
## Model Experience

None, as this is a client-facing wire library; the runtime plugins behind the serving entry own all model-facing behavior.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the protocol does not cover or promise. They are current package constraints, not a comparison with other wire formats or a task backlog.

- **No protocol-version negotiation** — the handshake carries only `serverInfo.version` (`0.0.1`, unvalidated by clients); pre-release stance, no compatibility promise.
- **No session-close method** — native-sdk supports per-session cancellation, steering, and closed-turn forks, but closing a protocol Session independently of the runtime is not part of the wire contract; see the [JSON-RPC serving plugin](../../../Programs/SDK/packages/server/README.md).
- **No general server-initiated request map** — `approval/request` is the only mapped request and is used only when an SDK child is bound to the actual Native parent approval authority; other runtime requests remain unsupported.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the code. This protocol's shapes are mirrored (not imported) by the Python SDK, so changing a method, payload, or the wire-stable `serverInfo.name` here requires updating the Python counterpart and the TypeScript client in the same change. No other unresolved design questions are recorded.

</details>
