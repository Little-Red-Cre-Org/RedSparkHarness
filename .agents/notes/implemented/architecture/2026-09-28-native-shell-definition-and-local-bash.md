# Agent Note: Native shell definition and local Bash Provider

Status: implemented

English | [中文](2026-09-28-native-shell-definition-and-local-bash.zh.md)

## Problem

The native subprocess and process-sandbox services cannot support command tools until the shell request, result, and background-handle types load without Cordis. The legacy Bash executor owns useful command mechanics, but importing its service class would bring Cordis into a native profile.

## Decision

[`dsh-shell/native`](../../../../rsh/Modules/Official/shell/shell/README.md) exports `ShellOperations` and the existing request, result, process, and rendering vocabulary without a Cordis import. The root entry retains the legacy `ShellExecutor` service.

[`dsh-bash-local/native`](../../../../rsh/Modules/Official/shell/bash-local/README.md) installs `shell` over a required native `subprocess` service. It validates explicit budgets during planning. The Cordis adapter and native Provider use one controller for request resolution, environment ordering, foreground timeout classification, and background output reads. The subprocess Provider continues to own process-range termination and cleanup.

[`dsh-bash-sandbox/native`](../../../../rsh/Modules/Official/shell/bash-sandbox/README.md) requires native `subprocess`, `sandbox`, and `sandboxPolicy` services. Its Cordis and native entries share one controller for per-call policy resolution, runner argv, denial classification, and runner failure reporting. A restricted call never falls back to unconfined Bash when runner selection or execution fails; only an explicit `danger-full-access` policy bypasses the runner.

[`dsh-tool-bash/native`](../../../../rsh/Modules/Official/shell/tool-bash/README.md) consumes the selected native shell and tool registry. Its foreground result uses the legacy renderer. Background execution requires both the Agent-owned job registry and the `jobControls` service published after `job_output`, `job_list`, and `job_kill` register; a job registry alone cannot expose an inaccessible job. The job registry owns cancellation and settled output. A sandbox runner failure settles the job as failed even when the wrapper process exited normally. Escalation validates strict widening and asks the native application's approval authority before passing a one-call policy to the shell; the application records the tool and approval events in its Session and retains coded runner failures in tool-result metadata.

[`dsh-shell-env/native`](../../../../rsh/Modules/Official/shell/shell-env/README.md) supplies managed `DSH_*` facts to each native Bash call. The Bash Consumer imports `dsh-shell-env/definition` instead of its Provider class. Cordis and native Providers share key-ownership validation and per-execution collection. Cordis effects and native contributors' installation scopes own their respective disposers.

## Alternatives considered

**Import the legacy service in a native profile:** this would evaluate Cordis and prevent a Cordis-free package closure.

**Copy the command implementation:** separate copies could diverge on timeout causes, environment precedence, or background output consumption.

## Consequences

Native Bash and PowerShell register canonical foreground/background value contributions. Both native and Cordis consumers use the shell definition's foreground projection, which retains independent command outcomes and excludes provider-owned extra properties. Output schemas preserve truncation locators and optional sandbox diagnostics; rendering keeps the existing model text. Undeclared escalation/background arguments fail registry validation before approval or execution. Strict widening is checked for schema-admitted targets. PTC bindings and ordered nested dispatch remain separate requirements.

The native local Bash Provider is unconfined and is not selected as a default restricted-policy tool. Native background output is available after the process settles. The legacy executors retain their settings sections and share their respective controllers with the native Providers.

Bash configuration resolves the omitted executable to `bash` and accepts a validated explicit `bashPath`, parallel to PowerShell executable selection. The same selected argv flows through local and sandboxed Providers before confinement; runtime selection cannot authorize filesystem access. Native SDK acceptance of the private patched runtime remains a separate product verification obligation.
