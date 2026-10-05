---
description: "Native model-facing controls for Agent-owned background jobs."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-tool-jobs

English | [中文](README.zh.md)

## Summary

`dsh-native-tool-jobs` registers `job_output`, `job_list`, and `job_kill` on a selected native tool registry. It reads and cancels work from the selected native job registry under the exact initiating Agent. The consuming application appends each call and result to its Session; this package does not create a second Agent, job, or Session authority.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The `./native` entry requires `jobs` and `tools`, and provides no service. It accepts `waitTimeoutMs` (default `30000`) and `maxWaitTimeoutMs` (default `600000`) as positive finite timer delays. The default must not exceed the cap. `maxOutputBytes` (default `16384`, minimum `128`) bounds each model-visible text result. Removing this installation unregisters only its three tool contributions.

`job_output` reads final output and the current status. With `wait: true`, it waits for a terminal outcome or the configured timeout; the request may supply `timeout_ms`, capped by `maxWaitTimeoutMs`. An aborted tool invocation stops waiting without cancelling the job. `job_kill` requests cooperative cancellation and returns before the runner settles. Every operation is fenced to the exact live Agent that owns the job.

The controls register canonical value tools. Program consumers receive the bounded model text plus serializable job summaries and, for cancellation, its outcome; summaries omit the live Agent object. Model presentations retain the same text, and the authoritative Session records the selected result once through the native registry.

<a id="model-experience"></a>
## Model Experience

### Tool operations

#### What the model sees

The model receives the `job_output`, `job_list`, and `job_kill` schemas. `job_output` returns the final output when available and a status line; `job_list` returns owned job ids, kinds, statuses, and labels; `job_kill` reports whether cancellation was requested or the job had already finished. The application logs the result once before the next model request.

#### Token effect

The three schemas add request tokens on each model step. Tool results remain in later requests and resumed history.

#### KV Cache effect

Installing or removing the contribution changes the tool-schema prefix. Job state changes alone do not alter that prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The native registry retains final output; it has no incremental stream reader. An active job therefore returns `(no output yet)`.
- Truncated output includes an omission marker; `job_output` preserves its status line within the byte budget.
- An Agent's jobs are cancelled and drained on Agent release. The one-shot native headless application releases its Agent at each turn end, so jobs cannot continue across separate CLI invocations.
- Native shell, subagent, and workflow producers must register their own runners; this package only exposes controls.

No invariant companion is published because this package retains no state independent of the job and tool registries.

<a id="dev-note"></a>
### Dev Note

None.
