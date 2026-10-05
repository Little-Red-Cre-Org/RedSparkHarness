# Agent Note: Native attachment stream cleanup

Status: implemented

English | [中文](2026-10-05-native-attachment-stream-cleanup.zh.md)

## Problem

The native attachment Provider waited for open streams but discarded rejected cleanup results, so unloading could report success after a file stream failed to close. A synchronous iterator return failure could also escape before accepted operations drained. A failed batch preparation could settle the facade operation while other accepted preparations still ran.

## Decision

The [native Provider](../../../../rsh/Modules/Official/attachment/attachment-local/src/native.ts) closes admission, cancels reads, and waits for accepted operations and every captured iterator return. A consumer-initiated iterator return remains owned until its actual completion. Only stream cleanup failures reject its shared close promise; one failure retains its identity and multiple failures are aggregated. The installation's abort listener starts closure, while its owned disposer reports the same promise's outcome. Cancelled image callers return promptly; the existing variant-keyed request table retains each replaced transform's completion through its successor, and the Provider waits for these transforms and cache writes before closing.

## Alternatives considered

Rejecting immediately on the first return would leave other accepted work running. Propagating every operation rejection as a cleanup failure would misclassify a request failure already reported to its caller. Ignoring all settled failures would hide incomplete cleanup.

## Consequences

Attachment bytes, references, image admission and Session events do not change. The legacy service shares the same storage backend; this change concerns only native Provider shutdown.

## Verification

The existing batch case verifies shutdown waits for held preparation after another preparation fails and publishes no objects. The existing paused-stream case also checks a throwing iterator return, repeated close identity and rejection of later reads. The existing shared-transform cancellation case verifies a replacement completes while its cancelled predecessor remains held, and Provider close waits for that predecessor to settle. No additional test case or model-output fixture is required because attachment outputs remain unchanged; shutdown draining and cleanup reporting are the affected behaviors.
