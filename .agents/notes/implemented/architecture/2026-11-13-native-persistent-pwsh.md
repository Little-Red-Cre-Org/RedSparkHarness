# Agent Note: Native persistent PowerShell

Status: implemented

English | [中文](2026-11-13-native-persistent-pwsh.zh.md)

## Problem

`tool-pwsh-persistent` could run only as a Cordis plugin. Native profiles therefore could not compose the owner-scoped persistent `pwsh` tool that `sdk-minimal` advertises. Marker extraction, prompt readiness, owner reuse, and reset lived inside `apply`, so a second copy in `native.ts` would drift from the Cordis path and from the bash twin.

## Decision

The package is mixed. `src/persistent-core.ts` owns marker extraction, prompt setup, owner reuse, reset, and rendering, and imports neither runtime. `src/index.ts` adapts Cordis `ctx.terminals`. `src/native.ts` adapts `NativeTerminalRegistry` and registers the same `pwsh` value tool.

The PowerShell differences stay in that core: backtick quoting, the `prompt` function, prompt stripping, and `[exit code: N]` only for a nonzero wrapped command. A Native list snapshot carries `running`, `exited`, or `failed` and no exit code or signal. A shell that is no longer running renders `[shell exited]`. `close` takes no reason; the adapter lists first and does not call `close` when the session is already gone. Owner disposal drops the cache and does not close the shell. The terminal registry closes sessions when the agent disposes.

This change does not mount the entry. [Native SDK persistent shell](2026-11-13-native-sdk-persistent-shell.md) later mounts it on `native-sdk`.

## Alternatives considered

**Copy the loop into `native.ts`.** The Cordis path and the bash twin would diverge. One core keeps the observable PowerShell strings in one place.

**Share `persistent-core.ts` with `tool-bash-persistent`.** The wrappers, readiness checks, and status text differ. A shared file would hide those differences behind flags.

**Mount the entry on `native-sdk` while publishing it.** Deciding `sdk-minimal` belongs to phase A. Publishing the entry does not decide the profile.

**Read a backend session for an exit code the list snapshot does not carry.** The Native registry's list result exposes status only. Inventing a code would make a Native result claim a fact the registry did not report.

## Consequences

Cordis callers keep the same errors, reset notices, and exit text. A Native host can install `@redspark/rsh-tool-pwsh-persistent/native` once a pwsh-dialect terminal backend is present. A Native reset cannot name an exit code the list snapshot does not carry. `persistent-pwsh-tool-turn` still needs a Native recording before a profile can replay it.

[Native persistent Bash](2026-11-13-native-persistent-bash.md) records the twin. [What still depends on Cordis](../../proposed/architecture/2026-11-10-what-still-depends-on-cordis.md) records the survey that named this gap. [Native SDK persistent shell](2026-11-13-native-sdk-persistent-shell.md) mounts the shell and leaves the Python entry unmounted. [Native external diagnostic](2026-11-13-native-external-diagnostic.md) records the field.
