# Agent Note: Workspace command failures keep their message

Status: implemented

English | [中文](2026-11-22-workspace-command-failure-message.zh.md)

## Problem

`workspaces/connect` of a non-core directory, including a path under the system temp root, can fail while the blank Session is materialized. Materialization takes a write lease, and that lease loads `system.node` through `tryLockExclusive`. When the addon is absent, headless throws `native-headless: turn cleanup failed` around the `flock.ts` module error. `NativeWebWorkspaceService.handle` replaced every failure outside a short allowlist with `Workspace request failed.` and `native/workspaces`. The browser banner shows that RPC message, so the operator gets no reason. The temp path is not a protected system directory: with the addon present, create and connect succeed.

## Decision

`workspaces/*` failures other than the outside-root and protected-directory cases return `native/workspaces` and `workspaceFailureMessage`. That text is the thrown message. An `AggregateError` appends each nested message. A non-Error uses `String(value)`. Outside-root results stay `native/workspace-untrusted` with `{ path }`. Protected directories stay `native/workspace-forbidden`. Invalid `workspaces/follow` bodies still return `Workspace request failed.` Directory commands still use `native/directories` and their generic messages.

## Alternatives considered

### Why not extend the allowlist with the missing-addon text?

The message includes a filesystem path and a cleanup title, and other admission failures are hidden the same way. An allowlist cannot name them in advance.

### Why not import the Session `errorMessage` helper?

`native.ts` already imports `workspaces.ts`. A local function uses the same nested-message text without a cycle. A new shared module would only move those three lines.

### Why not add a route-admission code for a missing addon?

The addon failure happens during Session materialization, not directory rejection. A path under the temp root stays admissible. A new code would not name the missing file.

## Consequences

- A rejected workspace command shows the thrown message, including nested `AggregateError` messages, on the existing `native/workspaces` result. The client already renders `error.message`.
- Protected directories and paths outside `allowedRoots` keep their current codes and details.
- Invalid follow JSON stays the generic message.
- The message can include a filesystem path from the underlying error, as Session failures already do.

## Verification

`workspace-connect.host.spec.ts` connects a directory under the system temp root, rejects a protected system directory even when the caller passes `trust: true`, rejects a directory outside `allowedRoots` with the canonical path, and reports a nested `AggregateError` instead of `Workspace request failed.`
