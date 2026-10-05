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

The profile sets `provider`, `model`, `systemPrompt`, and positive `maxSteps`. Each Session selects an absolute existing workspace directory through `session/new`; each accepts one text prompt at a time. An overlapping prompt fails explicitly. Empty Sessions are durable before creation returns. Resume checks the stored workspace and lineage and replays committed presentation events before accepting further prompts. Close releases the live executor and retains the stored log. Input EOF and Host cancellation cancel and drain accepted work; ACP has no standard shutdown request.

The shipped native composition installs the model adapter, native Agent and model execution, local filesystem, credentials, and Session persistence. Additional native tools may be installed through profile patches. Only the exact execution cancellation reason becomes a cancelled response; cleanup and unrelated execution failures remain protocol errors.

## Dev Note

The [native ACP decision](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-acp-session-carrier.md) explains protocol and execution ownership. No invariant entry is published because this carrier owns no independent Agent or Session state projection that can diverge from the executor.

## Model Experience

### ACP text prompts

#### What the model sees

Text admitted by `session/prompt` enters the durable Session inbox and reaches the model through the [native Session executor](../../../../Engine/core/native-headless/README.md#model-experience). ACP presentation notifications add no model input.

#### Token effect

Submitted text adds input tokens on its admitted step and later steps that retain it.

#### KV Cache effect

A submitted prompt appends user text after retained history; preceding request content retains its order.

## Known Limitations and Deferred Work

- Per-session MCP mounts, image/audio/embedded input, model configuration controls, permission/question requests, and attachment presentation are outside this carrier slice; unsupported prompt content and MCP declarations fail explicitly. Initialization advertises text-only prompts and no HTTP MCP support. Existing ACP clients requiring these capabilities use the compatibility profile until native parity is implemented.
