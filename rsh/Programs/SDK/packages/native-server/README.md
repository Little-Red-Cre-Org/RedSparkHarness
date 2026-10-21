---
description: "Native SDK JSON-RPC application over the shared Session executor."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-sdk-server

English | [中文](README.zh.md)

## Summary

The explicit `dsh --profile native-sdk` application serves the existing newline-delimited SDK JSON-RPC methods `initialize`, `session/prompt`, `session/cancel`, `session/steer`, `session/fork`, and `shutdown` over stdio. It uses one native Session executor for identified sessions, sends persisted `session.event` notifications and whole-session `session.status` transitions, and aborts and drains model initialization and accepted turns on shutdown or input EOF. TypeScript and Python clients retain `sdk` as their default profile; callers select `native-sdk` explicitly.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Configuration

The profile sets `systemPrompt` and positive `maxSteps`. `initialize` selects one workspace directory, provider, model, optional reasoning effort, and optional output-token cap for this process. Each session id runs one turn at a time; later prompts resume that Session's durable log, including after a process restart. `session/prompt` returns its message id only after the inbox receipt is durable; failures before that point return a JSON-RPC error to both SDK clients.

The native route also emits `session.chunk` for accepted model chunks and serves `session/cancel`. Cancellation targets only the currently admitted turn, returns false before a durable receipt or after settlement, and awaits owned cleanup before replying. Cleanup failures reject the cancellation request. Queued prompts and other Sessions remain admitted independently. Chunks project the selected dispatch; `assistant/message` or `assistant/attempt` remains their durable owner. Same-id prompts restore stored history.

`session/fork` copies the source history through a closed turn into a fresh destination, without invoking a model. Its optional `atSeq` selects an existing event in that closed turn; omission selects the last closed turn. Source history remains unchanged, and the next destination prompt resumes the durable copy. Root execution requires the Session-execution and active-owner Providers. The selected Subagent Provider is optional for minimal assemblies and enables `subagent.finished` projection when installed; the shipped native-sdk profile installs it.

`session/prompt` accepts ordered text blocks and encoded raster images (`{ type: "image", data, mimeType }`). The required attachment Provider validates canonical base64, declared media type, decoded bytes and deployment limits before the durable inbox receipt. The Session stores immutable references; the selected model adapter reads verified request variants, including after restart or fork. Caller-supplied durable attachment references are refused. The selected model must support image input.

`session/steer` queues ordered prompt content for the admitted root's next step through its exact active Session owner. It returns the message id after persistence and does not interrupt the current model dispatch. A steer also wakes that root's ordinary driver when a turn interruption has parked it; Goal admission remains disarmed until the Goal driver explicitly rearms it. Unknown, idle, cancelled and foreign Program owners are refused. Accepted input remains pending when cancellation or natural turn completion occurs before another step; the next resumed turn claims it. Steering shares image admission with ordinary prompts.

The application declares the shared executor's optional `modelSelection` service; compositions may install that Provider without a separate SDK model registry.

The application provides `rootExecution` as the same executor selected by `initialize`. Its `ready(signal)` waits for successful initialization and rejects when initialization fails, its caller cancels, or the SDK closes; other root operations are available only after readiness. This lets installed Providers use the SDK Program's selected route without creating another executor or adding an SDK wire method. The [root-execution decision](../../../../../.agents/notes/implemented/architecture/2026-10-07-native-sdk-provides-its-root-executor.md) records this ownership.

Delegated children of this Program's admitted root emit `subagent.started` lineage before their backend-accepted `session.event` notifications. The selected native Subagent Provider reports `subagent.finished` only after a real one-shot result or continuable residency epoch has settled and released its writer; interrupting a turn alone does not finish a still-resident child. The server matches that result to the exact child and parent Agents accepted under this SDK root; detachment alone never reports success. Both SDKs' `subscribeSessionTree` and run subscriptions include these descendants, while root response events remain separate. Other Programs sharing the same Providers are excluded. Shutdown drains accepted descendants, emits their settled results and flushes the transport before releasing observers.

## Dev Note

The [native SDK decision](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-sdk-session-execution.md) records the process and Session ownership choice.

No runtime invariant companion is published because the per-Session request tails and active-turn admissions only serialize transport calls and scope notifications; the native executor remains authoritative for Agent identity and durable Session state, and this server keeps no second Session projection.

## Model Experience

### SDK prompts

#### What the model sees

Text and admitted image references in `contentBlocks` enter the durable Session inbox and reaches the model through the [native Session executor](../../../../Engine/core/native-headless/README.md#model-experience). JSON-RPC status notifications add no model input.

#### Token effect

Submitted text and images add input tokens on their admitted step and later steps that retain them.

#### KV Cache effect

A submitted prompt appends user content after retained history; preceding request content retains its order.

## Known Limitations and Deferred Work

- Native SDK result notifications cover the selected in-process Subagent Provider. External or remote child backends are not projected as `subagent.finished`.
- SDK wire catalog discovery remains unsupported. The model-visible `list_agents` tool in the shipped profile is a separate capability.
