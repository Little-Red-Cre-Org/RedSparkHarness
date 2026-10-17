---
description: "The TypeScript SDK client for callers that spawn a DeepSeek Harness runtime subprocess and drive agent turns over stdio JSON-RPC: the DeepSeekHarness run API and the lower-level HarnessClient."
kind: "package-library"
---

# @deepseek-ai/dsh-sdk-client

English | [中文](README.zh.md)

## Summary

`dsh-sdk-client` lets TypeScript callers drive Harness over stdio JSON-RPC. `DeepSeekHarness` opens Sessions, sends text or image prompts, streams notifications, and returns the last committed root response after the Agent idles; `HarnessClient` exposes protocol requests and subscriptions. `RunResult.events` preserves all six root `subagent/external-operation` variants and their fields unchanged. `NativeExternalOperationEvent` is the canonical Engine union; `NativeExternalOperationSessionEvent` adds its Session envelope. Native Sessions reopen from durable history after a runtime restart. It resolves the same-version `@deepseek-ai/dsh` executable by default or accepts `dshBin`; it owns and reaps the child process across runs through `close()` or `await using`. Callers choose profile and launch settings.

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

The Native SDK composition provides the production in-process subagent tool. A new standard `sdk` profile selects this composition; an existing profile with a `package.json` keeps the runtime declared by its manifest. Session-tree subscriptions receive accepted child events and real `subagent.finished` results after one-shot completion, cancellation, failure, and continuable residency settlement; interrupting a turn alone does not finish a still-resident child, and run results retain root-only response projection. Background children return a Jobs handle after actual readiness and survive ordinary parent turns; job_output/job_kill provide output and cancellation controls. The profile installs send_message and interrupt_agent; setting the subagent tool backgroundMode to continuable admits durable child work, supports follow-up steering and interruption, and cold-resumes the same child after a process restart. A settled continuable child contributes a durable subagent-settled notice to the parent's next turn, after actual cleanup. SDK wire catalog discovery remains unsupported; the profile's model-visible `list_agents` tool is a separate capability.

Use this client when TypeScript code must drive a complete Harness runtime from another process and you can name the runtime executable explicitly. The common path is minimal: construct a `DeepSeekHarness` with a launch spec, run prompts, and close it so the child process is always reaped.

### Running agent turns with DeepSeekHarness

```ts
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/native'

await using harness = new DeepSeekHarness({
  profile: 'sdk',
  patches: ['./sdk.patch.json'],
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  reasoningEffort: ReasoningEffortId('max'),
  maxTokens: 49_152,
})
const result = await harness.run('say hi')
console.log(result.finalResponse)
```

For a newly created `sdk` profile, `patches` use Native JSON overlays such as `{"formatVersion":1,"installations":[{"id":"app","config":{"systemPrompt":"Follow the project instructions."}}]}`. The CLI uses an existing profile's `package.json` to select Native or Cordis; it does not rewrite existing profiles. To create a Cordis profile explicitly, use a custom name such as `dsh --profile legacy-sdk --from-default-profile sdk`; Cordis source launches require a built CLI because the SDK no longer supplies a source-only Cordis overlay.

The subprocess starts lazily on first use and stays owned by the instance across `run()` calls; call `close()` (or use `await using`) so the child is always reaped. `start()` memoizes the bounded `initialize` handshake, which carries the workspace cwd, provider/model route, optional adapter-owned `reasoningEffort`, and optional positive `maxTokens` output cap. Native SDK also accepts optional `maxSteps`; its handshake must return a positive effective cap no greater than the request. Compatibility Cordis runtimes explicitly reject this Native-only field. The server validates that exact route before it accepts prompts; an omitted effort preserves the model's default. `initializeTimeoutMs` defaults to 30 seconds to leave time for the full profile-ready handshake on a cold startup, and its diagnostic names the selected profile with the retained stderr tail. `run(input, { sessionId?, onNotification? })` accepts text or `SdkPromptContentBlock[]`; an inline raster block carries canonical base64 plus `mimeType` and becomes a durable attachment inside the runtime. The call owns one activity interval: it queues the prompt, waits until its message id appears in a durable inbox receipt, then collects through the next whole-agent `idle`. It returns `RunResult { sessionId, finalResponse, events, notifications }`, where `finalResponse` is the last committed root-session assistant text in that interval — not a response causally assigned to the prompt, because steering, injected context, and other queued work may contribute before idle. `session(id?)` opens a named or fresh session handle. When a failed handshake is cleaned up successfully, the instance installs a fresh client so a later call retries with a new process until terminal `close()`; if initialization and cleanup both fail, `start()` returns an ordered `AggregateError` and retains the failed client instead of spawning beside a process whose exit is unproved. `maxTokens` caps each root-agent request output and is inherited by in-process descendants; compaction plugins own their separate summary limits.

