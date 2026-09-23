---
description: "Native Agent-owned background job registry with cooperative cancellation and drain."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-jobs

English | [中文](README.zh.md)

## Summary

`dsh-native-jobs` provides a native `jobs` registry for work owned by one exact live Agent. It assigns kind-prefixed ids, fences reads and cancellation to that same Agent object, records final status and output, and drains cooperative runners during Host teardown or manual Agent release. It does not decide which job facts become model-visible or durable Session events.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The `./native` entry requires `agents`, provides `jobs`, and accepts `maxConcurrentPerAgent`, a positive safe-integer ceiling whose default is `10`. `start()` validates the exact registered Agent, a lowercase-hyphenated kind, and a nonempty label before it invokes the runner. A runner gets one `AbortSignal`; a synchronous throw or rejected promise becomes a failed terminal record, while an expected operational failure resolves an explicit terminal outcome.

`cancel()` moves a live record to `stopping` and aborts the runner; its eventual outcome remains authoritative. `read()` returns final output only after settlement. `wait()` uses the caller-supplied timeout and optional cancellation signal; cancelling a wait leaves the job running. `dispose()` stops admission, aborts live runners, then waits for their cooperative completion. When the owner begins release, the registry aborts and drains all of that Agent's live runners before the Agent publishes disposal. Each public read, wait, and cancellation requires the original registered available Agent instance, so an unregistered, releasing, or replacement object cannot inspect an earlier owner's jobs.

<a id="model-experience"></a>
## Model Experience

None, as native job state and final output remain inside the registry until an application chooses a model-facing projection.

#### KV Cache effect

Native job lifecycle and retained output add no model request content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Runners must cooperate with cancellation; the registry has no process-kill or worker-termination authority.
- The registry has no Session writer, tool schema, browser projection, or remote controller; [native-tool-jobs](../../jobs/native-tool-jobs/README.md) contributes model-facing controls separately.
- Native shell, subagent, and workflow providers will choose their own output retention and Session projection while adopting this ownership fence.

No invariant companion is published because job state has no independent durable observation before an application records it.

<a id="dev-note"></a>
### Dev Note

None.
