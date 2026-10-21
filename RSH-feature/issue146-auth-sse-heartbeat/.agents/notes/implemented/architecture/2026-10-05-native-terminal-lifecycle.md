# Agent Note: native terminal lifecycle ownership

Status: implemented

English | [中文](2026-10-05-native-terminal-lifecycle.zh.md)

## Problem

Native profiles need real terminal process ownership for interactive input and output. An ordinary piped subprocess cannot provide PTY allocation or process-session termination.

## Decision

The native entries of `dsh-terminal`, `dsh-terminal-bash`, and `dsh-tool-terminal` form one Definition, Provider, and Consumer capability. The Definition reserves an exact Agent owner during allocation and publishes an opaque id only after a backend returns a live process. The Provider uses `SubprocessOperations.spawnTerminal()` for a real PTY, applies the selected sandbox policy, and delegates quiescent termination to the subprocess handle. The [interaction decision](2026-10-05-native-terminal-interaction.md) owns shared shell readiness, retained output and the Consumer's interactive operations.

Agent release, backend removal, and Host disposal abort pending allocations, wait for their rollback, and close published sessions. The native service is process-local and cannot restore a terminal after Host loss. Native sessions are independent of the Cordis `ctx.terminals` registry and do not share ids or process state with it.

On Windows, ConPTY remains outside Job containment in the local subprocess Provider. Its close operation waits for the process range it can observe; descendants that escape that range may survive. The native registry does not claim stronger cleanup than the selected Provider.

## Alternatives considered

An ordinary subprocess with piped stdin and stdout was rejected because it has no terminal session or foreground process group. Copying the Cordis backend was rejected because it would duplicate readiness, scrollback and signal behavior. Native and Cordis entries share the PTY implementation while keeping registry ownership independent.

## Consequences

Profiles select the backend type and sandbox policy; the shell backend resolves executable, arguments, dimensions and termination grace from its validated configuration. A confined policy requires a sandbox Provider. The native registry owns cleanup failures and rejects an open or close instead of claiming a resource was released when the backend reports otherwise.
