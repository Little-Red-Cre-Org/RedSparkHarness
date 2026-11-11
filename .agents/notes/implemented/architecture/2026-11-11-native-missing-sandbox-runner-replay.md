# Agent Note: Native replays a missing sandbox runner

Status: implemented

English | [中文](2026-11-11-native-missing-sandbox-runner-replay.zh.md)

## Problem

The missing-sandbox-runner recording asks `bash` to run `true` under read-only confinement, then asks `job_output` for `bash-1`. The stored results are the unavailable-backend refusal and `unknown job`. The twelve-row native test profile has no shell and no sandbox provider, so the recording could not replay.

## Decision

The native scenario installs subprocess, shell environment, a read-only sandbox policy, bash, and a snapshot provider. That provider's `confine` prefixes the command with `.dsh-missing-sandbox-runner`, which is not an executable. Spawn failure becomes the same unavailable-backend error, and no job is published. `job_output` then reports the unknown job.

## Alternatives considered

**Omit the sandbox provider.** The bash tool would either refuse to start or run the command unconfined. Neither result matches the recording.

**Skip the scenario on Windows.** The refusal is produced before the command runs, and the same text already names the Windows runner. The replay does not need a POSIX host.

## Consequences

Profiles that install a real sandbox backend are unchanged. This scenario's provider exists only in the snapshot and always fails closed.
