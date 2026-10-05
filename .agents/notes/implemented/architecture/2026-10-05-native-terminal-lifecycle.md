# Agent Note: native terminal lifecycle ownership

Status: implemented

English | [中文](2026-10-05-native-terminal-lifecycle.zh.md)

## Problem

Native profiles need real terminal process ownership before they can support interactive input and output. An ordinary piped subprocess cannot provide PTY allocation or process-session termination, while exposing partial interaction would imply readiness and output guarantees the native packages do not yet implement.

## Decision

The native entries of `dsh-terminal`, `dsh-terminal-bash`, and `dsh-tool-terminal` form one Definition, Provider, and Consumer capability. The Definition reserves an exact Agent owner during allocation and publishes an opaque id only after a backend returns a live process. The Provider uses `SubprocessOperations.spawnTerminal()` for a real PTY, applies the selected sandbox policy, drains currently unexposed output, and delegates quiescent termination to the subprocess handle. The Consumer exposes only open, list, and close; it does not represent allocation as shell readiness.

Agent release, backend removal, and Host disposal abort pending allocations, wait for their rollback, and close published sessions. The native service is process-local and cannot restore a terminal after Host loss. Native sessions are independent of the Cordis `ctx.terminals` registry and do not share ids or process state with it.

On Windows, ConPTY remains outside Job containment in the local subprocess Provider. Its close operation waits for the process range it can observe; descendants that escape that range may survive. The native registry does not claim stronger cleanup than the selected Provider.

## Alternatives considered

An ordinary subprocess with piped stdin and stdout was rejected because it has no terminal session or foreground process group. Copying the Cordis backend was rejected because its readiness, scrollback, and signal behavior rely on services that are not part of this native lifecycle capability. A lifecycle-only PTY is retained as a closed capability rather than reporting unsupported interaction as success.

## Consequences

Profiles must explicitly select a shell executable, arguments, dimensions, termination grace, sandbox policy, and the Consumer's advertised backend type. A confined policy requires a sandbox Provider. Native terminal tools produce lifecycle facts but no captured output; model-visible interaction remains on the Cordis path. The native registry owns cleanup failures and rejects an open or close instead of claiming a resource was released when the backend reports otherwise.
