---
description: "Native SDK JSON-RPC application over the shared Session executor."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-sdk-server

English | [中文](README.zh.md)

## Summary

The explicit `dsh --profile native-sdk` application serves the existing newline-delimited SDK JSON-RPC methods `initialize`, `session/prompt`, and `shutdown` over stdio. It uses one native Session executor for identified sessions, sends persisted `session.event` notifications and whole-session `session.status` transitions, and drains accepted work on shutdown or input EOF. TypeScript and Python clients retain `sdk` as their default profile; callers select `native-sdk` explicitly.

## Configuration

The profile sets `systemPrompt` and positive `maxSteps`. `initialize` selects one workspace directory, provider, model, optional reasoning effort, and optional output-token cap for this process. Each session id runs one turn at a time; later prompts resume that Session's durable log, including after a process restart. `session/prompt` returns its message id only after the inbox receipt is durable; failures before that point return a JSON-RPC error to both SDK clients. This initial native SDK route accepts nonempty text content blocks only; inline image input and subagent notifications remain on the compatibility SDK profile.

## Dev Note

The [native SDK decision](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-sdk-session-execution.md) records the process and Session ownership choice.
