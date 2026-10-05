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

Image prompts require the selected attachment Provider and model directory. Initialization advertises image admission only when both are installed; each image prompt checks the Session's next selected model under idle Agent maintenance and rejects models without declared image input. The attachment Provider validates configured raster formats, base64, byte and pixel limits, normalizes the batch, and returns durable references in input order before user-message admission. Invalid images never enter the Session inbox. Cancellation and transport drain also cover image preparation.

## Dev Note

The [native ACP decision](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-acp-session-carrier.md) explains protocol and execution ownership. No invariant entry is published because this carrier owns no independent Agent or Session state projection that can diverge from the executor.

## Model Experience

### ACP text and image prompts

#### What the model sees

Text and normalized image references admitted by `session/prompt` enter the durable Session inbox and reach the model through the [native Session executor](../../../../Engine/core/native-headless/README.md#model-experience). Durable model choices affect subsequent request assembly through the selected Provider; protocol configuration notifications add no model input.

#### Token effect

Submitted text and model image previews add input tokens on their admitted step and later steps that retain them.

#### KV Cache effect

A submitted prompt appends user content after retained history; preceding request content retains its order.

## Known Limitations and Deferred Work

- Per-session MCP mounts, audio/embedded input, permission/question requests, and attachment presentation are outside this carrier slice; unsupported prompt content and MCP declarations fail explicitly. Initialization advertises no audio, embedded context or HTTP MCP support. Existing ACP clients requiring these capabilities use the compatibility profile until native parity is implemented.
