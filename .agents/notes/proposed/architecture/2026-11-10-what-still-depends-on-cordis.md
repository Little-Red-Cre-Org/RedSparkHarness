# Agent Note: What still depends on Cordis

Status: proposed

English | [中文](2026-11-10-what-still-depends-on-cordis.zh.md)

## Problem

The migration's goal ends with deleting Cordis. Whether that is reachable depends on how many packages still depend on it, and in what way — and that number is not in any single file. A reader of the profile templates sees six bundles; a reader of the package policy sees classifications; neither says how much code still needs the Cordis runtime to run at all.

Measured on the migration branch, **268 packages declare `@redspark/cordis` as a dependency or peer**. Of those, **113 outside `rsh/Compatibility` and `rsh/Tests`** have no `dsh.native` entry: they cannot run under the Native runtime at all.

## Proposal

Record the measured shape now, so deleting Cordis is planned against facts rather than assumed to follow from the scenario migration.

The 113 split by area as: `Programs/Web` 35, `Modules/Official` 21, `Modules/Community` 9, `Engine/core` 8, `Engine/session` 6, `Core/vendor` 6, `Engine/context` 4, `Engine/subagent` 4, `Core/typert` 4, `Engine/jobs` 3, and single digits across `Programs/{SDK,Desktop,CLI,ACP}`, `Core/{util,subprocess,storage,runtime-diagnostics}`, `Engine/{preset,llm,compaction}`.

The largest group is the Web application surface, which the Native runtime does not yet host. The second is official Modules, several of which have Native Providers beside them — the Cordis half is what a scenario would still reach if it composed the compatibility bundlerather than the Native one.

## Acceptance criteria

- `verify-native-dependencies` passes at every step of the deletion.
- Each deleted package's remaining importers are named in the pull request that deletes it.
- `Programs/Web` is either migrated or explicitly recorded as out of scope, with the reason.
- No package outside `rsh/Compatibility` imports `@redspark/cordis` at the end.

## Risks

Deleting Cordis is not a follow-on step to the scenario migration; it is a second, larger migration with its own ordering. Three facts follow from the measurement and should shape the plan:

- **`Core/vendor` must go first or last, never in the middle.** Those six packages are the pinned Cordis sources themselves; anything that still imports `@redspark/cordis` depends on them transitively.
- **`Core/subprocess`, `Core/storage` and `Core/util/launch-environment` are infrastructure, not leaves.** They have Native siblings (`subprocess-local`, the session backends) but the Cordis originals are still depended upon, so a deletion order has to break those edges explicitly rather than by deleting the package.
- **The Web application surface is the largest single block.** It is a client, not an engine package, so it may be legitimately out of scope for a runtime deletion — that is a decision the plan must state, not one it can leave implicit.

This note exists so the next round measures before it deletes. A package count is not a plan, but a plan without one is a guess.

## Alternatives considered

- **Treat the scenario migration as the whole precondition.** Rejected by the measurement: the scenarios exercise profiles, and 113 packages are reachable from profiles only through the compatibility bundles that the migration removes.
- **Delete `Core/vendor` first because it is the smallest obvious block.** Rejected: everything with a Cordis import depends on those sources transitively, so deleting them first breaks the tree before the edges are cut.
- **Fold this measurement into the migration Agent Note.** Rejected: that note records how to migrate a scenario; this records whether the runtime can be removed at all. They answer different questions and will be read at different times.
