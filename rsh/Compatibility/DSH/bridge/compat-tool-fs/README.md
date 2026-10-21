---
description: "Native headless profiles can expose selected legacy filesystem tools and prompt guidance through reversible native registries."
kind: "package-reference"
---

# @deepseek-ai/dsh-compat-tool-fs

English | [中文](README.zh.md)

## Summary

`dsh-compat-tool-fs` adapts the legacy read, write, and edit tools into native tool and prompt registries. The native application remains the sole owner of model requests and durable `tool/call` and `tool/result` records. Loader entry mutations withdraw Native tools and prompt sections, drain admitted tool calls and in-flight prompt assembly, then rebuild them from the enabled entries. Disabling or removing the selected legacy observation policy also withdraws these contributions. The bridge forwards filesystem decisions into Native events and uses the compatibility runtime's exact synchronous echo guard for `fs/observed`.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The bridge accepts only the positive integer limits supported by `dsh-tool-fs`: `readLimit`, `readMaxLineLength`, `readMaxBytes`, and `readStreamMinSize`. The compatibility runtime validates the installed package against its [support matrix](../compat-dsh-runtime/README.md#supported-adapter-set). Updating entry configuration drains tool calls and prompt assembly before replacing registered schemas and prompt text; disable and removal withdraw them, and enable restores them only while the selected policy and required Cordis services remain available. A profile must provide `fs`, `tools`, and `promptSections`; the optional `fsObservationPolicy` service establishes startup order when a policy provider is selected. When the filesystem has a sandbox mode and `sandboxPolicy` is present, legacy writes and edits receive the current Session policy.

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

The model receives the selected filesystem guidance appended to the application's system prompt.

##### Filesystem guidance

```markdown
Use the read tool to inspect a file before changing it.
```

#### Token effect

The guidance is sent on every request and remains in the request prefix.

#### KV Cache effect

Adding or removing this bridge changes the system-message prefix from its first differing token.

### Filesystem operations

#### What the model sees

The model receives selected legacy `read`, `write`, and `edit` schemas. Executions return legacy result content to the native application, which records one durable result before the next model request.

#### Token effect

The schemas are sent on every request and each tool result remains in later requests.

#### KV Cache effect

Changing selected operations changes the request prefix from its first differing token.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This bridge supports only the selected filesystem tools and their prompt sections.
- It does not load a legacy Agent loop, Session store, base bundle, or arbitrary legacy tool package.

No invariant companion is published because the native application owns the only durable tool-result observation.

<a id="dev-note"></a>
### Dev Note

None.
