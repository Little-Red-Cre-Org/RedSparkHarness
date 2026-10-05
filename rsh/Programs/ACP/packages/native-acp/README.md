---
description: "Drive durable native Sessions through the standard ACP protocol."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-acp

English | [中文](README.zh.md)

## Summary

Select `dsh --profile native-acp` to create, prompt, cancel, close, list, and resume durable Sessions over standard ACP JSON-RPC stdio. Committed assistant text, reasoning, and registered tool lifecycle facts become ordered `session/update` notifications. The compatibility `acp` profile remains the default ACP composition.

## Table of Contents

- [Configuration](#configuration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Configuration

The profile sets `provider`, `model`, `systemPrompt`, and positive `maxSteps`. Each Session selects an absolute existing workspace directory through `session/new`; each accepts one ordered text/image prompt at a time. An overlapping prompt fails explicitly. Empty Sessions are durable before creation returns. Resume checks the stored workspace and lineage and replays committed presentation events before accepting further prompts. Close releases the live executor and retains the stored log. Input EOF and Host cancellation cancel and drain accepted work; ACP has no standard shutdown request.

The shipped native composition installs the model adapter, native Agent and model execution, local filesystem, credentials, and Session persistence. Additional native tools may be installed through profile patches. Only the exact execution cancellation reason becomes a cancelled response; cleanup and unrelated execution failures remain protocol errors.

The application declares the shared executor’s optional `modelSelection` service and consumes its Host compiler face.

New and resumed Sessions return standard `configOptions` from the selected model directory. `session/set_config_option` accepts advertised opaque model values and declared reasoning efforts, persists the complete choice through exclusive Session maintenance, and sends `config_option_update`. Requests received during a prompt wait for its settlement and apply to the next turn; another prompt is refused while configuration is pending. Caller cancellation interrupts queued discovery and mutations; close and EOF cancel and drain accepted controls. Missing directory or selection Providers yield no options and reject mutations. Catalog absence does not erase the current recorded route.

Image prompts require the selected attachment Provider and model directory. Initialization advertises image admission only when both are installed; each image prompt checks the Session's next selected model and prepares attachments within the same root execution admission, rejecting models without declared image input. The attachment Provider validates configured raster formats, base64, byte and pixel limits, normalizes the batch, and returns durable references in input order before user-message admission. Invalid images never enter the Session inbox. Cancellation and transport drain also cover image preparation.

The shipped approval Provider routes exact owned root tool calls to standard `session/request_permission` after their committed tool update. Only `allow-once` grants execution; rejection, unknown choices and cancellation fail closed. The executor records each asked/decided pair. Each Session permits one unsettled permission wire request across close and resume; positive `maxPendingPermissions` bounds the whole connection (default `32`). Further requests at capacity return an unavailable decision. Cancellation sends cooperative wire cancellation and settles the Session audit without awaiting a peer that ignores cancellation. Its old wire request remains connection-owned until the peer replies or EOF closes the connection; a late reply cannot grant execution. Connection shutdown rejects and drains these requests before releasing Providers.

Standard stdio and Streamable HTTP MCP declarations are accepted by `session/new` and `session/resume` when native tools are installed. Each Session owns its transport connections and tool scope; sibling Sessions can reuse server names with isolated tools. ACP controllers authorize absolute commands with arguments, environment and Session cwd, or HTTP(S) URLs with headers. The complete list is validated and initial connection/discovery succeeds before the Session is published. Failed startup releases only that pending composition; close and EOF stop tool admission and cooperatively drain the executor and connections. MCP withdrawal begins with cancellation. A failed close retains the closed Session record and rejects resume, prompts and configuration changes; only successful cleanup removes that record. `mcpToolCallTimeoutMs` is a positive timer-sized integer (default `60000`). MCP diagnostics use stderr, preserving protocol stdout. MCP resources and prompts are not exposed; unsupported transports are rejected.

## Dev Note

The [native ACP decision](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-acp-session-carrier.md) explains protocol and execution ownership. No runtime invariant companion is published because the ACP session table pairs each protocol session with its executor and MCP resources, while the executor owns Agent execution and durable Session state; ACP records hold transport and resource lifecycle plus transient controls, not a second Session projection.

## Model Experience

### ACP text and image prompts

#### What the model sees

Text, resource-link references and normalized image references admitted by `session/prompt` enter the durable Session inbox and reach the model through the [native Session executor](../../../../Engine/core/native-headless/README.md#model-experience). Resource links use the compatibility carrier's bracketed text with JSON-quoted name and URI; adjacent text concatenates without fetching the resource, preserving text/image order. Durable model choices affect subsequent request assembly through the selected Provider; protocol configuration notifications add no model input.

#### Token effect

Submitted text and model image previews add input tokens on their admitted step and later steps that retain them.

#### KV Cache effect

A submitted prompt appends user content after retained history; preceding request content retains its order.

## Known Limitations and Deferred Work

- Audio/embedded input, question requests, and attachment presentation are outside this carrier slice; unsupported prompt content fails explicitly. Initialization advertises no audio or embedded-context support. Existing ACP clients requiring these capabilities use the compatibility profile until native parity is implemented.