With a Native profile (`native-sdk` or a new standard `sdk` profile), `session(id).uploadFile(bytes, name?)` stores exact file bytes and returns a process-local receipt. Include `{ type: 'file', receiptId }` in `run()` or `steer()` to persist that file at its original position; only Native accepts receipt blocks, and a runtime restart requires re-uploading bytes before use.

### Native Host child transport

`HarnessClientOptions.onApprovalRequest` handles Native approval questions with `(request, signal) => outcome`. Return `allowed-once`, `rejected`, `cancelled`, or `unavailable`; omitting the callback fails closed as `unavailable`. Closing the client or cancelling the parent request aborts the signal. A late callback result is ignored and the runtime replies `cancelled` for that request.

`@deepseek-ai/dsh-sdk-client/native` adds `createNativeDeepSeekHarness(options, childConnection)` for Native Modules. It fixes the profile to `native-sdk` and still resolves the same-version standard `dsh` launcher. Its `NativeDeepSeekHarnessOptions` omits `dshBin`, `profile`, and `patches`; the injected `childConnection` supplies only Host-owned managed stdio and complete-range cleanup, not arbitrary executable or argv selection. The single provider-neutral SDK protocol/runtime implementation is owned by [Engine](../../../../Engine/subagent/sdk-runtime/README.md); this Program facade retains the public TypeScript API and the only standard CLI resolver. The CLI privately owns the fixed launcher used by `native-sdk-dsh-child`.

The opt-in `dsh-sdk-child` Module snapshots the selected provider's configured profile and the actual parent Session's enabled Native Headless builtin file grants. A child receives `write_file` only when the exact parent grant, `approvalRequired`, a workspace-write root, and the `dsh-sdk` driver's callback bound to the live parent owner and turn are all present; without that authority, it cannot gain the writer. Only this relay composition installs Native Approval with `ask` in the private child profile. Its request, cancellation, and one-use decision return to the existing parent approval authority, which remains the sole writer of durable approval events. The child uses the shared sandbox policy and process-sandbox backend; the backend's temporary-directory allowance still applies, and Windows enforcement is partial where reported. The launcher passes the child's resolved cwd and exact private home to `ProcessSandbox.confineChildProcess`, so a workspace-write profile can replace `/tmp` without hiding the provider overlay or exposing sibling temporary paths. The selected cwd remains read-only unless an existing policy grant contains it. The profile is opt-in and leaves standard `native-sdk` unchanged.


### Lower-level control with HarnessClient

`HarnessClient` is the protocol client under the run API: explicit `start()`, `initialize()`, `prompt()`, `request()`, and `close()`, plus notification subscriptions. `prompt()` returns the queued message id as soon as the runtime accepts it and never waits for agent activity. `subscribe(filter?)` returns a `NotificationSubscription` (awaitable `next()`, non-blocking `tryNext()`, async iteration); `subscribeSessionTree(id)` scopes to one session and the descendants discovered from `subagent.started` lineage edges — the selected runtime defines which Sessions are published, and scoping is client-side, exactly like the Python SDK.

The client exports typed errors for every failure mode: `JsonRpcResponseError` (a wire error response, code and data preserved), `RequestTimeoutError` (a configured bound elapsed), `SdkProtocolError` (a response outside the documented protocol), and `TransportClosedError` (the runtime is gone — the message carries the exit code and a bounded stderr tail). `close()` requests protocol `shutdown` and flushes protocol writes (both bounded by `shutdownTimeoutMs`, default 1000 ms), then closes stdin and awaits the shared Provider's managed-range release; a flush failure is retained in diagnostics while cleanup continues. The Provider owns platform-specific TERM/KILL escalation. It is idempotent, and a closed client refuses reuse. `HarnessClientOptions.env` supplies the complete SDK child environment when given (`undefined` snapshots the parent's environment); the SDK explicitly selects replacement semantics rather than Core's default scrubbed overlay. On Windows, the standard launcher adds only the host `SystemRoot` when the supplied environment omits it, as required to start native processes; it does not inherit other parent variables.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design behind the client; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The client is two layers over one wire: `DeepSeekHarness` (owned runs) over `HarnessClient` (the protocol client), mirroring the Python SDK's layering. It runs outside any harness context and uses the framework-free local `dsh-subprocess` connection Provider without mounting NativeHost or Cordis. The selected runtime defines which Sessions are published; session-tree scoping is a client-side filter over `subagent.started` lineage edges.

### Source map

