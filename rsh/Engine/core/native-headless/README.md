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

The `./native` entry requires an absolute existing directory in `cwd`, nonempty `provider`, `model`, and `systemPrompt` strings, and an optional positive `maxSteps` (default `4`). Unknown fields fail profile activation. The application accepts a prompt or `--resume <session-id> [prompt]`; each invocation owns one turn. Resume refuses a changed workspace or system prompt rather than silently sending history from another profile. Its fixed schema exposes `read_file` and `write_file`. Optional `tools` and `promptSections` services add reversible schemas and system text, while optional `sandboxPolicy` supplies the current Session policy to fixed writes. Writes use the filesystem observation policy, and paths outside `cwd` fail with `FS_SANDBOX_DENIED`.

The application flushes the Session JSONL log after each model-visible input, assistant response, and tool outcome. On interruption it records partial assistant output and repairs any outstanding tool result before closing the turn. The model Provider must supply the native `model` service and the streaming protocol from `dsh-llm`.

## Dev Note

No invariant companion is published: the application has no independent in-process observation of its own state. Session persistence and filesystem Providers retain their own validation.

## Model Experience

### System prompt

#### What the model sees

The model receives the configured `systemPrompt` followed by registered prompt sections before the user message.

##### Profile prompt

```markdown
<configured systemPrompt>
```

#### Token effect

System text is sent on each step, and retained messages add request tokens on later steps and resume.

#### KV Cache effect

An unchanged prompt prefix can reuse a provider cache; a changed configuration or prompt section changes it from its first differing token.

### Tool operations

#### What the model sees

The model receives fixed `read_file` and `write_file` schemas plus every schema in the optional `tools` registry. File content, fixed-tool errors, and registered-tool results become one tool-result message before the next request.

#### Token effect

Schemas are sent on each step and tool results remain in later-step and resumed requests.

#### KV Cache effect

Adding, removing, or changing an operation schema changes the request prefix from its first differing token.

## Known Limitations and Deferred Work

- Fixed file tools and registered tools run serially; approval, SDK protocol, and Web UI remain absent.
- Native model Providers and broader capability adapters live in separate packages.
- Session and persistence packages still carry Cordis dependencies, although this composition creates no Cordis Context.
