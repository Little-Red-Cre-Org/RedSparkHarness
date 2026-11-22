# Agent Note: Queue idle session reads behind other idle reads

Status: implemented

English | [中文](2026-11-22-idle-read-admission-behind-idle-reads.zh.md)

## Problem

A restored browser Session reads `session/mode-controls` and then `session/submissions`. After history publishes the selection, the plan chip starts another read-only `session/mode-controls` at the same time as that first `session/submissions`. Both idle Session operations claim `NativeAgentExecution.runMaintenance`. The second claim throws `native-agent: Agent is busy` from `execution.ts`, and the web Session service returns HTTP 200 with `code: native/session` and that message. The plan-chip read still succeeds. A later `session/submissions` can succeed, but `refreshSubmissions` published the snapshot without clearing `submissionError`, so the banner stayed.

The failure is not `native-headless: exclusive Session maintenance is active`. That refusal applies only after a live owner is already published and its execution status is `maintenance`.

## Decision

`runMaintenance` accepts `shareIdleReads`. That option queues the call while every admitted operation is itself an idle read, and still throws `native-agent: Agent is busy` when the active or queued operation is not an idle read. Exclusive `runMaintenance` is unchanged: any active or queued operation refuses it synchronously.

`executeSessionOperation` passes that option only when `admission` is `shared-read`. The default remains exclusive. `session/mode-controls` and `session/submissions` use `shared-read` when they open an idle Session. The queued read runs its own writer open after the in-flight idle read releases the writer; the two reads do not open the writer together. Writes, preset selection, and every other idle operation stay exclusive. A live owner still uses the existing attached path, including its maintenance refusal.

When `refreshSubmissions` accepts a snapshot, it clears `submissionError`, except the read that follows a mutation in `mutateSubmission`. That call keeps the mutation failure when the inbox read succeeds.

## Verification

`submissions-read-admission.host.spec.ts` holds the resume write open inside the first idle admission, then issues the other call before an owner exists. Overlapping `session/mode-controls` and `session/submissions` both return `ok: true`. During exclusive submission-edit admission, both a submissions read and a second edit return `native/session` with message `native-agent: Agent is busy`. A submissions read with no overlapping mode-controls returns the snapshot. `submission-error.client.spec.ts` selects a Session whose first submissions read throws `native-agent: Agent is busy` and whose following read succeeds, then expects `submissionError` to be absent.

## Alternatives considered

### Why not stop throwing `Agent is busy`?

Exclusive maintenance, including writes and the child-lock idle claim, still needs a synchronous refusal when any operation is admitted. Queueing every maintenance call would let a write wait and then run.

### Why not wait on `exclusive Session maintenance is active`?

The captured first submissions body is `native-agent: Agent is busy`, thrown by `runMaintenance` before an owner is published. The attached-owner refusal is a different path and stays as it is.

### Why not serialize the plan chip instead?

The plan chip's second mode-controls read is a valid overlap with the submissions read. Client scheduling is unchanged.

### Why not open two Session writers at once?

The Session writer stays single-owner. A shared idle read waits until the current idle read finishes, then opens the writer itself.

## Consequences

- A read-only `session/submissions` no longer fails solely because a read-only `session/mode-controls` holds idle admission, and the reverse also completes.
- A write or any exclusive maintenance still receives `native-agent: Agent is busy` while another operation is active or queued.
- A successful submissions read removes the banner left by an earlier submissions failure.
- This admission change does not alter follow-bus delivery or plan-chip scheduling.