| File | Role |
|---|---|
| [`src/api.ts`](src/api.ts) | Program facade: standard launcher and backward-compatible `DeepSeekHarness` exports |
| [`src/client.ts`](src/client.ts) | Program facade: same-version `dsh` resolution and local-process adapter |
| [`src/native.ts`](src/native.ts) | Native Host SDK facade; the CLI owns its fixed child launcher |
| Engine [`sdk-runtime`](../../../../Engine/subagent/sdk-runtime/README.md) | Single implementation of `HarnessClient`, `DeepSeekHarness`, and the provider-neutral SDK protocol runtime |
| — | No runtime invariant companion is published because this client-process library is not a runtime plugin; its launch and connection lifecycle are covered through the public SDK API. |

### Owned activity flow

A run subscribes to the session tree, queues the prompt, waits until the prompt's message id appears in a durable `agent/inbox/spliced` receipt, then collects notifications until the whole agent reports `idle`. `finalResponse` is derived from the last `assistant/message` in the collected events. Root `subagent/external-operation` events keep their canonical discriminant and payload fields in `RunResult.events` and matching `session.event` notifications. Transport loss, timeout, and protocol violations reject the run; model outcomes remain observable in the event stream without being attributed to one input.

### Errors and teardown

Every failure mode maps to one exported error class — a wire error response, an elapsed request bound, a response outside the documented protocol, or a dead runtime — so callers branch on failure type; the four classes are exported from [src/index.ts](src/index.ts). Teardown uses Core's child-connection disposal and the selected Provider's owned-range observation, after the protocol output barrier and stdin EOF grace.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the client contract is not enough. They move from the wire protocol to the serving plugin and the applications that use this client.

- [SDK wire protocol](../../../../Engine/subagent/sdk-protocol/README.md) — the JSON-RPC methods and payload shapes this client speaks.
- [JSON-RPC serving plugin](../server/README.md) — the runtime plugin that serves this client.
- [Python SDK](../../python/README.md) — the design twin that shares the same runtime peer and protocol.
- [SDK subagent backend](../../../../Compatibility/DSH/subagent/subagent-dsh-sdk/README.md) — a harness-internal consumer of this client.
- [Native SDK server](../native-server/README.md) — the runtime plugin used by a new standard `sdk` profile.
- [SDK application bundle](../../../../Compatibility/DSH/bundle/sdk-app/README.md) — the Cordis application used by legacy profiles.

-----

<a id="model-experience"></a>

With a Native profile (`native-sdk` or a new standard `sdk` profile), `HarnessSession.cancel()` and `HarnessClient.cancel(sessionId)` await cancellation of the admitted turn and return false when none is active. `onNotification` receives live `session.chunk` notifications before the durable assistant event. Compatibility profiles reject this native-only cancellation method.

With a Native profile (`native-sdk` or a new standard `sdk` profile), `run` also accepts encoded raster image blocks (`{ type: "image", data, mimeType }`) alongside text; the native attachment Provider owns validation and durable storage.

`HarnessSession.steer(input)` and `HarnessClient.steer(sessionId, contentBlocks)` durably queue next-step input on the active native-sdk root. They return a message id without waiting for a model answer or cancelling the current dispatch. A steer wakes a root parked after a turn interruption, while Goal work remains disarmed until explicitly rearmed; idle or unknown Sessions and compatibility profiles reject.

`HarnessSession.fork(destinationSessionId, atSeq?)` returns a fresh native-sdk handle whose next run resumes copied history; `HarnessClient.fork` exposes the wire receipt. The [native server reference](../native-server/README.md#configuration) owns source, workspace and closed-turn admission.

## Model Experience

None, as this is a client-process library; model-facing behavior lives in the spawned runtime's composed plugins.

#### KV Cache effect

None in the client process. Profile, patch, provider, model, and history choices determine cache reuse in the child.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the client is a poor fit or needs special care. They are current package constraints, not a comparison with other SDK clients or a task backlog.

- **No bundled-runtime resolution** — the client resolves the same-version `@deepseek-ai/dsh` package (or a caller-provided `dshBin`); packaged-executable discovery stays Python-side until a TypeScript distribution consumer exists.
- **Compatibility-profile cancellation** — compatibility profiles have no prompt-cancel method; abandoning their turn means closing the runtime (see the [protocol limitations](../../../../Engine/subagent/sdk-protocol/README.md#known-limitations-and-deferred-work)).
- **No per-prompt result** — low-level `prompt()` returns only an enqueue receipt; high-level `run()` owns receipt-to-idle collection.
- **No general server-initiated request API** — the only mapped request is Native `approval/request`, used by an explicitly bound SDK child approval relay; standard `native-sdk` does not install that relay.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the code. The launch spec is intentionally fully explicit: no bundled-runtime resolution is planned for TypeScript until a distribution consumer exists. Keep the dispose ladder and the error vocabulary in sync with the Python client, which drives the same runtime. No other unresolved design questions are recorded.

</details>
