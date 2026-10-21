# Agent Note: Native Shell live output

Status: implemented

English | [中文](2026-10-05-native-shell-live-output.zh.md)

## Problem

Native Shell background output is unavailable before settlement.

## Decision

Native Bash and PowerShell background Consumers publish captured stdout and stderr to the selected NativeJobs registry. The existing subprocess collection listeners deliver bytes without consuming retained output; the shared local Shell controller decodes UTF-8 separately per stream. Output callbacks are trusted in-process inputs and must not throw.

NativeJobs owns the configured bounded tail and stops accepting publication at cancellation or settlement. The Shell Consumer replaces that tail with the existing final renderer, preserving loss, spill recovery, sandbox failure, and denial facts. No parallel output registry or polling loop is introduced. Managed subprocess cancellation completes before the background handle settles; cleanup observation failure rejects the handle.

## Consequences

Verification covers real running output followed by cancellation, plus the shipped dsh PTC profile's logged job_output results and cold Session reading. Remote E2B observation uses its existing frame dispatcher; remote runtime verification requires provider credentials.

## Alternatives considered

Polling consumes retained output or adds a second owner. Direct capture observation preserves existing retention and Session ownership.
