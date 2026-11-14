# Agent Note: Native SDK persistent shell

Status: implemented

English | [中文](2026-11-13-native-sdk-persistent-shell.zh.md)

## Problem

`sdk-minimal` was the only shipped profile that combined `rsh-terminal` with a persistent shell. `native-sdk` had the Native entry points available and did not install them, so it did not cover that profile.

## Decision

`native-sdk` installs the platform shell. Linux and macOS install `@redspark/rsh-tool-bash-persistent`. Windows installs `@redspark/rsh-tool-pwsh-persistent`. Both use `@redspark/rsh-terminal`, `@redspark/rsh-terminal-bash` with `type: shell`, and `@redspark/rsh-subprocess-local`. The tool description and `timeoutMs: 300000` match `sdk-minimal`.

The PTY policy is `danger-full-access`. `native-sdk` keeps `@redspark/rsh-fs-local` and does not install `@redspark/rsh-sandbox-local`. The shell is unconfined, as the file provider already is. `native-sdk-dsh-child` remains the confined child and is unchanged: it already provides `subprocess`, and a second `@redspark/rsh-subprocess-local` row would provide `childConnection` twice.

`native-acp` and the headless, Web, and TUI profiles do not gain this shell. Headless already installs the one-shot shell tool.

`@redspark/rsh-experimental-code-runtime-python/native` stays unmounted. A release package must not name that experimental package. The shipped profiles that run code already provide `codeRuntime` through `@redspark/rsh-code-runtime-process-sandbox`; a second provider of the same key would not install.

## Alternatives considered

**Mount the shell on every Native profile.** Headless, Web, and TUI already have a one-shot shell. Adding the persistent tool there changes recorded tool schemas without covering `sdk-minimal`.

**Use `workspace-write` for the native-sdk PTY.** That mode requires a sandbox provider. `native-sdk` is the unconfined profile; the child profile owns confinement.

**Mount the Python runtime on `native-sdk`.** The published CLI would name an experimental package, and `codeRuntime` is already provided where code runs.

## Consequences

`dsh --profile sdk` and `dsh --profile native-sdk` expose `bash` or `pwsh`, selected by platform. The child and ACP profiles do not. The launcher refuses `sdk-minimal`; `--profile sdk` is the replacement. Python remains an opt-in Native entry.

Installing `@redspark/rsh-sandbox-policy` publishes the standing file policy. Every native-sdk turn carries a runtime-context user message that names `danger-full-access`.

The native-sdk recorded-session replays run on POSIX only: their model requests carry the platform shell name (`bash` or `pwsh`), and the fixtures are recorded with the POSIX tool set and POSIX tool calls. Windows still runs the native-sdk and ACP process regressions, and the Python SDK replays the same POSIX fixtures.

[Native persistent Bash](2026-11-13-native-persistent-bash.md) and [Native persistent PowerShell](2026-11-13-native-persistent-pwsh.md) record the entries. [Native Python code runtime](2026-11-13-native-python-code-runtime.md) records the unmounted runtime. [Cordis retirement, five phases](../../proposed/architecture/2026-11-12-cordis-retirement-five-phases.md) still owns retiring `sdk-minimal`.
