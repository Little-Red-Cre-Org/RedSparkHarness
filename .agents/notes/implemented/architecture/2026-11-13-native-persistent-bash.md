# Agent Note: Native persistent Bash

Status: implemented

English | [中文](2026-11-13-native-persistent-bash.zh.md)

## Problem

`tool-bash-persistent` could run only as a Cordis plugin. Native profiles therefore could not compose the owner-scoped persistent `bash` tool that `sdk-minimal` advertises. Marker extraction, owner reuse, and reset lived inside `apply`, so a second copy in `native.ts` would drift from the Cordis path.

## Decision

The package is mixed. `src/persistent-core.ts` owns marker extraction, owner reuse, reset, and rendering, and imports neither runtime. `src/index.ts` adapts Cordis `ctx.terminals`. `src/native.ts` adapts `NativeTerminalRegistry` and registers the same `bash` value tool.

A Native list snapshot carries `running`, `exited`, or `failed` and no exit code or signal. A shell that is no longer running renders `[shell exited]`. `close` takes no reason; the adapter lists first and does not call `close` when the session is already gone. Owner disposal drops the cache and does not close the shell. The terminal registry closes sessions when the agent disposes.

This change does not mount the entry. [Native SDK persistent shell](2026-11-13-native-sdk-persistent-shell.md) later mounts it on `native-sdk`.

## Alternatives considered

**Copy the loop into `native.ts`.** The two copies would diverge, and the PowerShell twin is already a deliberate mirror. One core keeps the observable strings in one place.

**Mount the entry on `native-sdk` in this change.** `sdk-minimal` also composes persistent PowerShell, and deciding that profile belongs to phase A. Publishing the bash entry does not decide the profile.

**Read a backend session for an exit code the list snapshot does not carry.** The Native registry's list result exposes status only. Inventing a code would make a Native result claim a fact the registry did not report.

## Consequences

Cordis callers keep the same errors, reset notices, and exit text. A Native host can install `@redspark/rsh-tool-bash-persistent/native` once a terminal backend is present. The PowerShell twin publishes the same split. A Native reset cannot name an exit code the list snapshot does not carry.

[Native persistent PowerShell](2026-11-13-native-persistent-pwsh.md) records the twin. [What still depends on Cordis](../../proposed/architecture/2026-11-10-what-still-depends-on-cordis.md) records the survey that named this gap. [Native SDK persistent shell](2026-11-13-native-sdk-persistent-shell.md) mounts the shell and leaves the Python entry unmounted. [Native external diagnostic](2026-11-13-native-external-diagnostic.md) records the field.
