# Agent Note: Native job tool controls

Status: implemented

English | [中文](2026-09-23-native-job-tool-controls.zh.md)

## Problem

The native job registry could own and drain background work, but the native application had no selected model-facing controls for reading or cancelling that work. Reusing Cordis `tool-jobs` would require its Agent, tool and Session authorities inside the native profile. A wait also lacked caller cancellation, so Host shutdown could remain blocked until a long job-output timeout elapsed.

## Decision

`@deepseek-ai/dsh-native-tool-jobs` contributes `job_output`, `job_list` and `job_kill` to the selected native tool registry. The tools use the exact Agent supplied by the application and the selected native job registry; the application records calls and outcomes in its single Session log. No job is started by this package. Removing the installation unregisters only these contributions.

The job registry's `wait()` accepts a caller signal. Aborting that signal rejects the wait and removes its timer and listener without cancelling the underlying job. `job_output` applies a validated default and maximum timeout and passes the tool invocation's signal. Each model-visible result has a configured UTF-8 byte cap; truncated output retains an omission marker and job status. `job_kill` requests cancellation and reports the request; the runner's settled outcome remains authoritative.

## Alternatives considered

**Copy the legacy `tool-jobs` implementation:** It depends on Cordis `ctx.tools`, legacy Agent ownership and completion inbox delivery, creating two authorities in one native profile.

**Put job tools inside the headless loop:** That would make one application own a generic jobs capability and prevent other native applications from selecting the same controls.

**Cancel the job when a read wait aborts:** A caller may stop waiting while independent work remains useful. Job cancellation has its own explicit operation.

## Consequences

The native headless profile now installs the job registry and tool controls; its model can call the three tools. Jobs remain Agent-owned and are cancelled and drained when the one-shot application releases its Agent at turn end. Native shell, subagent and workflow producers still need their own runnable integrations. The native registry retains only final output, so `job_output` is not an incremental stream reader and completion notices are not yet delivered to an idle Agent.

## Verification

Native Host tests cover registration and release, owner isolation, list/read/cancel, argument rejection, bounded UTF-8 output, and wait cancellation without job cancellation. The built `dsh --profile native-headless` keyless snapshot verifies model-visible schemas, an actual `job_list` call, its durable tool result, and continuation through the same Session.
