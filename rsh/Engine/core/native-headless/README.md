---
description: "Native one-shot headless agent for explicit filesystem and durable Session profiles."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-headless

English | [中文](README.zh.md)

## Summary

`dsh-native-headless` supplies one application to a native `dsh --profile` composition. It sends a user prompt to a selected model, executes workspace-confined UTF-8 file reads and writes, records model-visible messages and tool results in a released Session log, and closes storage before exit. A native profile must also install filesystem, observation-policy, Session-persistence, and model Providers.

## Table of Contents

- [Configuration](#configuration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Configuration

The `./native` entry requires an absolute existing directory in `cwd`, nonempty `provider`, `model`, and `systemPrompt` strings, and an optional positive `maxSteps` (default `4`). Unknown fields fail profile activation. The application accepts a prompt or `--resume <session-id> [prompt]`; each invocation owns one turn. Resume refuses a changed workspace or system prompt rather than silently sending history from another profile. Its tool schema exposes `read_file` and `write_file`. Writes use the filesystem observation policy, and paths outside `cwd` fail with `FS_SANDBOX_DENIED`.

The application flushes the Session JSONL log after each model-visible input, assistant response, and tool outcome. On interruption it records partial assistant output and repairs any outstanding tool result before closing the turn. The model Provider must supply the native `model` service and the streaming protocol from `dsh-llm`.

## Dev Note

No invariant companion is published: the application has no independent in-process observation of its own state. Session persistence and filesystem Providers retain their own validation.

## Model Experience

### File-tool request

#### What the model sees

The model receives the configured system prompt, user message, prior Session messages on resume, and the `read_file` and `write_file` schemas. File content and errors become tool-result messages before the next model request. A completed text response is printed to standard output.

#### Token effect

System text and tool schemas are sent on each step; retained messages and file-tool results add request tokens on later steps and resume.

#### KV Cache effect

An unchanged system prompt, schema list, and message prefix can reuse a provider cache. A changed config or additional earlier message changes the prefix from its first differing token.

## Known Limitations and Deferred Work

- Only two file tools are available, and tool calls run serially; the general tool registry, approval system, SDK protocol, and Web UI are absent.
- Native model Providers and broader capability adapters live in separate packages.
- Session and persistence packages still carry Cordis dependencies, although this composition creates no Cordis Context.
