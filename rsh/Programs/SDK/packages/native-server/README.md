---
description: "Native SDK JSON-RPC application over the shared Session executor."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-sdk-server

English | [中文](README.zh.md)

## Summary

The explicit `dsh --profile native-sdk` application serves the existing newline-delimited SDK JSON-RPC methods `initialize`, `session/prompt`, `session/cancel`, `session/fork`, and `shutdown` over stdio. It uses one native Session executor for identified sessions, sends persisted `session.event` notifications and whole-session `session.status` transitions, and aborts and drains model initialization and accepted turns on shutdown or input EOF. TypeScript and Python clients retain `sdk` as their default profile; callers select `native-sdk` explicitly.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Configuration

The profile sets `systemPrompt` and positive `maxSteps`. `initialize` selects one workspace directory, provider, model, optional reasoning effort, and optional output-token cap for this process. Each session id runs one turn at a time; later prompts resume that Session's durable log, including after a process restart. `session/prompt` returns its message id only after the inbox receipt is durable; failures before that point return a JSON-RPC error to both SDK clients.

The native route also emits `session.chunk` for accepted model chunks and serves `session/cancel`. Cancellation targets only the currently admitted turn, returns false before a durable receipt or after settlement, and awaits owned cleanup before replying. Cleanup failures reject the cancellation request. Queued prompts and other Sessions remain admitted independently. Chunks project the selected dispatch; `assistant/message` or `assistant/attempt` remains their durable owner. Same-id prompts restore stored history.

`session/fork` copies the source history through a closed turn into a fresh destination, without invoking a model. Its optional `atSeq` selects an existing event in that closed turn; omission selects the last closed turn. Source history remains unchanged, and the next destination prompt resumes the durable copy. The shipped native-sdk profile installs the Session-execution Provider; the application requires its execution and active-owner services explicitly.

`session/prompt` accepts ordered text blocks and encoded raster images (`{ type: "image", data, mimeType }`). The required attachment Provider validates canonical base64, declared media type, decoded bytes and deployment limits before the durable inbox receipt. The Session stores immutable references; the selected model adapter reads verified request variants, including after restart or fork. Caller-supplied durable attachment references are refused. The selected model must support image input.

The application declares the shared executor's optional `modelSelection` service; compositions may install that Provider without a separate SDK model registry.

## Dev Note

The [native SDK decision](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-sdk-session-execution.md) records the process and Session ownership choice.

## Model Experience

### SDK prompts

#### What the model sees

Text and admitted image references in `contentBlocks` enter the durable Session inbox and reaches the model through the [native Session executor](../../../../Engine/core/native-headless/README.md#model-experience). JSON-RPC status notifications add no model input.

#### Token effect

Submitted text and images add input tokens on their admitted step and later steps that retain them.

#### KV Cache effect

A submitted prompt appends user content after retained history; preceding request content retains its order.

## Known Limitations and Deferred Work

- Subagent notifications remain on the compatibility SDK profile.
