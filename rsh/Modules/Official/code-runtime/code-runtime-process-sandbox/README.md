---
description: "Run model-written TypeScript through a native process sandbox with bounded execution and managed cleanup."
kind: "package-reference"
---

# @deepseek-ai/dsh-code-runtime-process-sandbox

English | [中文](README.zh.md)

Binding arguments and resolutions use lossless JSON without a transport byte ceiling. `maxOutputBytes` bounds the program’s final value, logs and captured stderr; it does not truncate intermediate business values.

## Summary

Use this provider when a native Host profile permits `run_code` under `read-only` or `workspace-write` file policy. Each program runs in a fresh managed process wrapped by the selected OS sandbox, and declared binding calls return through a JSON line protocol. Runner startup failure stops the call without an unconfined retry. The selected sandbox backend reports whether its file-effect enforcement is full or partial.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Select the Host `./native` entry beside `dsh-subprocess-local`, `dsh-sandbox-local`, and `dsh-native-sandbox-policy` in an explicitly native `dsh` profile. Its application and sandbox policy must use the same workspace root. This package does not change the default application profile. Its optional `computeMs`, `maxWallMs`, `maxOutputBytes`, and `maxOldGenerationSizeMb` settings use the validated defaults documented by [the code-runtime definition](../native-code-runtime/README.md#configuration).

An unavailable runner fails with `SANDBOX_UNAVAILABLE`. A program exception, time budget, abort, invalid JSON value, or output cap returns a structured `run_code` failure; Host shutdown terminates the managed process range before completing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider asks `ProcessSandbox.confine()` to wrap the exact Node child command and starts it through `SubprocessOperations`. The child uses the native worker-thread runtime to preserve TypeScript parsing, compute metering, output limits, and hard worker cancellation. JSON lines carry the program, declared binding calls, replies, and one result; the parent validates child frames and resolves only declared host functions. The subprocess service owns process-range termination and quiescence. See [the provider](src/index.ts), [the private child](../native-code-runtime/src/process-child.ts), and [the sandbox definition](../../sandbox/sandbox/src/native.ts).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Native code runtime](../native-code-runtime/README.md) — program and result semantics.
- [Native headless application](../../../../Engine/core/native-headless/README.md) — `run_code` Session projection.
- [Local sandbox](../../sandbox/sandbox-local/README.md) — OS enforcement and runner diagnostics.
- [Subprocess operations](../../../../Core/subprocess/subprocess/README.md) — managed process lifetime.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through a consuming application that adds `run_code` to a model request and records its result in the Session; this provider adds no prompt or Session event itself.

#### KV Cache effect

The provider itself adds no request content. The consuming application's `run_code` schema may change the request prefix when the provider is installed.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- File policy covers file effects only; network and process visibility remain outside the sandbox vocabulary.
- The Windows ACL backend reports partial file-effect enforcement, including its documented external Everyone grants and hard-link limits. This provider does not turn that report into a claim of full isolation.
- TypeScript support remains erasable-only. The alternative worker-thread provider is suitable only for a profile that explicitly permits unconfined code execution.

No invariant companion is published because the child protocol has no independent durable observation before the application records the result.

<a id="dev-note"></a>
### Dev Note

None.
