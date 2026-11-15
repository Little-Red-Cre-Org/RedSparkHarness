# Agent Note: Native external background

Status: implemented

English | [中文](2026-11-14-native-external-background.zh.md)

## Problem

The recorded `product-subagent-result-diagnostic` calls set `run_in_background`. The Native `subagent` schema omitted that property for an external provider, and `startBackground` required a session-backed provider. A replay therefore rejected the recorded calls before a driver could return the recorded diagnostic.

## Decision

When job controls are installed, an external one-shot may run as an Agent-owned job. `startBackground` uses the external driver and does not call `assertSessionBackedProvider`. The job starts only after `subagent/external-start` is flushed. The returned id is a `NativeExternalSubagentId`, not a Session id. The renderer prints that operation id and the remote id. It must not call the operation a child session.

Driver selection stays on the subagent plugin's `providerName`. A tool `config.provider` becomes a route override. A driver that does not list that field rejects the call before start.

## Alternatives considered

**Strip `run_in_background` from the replay.** Rejected. The recorded calls include the field. A Native profile that installs job controls must accept it.

**Add `provider` to the stub driver's route fields.** Rejected. The plugin name selects the driver. A route field the driver does not support fails before start, and the recorded scene does not need a route override.

**Start a live product child.** Rejected. The recorded diagnostics are already in the fixture. A stub driver returns them. The scene does not need a product binary.

## Consequences

External background remains one-shot. It does not create a child Session and cannot continue. `job_output` looks up the kind-prefixed job id, such as `subagent-1`, not the tool's remote id. `product-subagent-result-diagnostic` now replays without a product child, and its `snapshot.yml` profile is `headless`.
