# Agent Note: The desktop Host closes its own descriptors, and the prune keeps divergent nested copies

Status: implemented

English | [中文](2026-10-19-desktop-host-teardown-and-nested-prune.zh.md)

## Problem

Two defects shared one cause: a teardown asserted something the operating system was already doing.

The Desktop Host inherits descriptors 3 and 4 from Electron and wraps them in `fs` streams. Node's `fs` streams own an inherited descriptor whenever `autoClose` keeps its default, so `destroy()` closes the read end and the write end closes itself once its final write drains. `runDesktopHost`'s stop path also called `closeSync(DESKTOP_REQUEST_PIPE_FD)` and `closeSync(DESKTOP_RESPONSE_PIPE_FD)` after `destroy()`. The second close loses a race with the stream's own deferred close and reports `EBADF`. The Host routes stream errors to `failTransport`, so a clean shutdown printed a transport failure and wrote `Desktop Host stderr` into the desktop log:

```
Error: EBADF: bad file descriptor, close
Emitted 'error' event on WriteStream instance
```

On the parent side, `DesktopHostProcess.stop()` asks for teardown and then waits. The child's exit closed the response pipe, and the `'end'` listener reported `dsh desktop host response pipe ended` through `onFailure`. That made an intentional, successful stop indistinguishable from a crashed Host, which is the message operators had been reading as a defect on every plugin mutation.

The Python runtime prune had the mirror-image problem. `pruneNestedNodeModules` deleted every nested `node_modules` tree under a retained package on the reasoning that a retained package resolves its peers from the staging root. Node resolves `<package>/node_modules/<dep>` *before* the staging root, so a nested copy is what the runtime actually imports. Deleting a divergent copy silently changes the module a packaged executable loads, and the failure would surface only as a missing module or a wrong version at launch. The shipped dependency set happens to contain no nested directories, which is why the defect never fired.

## Decision

Each descriptor has exactly one owner.

`openDesktopHostPipes()` in `rsh/Programs/DesktopHost/src/pipes.ts` opens both descriptors as streams that own them, and its `close()` is single-shot: it destroys the request end, awaits `end()` on the response end so queued frames reach Electron, then destroys the write stream. `runDesktopHost`'s stop path calls `pipes.close()` and nothing else; `closeSync` is gone from the Host entry.

`DesktopHostProcess.stop()` sets `stopping` before it asks the child to shut down, and `fail()` consults that flag. An EOF, a zero exit code, or a late pipe error during an intentional teardown is the outcome the call requested, so none of them is reported as a failure. A non-zero exit code still is, because that is the child failing on its way out.

The prune keeps a nested tree unless it is provably equivalent to the staging root. `pruneNestedNodeModules` now takes the package map read before any deletion and compares every package in a nested tree against its same-named root package: same `version`, and the same `dependencies` and `peerDependencies` maps regardless of key order. The comparison descends into deeper `node_modules` trees, because a copy that nests further is not proven equivalent by its direct children alone. A tree whose packages all match, at every depth, is deleted as pure weight. A tree holding any divergent package — a different version, a different neighbour map, or no root counterpart at all — is kept, and each blocking package is reported through the new `PruneResult.retainedNested` as `owner -> nested package`.

## Alternatives considered

**Set `autoClose: false` and keep the explicit `closeSync` calls.** Rejected because the streams still hold the descriptor and their own destroy path still closes it; `autoClose: false` changes when the stream closes its handle, not whether teardown and the stream race for it. The descriptor needs one owner, not a flag that pretends there are none.

**Swallow `EBADF` by name in the stream error handlers.** Rejected because it hides the class of bug rather than the instance: any second descriptor close under any errno would still reach `failTransport`, and the next descriptor the Host inherits would need its own special case.

**Report the child's clean exit but keep the `'end'` message for other cases.** Rejected because there are no other clean cases: the response pipe reaching EOF without an intentional teardown is already caught by the exit handler, which distinguishes a non-zero code. Keeping two reports would leave the shutdown path able to publish a duplicate, misleading failure.

**Delete nested trees by a package name list instead of comparing contents.** Rejected because a name list encodes today's dependency set rather than the rule that makes deletion safe. The next nested copy of a package that is not on the list would be removed without anyone re-checking equivalence.

## Consequences

A clean Desktop Host stop logs no transport failure, so the `EBADF` and `response pipe ended` lines operators used to see on every plugin mutation are gone, and a real crash is once again visible in the log as the only thing that reports through `onFailure`. Teardown still escalates to `SIGTERM` then `SIGKILL` on the same 10s/5s/5s ladder.

Both pipe ends are now closed through the stream that owns them, which also means a write still queued when `stop()` begins is flushed before the descriptor closes instead of being truncated by an immediate destroy.

The prune can keep a nested tree it previously deleted, so the packaged Python runtime is never smaller than the closure but is no longer larger than it at the cost of correctness. `pruneStagedClosure` reports the retained entries and `build-exe-for-python-sdk.ts` logs each one, so a build that grows a divergent nested copy is visible instead of silently shipping it.

Equivalence covers `version`, `dependencies`, and `peerDependencies`. A nested copy that differs only in `optionalDependencies`, `peerDependenciesMeta`, `exports`, or its entry file is judged equivalent and deleted. That boundary is deliberate: the comparison exists to catch a copy that resolves to a different module graph, and the remaining fields are not consulted by the closure walk this prune already models.

## Testing

`rsh/Programs/DesktopHost/tests/pipes.spec.ts` opens the two descriptors as regular files and asserts that a close settles with no stream error and leaves both descriptors closed, that queued response bytes flush first, and that repeated `close()` calls share one teardown.

`rsh/Programs/Desktop/tests/host-process.spec.ts` gains a case that starts a ready Host, stops it, and asserts `onFailure` was never called and no `EBADF` line was logged. The fixture Host in that file no longer calls `closeSync` after `destroy()`, so the fixture models the shipped Host instead of the defect.

`rsh/Scripts/python-runtime-closure-prune.spec.ts` covers the four outcomes the rule distinguishes — an equivalent tree is deleted, a divergent copy (other version, other dependency map, or no root counterpart) is kept and reported, and a divergence below a direct child keeps the tree — plus key-order insensitivity of the dependency comparison.
