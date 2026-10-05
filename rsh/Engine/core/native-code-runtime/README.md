---
description: "Framework-free worker-thread execution of model-written TypeScript for native Host profiles."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-code-runtime

English | [中文](README.zh.md)

## Summary

`dsh-native-code-runtime` provides a native Host `codeRuntime` service that runs one model-written TypeScript program in a fresh Node worker. It accepts explicit host bindings, returns ordered logs plus a lossless JSON completion value or structured failure, and owns worker disposal through the native profile lifecycle. It imports no Cordis service or scope. The existing Cordis worker-thread backend remains active for Cordis profiles until the default-assembly phase.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The `./native` entry provides `codeRuntime` and accepts an optional object with four validated limits: `computeMs` defaults to `60,000` measured worker busy milliseconds, `maxWallMs` defaults to `600,000` milliseconds, `maxOutputBytes` defaults to `67,108,864` serialized bytes, and `maxOldGenerationSizeMb` defaults to `512` MiB. Unknown fields, non-positive finite numbers, output caps below `4`, and a wall limit beyond Node's timer range fail during profile resolution.

Each `run()` type-strips erasable TypeScript, starts a fresh worker with an empty environment, and bridges declared binding calls through lossless JSON. The result resolves with `exception`, `timeout`, `abort`, `worker-exit`, `invalid-output`, or `output-limit` where a program cannot complete. Calling after `dispose()` or providing invalid binding namespaces rejects as caller misuse. Host shutdown disposes the service, terminates each live worker, and waits for its exit.

`nativeCodeRuntimeChildPath()` resolves the private child used by process-confined Providers. The child delegates TypeScript execution and binding serialization to this package’s worker implementation; it is not an application launcher or a public package bin. The process Provider owns OS confinement and complete process-range termination.

The caller may provide `CodeRunRequest.onStop` to cancel its own binding calls when program execution stops. Providers notify before awaiting binding replies; the caller still owns their completion and failures.

<a id="model-experience"></a>
## Model Experience

Indirectly, through a native application that renders a code result and records it in its own Session events; the runtime itself has no tool schema, prompt placement, or Session writer.

#### KV Cache effect

The runtime alone adds no model request content; its consuming application owns any request-prefix change.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Worker termination is containment, not a security boundary: model code has bash-equivalent authority and OS processes it spawns can outlive the worker.
- The worker has a five-method console shim and supports erasable TypeScript only; non-erasable syntax such as `enum` resolves as an `exception`.
- Binding values are lossless JSON but have no independent byte cap before they become part of the bounded outer result.
- This provider deliberately does not adapt the Cordis code-runtime seam or select a profile default; P5 owns default switching after migrated native consumers exist.

No invariant companion is published because worker protocol messages and process-local execution state have no independent durable observation before an application records a result.

<a id="dev-note"></a>
### Dev Note

None.
