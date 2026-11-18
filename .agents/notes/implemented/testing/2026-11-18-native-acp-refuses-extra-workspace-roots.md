# Agent Note: Native ACP refuses extra workspace roots and covers tool cancellation

Status: implemented

English | [中文](2026-11-18-native-acp-refuses-extra-workspace-roots.zh.md)

## Problem

The previous note kept `reject-extra-dirs` and `cancel-tool-calls` in `snapshots/acp/` because the first described behavior Native ACP did not have and the second had no Native test.

The gap was real: `session/new` accepted a non-empty `additionalDirectories` and discarded it. A client that asked for extra workspace roots was told the Session was created while the Harness resolved nothing outside `cwd`. The legacy server refused the same request with invalid params.

Nothing covered cancellation while a tool call is in flight. The Native suite cancelled a streaming model turn, which settles before any tool starts.

## Decision

`NativeAcpApplication.newSession` refuses a non-empty `additionalDirectories` with the legacy server's message, `additionalDirectories is not supported`, before any Session work starts. An absent, `null`, or empty list still creates a Session: the field is a workspace-scope request, and an empty one widens nothing.

`snapshots/native-acp/tool-cancel.snapshot.ts` drives the shipped `acp` profile over JSON-RPC against a local fixture model. The fixture returns two `write_file` calls in one assistant message. The client holds the first `session/request_permission` answer, sends `session/cancel`, and the snapshot asserts:

- `session/prompt` settles with `stopReason: 'cancelled'`;
- the running call reports `tool_call` then `tool_call_update` with `failed`;
- the call behind it reports a single `tool_call_update` with `failed` and the "interrupted before the Harness recorded it as started" text, because Native ACP never announces a call it does not dispatch;
- neither file lands on disk.

Holding the permission answer makes the in-flight window deterministic without a shell tool, which the `acp` profile does not mount.

Both legacy scenarios leave `snapshots/acp/`. The recorded Session that `cancel-tool-calls` owned was also the seed for two Native Web abort-row tests, so it moves to `snapshots/web/bash-abort-row/`, the scenario that owns that behavior, instead of disappearing with the legacy directory.

## Consequences

`snapshots/acp/` now holds `escalation-approved`, `fs-escalation-approved`, and `image-compaction`. The first is the `acp-default` request-header pin; the other two are still open questions for the legacy exit.

`snapshots/native-acp/tool-cancel.snapshot.ts` joins the native ACP pull-request CI step, so the in-flight cancellation path runs on every pull request rather than only where the whole corpus runs.

## Alternatives considered

**Accept and apply `additionalDirectories`.** Rejected: the shipped profile mounts one workspace root, so honoring the field means a workspace-root list threaded through the filesystem provider, the sandbox policy, and every tool schema. That is a feature decision for the profile, not a migration step.

**Keep silently ignoring the field.** Rejected: the client would believe paths outside `cwd` are addressable, which is worse than refusing the request.

**Use a shell tool to hold the tool call.** Rejected: the `acp` profile does not mount one, and adding a shell to the snapshot composition would test the shell rather than cancellation.

**Keep `cancel-tool-calls` as the Native Web fixture in place.** Rejected: a directory under `snapshots/acp/` with no ACP scenario reads as live legacy coverage, and the inventory gate cannot tell the difference.

## Verification

`pnpm exec vitest run --config vitest.snapshot.config.ts snapshots/native-acp/legacy-handshake.snapshot.ts snapshots/native-acp/tool-cancel.snapshot.ts` passes. The handshake snapshot also asserts that an empty `additionalDirectories` list still creates a Session.
