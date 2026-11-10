# Agent Note: What still depends on Cordis

Status: proposed

English | [中文](2026-11-10-what-still-depends-on-cordis.zh.md)

## Problem

The migration's goal ends with deleting Cordis. Whether that is reachable depends on how many packages still depend on it, and in what way — and that number is not in any single file. A reader of the profile templates sees six bundles; a reader of the package policy sees classifications; neither says how much code still needs the Cordis runtime to run at all.

Measured on the migration branch, **268 packages declare `@redspark/cordis` as a dependency or peer**. Of those, **113 outside `rsh/Compatibility` and `rsh/Tests`** have no `dsh.native` entry: they cannot run under the Native runtime at all.

## Proposal

Record the measured shape now, so deleting Cordis is planned against facts rather than assumed to follow from the scenario migration.

The 113 split by area as: `Programs/Web` 35, `Modules/Official` 21, `Modules/Community` 9, `Engine/core` 8, `Engine/session` 6, `Core/vendor` 6, `Engine/context` 4, `Engine/subagent` 4, `Core/typert` 4, `Engine/jobs` 3, and single digits across `Programs/{SDK,Desktop,CLI,ACP}`, `Core/{util,subprocess,storage,runtime-diagnostics}`, `Engine/{preset,llm,compaction}`.

The largest group is the Web application surface, but it is **half migrated rather than untouched**: of its 75 packages, 33 already carry a `dsh.native` entry and only 35 are Cordis-only. The remaining Cordis half is the client UI that the compatibility renderer still mounts. The second is official Modules, several of which have Native Providers beside them — the Cordis half is what a scenario would still reach if it composed the compatibility bundlerather than the Native one.

Three scenarios use tools that exist only on the Cordis side — `cordis_define`, `cordis_undefine`, `cordis_inspect_query` — provided by `@redspark/rsh-tool-cordis`, which is a Cordis plugin with no Native entry. `advanced-toolchain`, `advanced-toolchain-runtime` and `cordis-inspect-jsdoc` therefore describe a capability that disappears with the runtime, so they retire with it rather than migrating. Migrating them would mean porting a tool whose purpose is to manipulate the runtime being deleted.

The six templates are exactly `acp`, `web`, `headless`, `rsh`, `sdk` and `sdk-minimal` in `PROFILE_TEMPLATES` (`rsh/Compatibility/DSH/boot/app-boot/src/profile.ts`). Each names the bundle layers `dsh --profile <name>` composes, so retiring a template and deleting its bundles are the same step; four of the seven bundle directories (`base`, `headless`, `rsh`, and the SDK pair) are named by those templates directly, while `base` is shared by every non-minimal template.

What blocks the leaf deletions is that the bundle layers are their last consumers. Five Cordis-only leaves — `session-stats`, `session-turn-outline`, `session-checkpoint-policy`, `file-reference-local`, `agent-tool-presentation` — have exactly one dependent each, and it is the `web-app`, `base` or `sdk-runtime` layer that T-F retires. They cannot be deleted before their bundle, and their bundle cannot be deleted before the profiles those bundles serve have a Native equivalent.

Fourteen Cordis-only leaves have no dependents at all, but a leaf is not automatically dead. They split three ways:

- **Vendored Cordis sources.** `@redspark/cordis-plugin-logger-console` is part of the pinned Cordis tree; it disappears when the tree does, not before.
- **Live feature packages with no shipped composition.** `tool-str-replace-editor`, `storage-sqlite`, `typert/generator`, the `e2b` providers, the Python SDK runtime closure and the six `experimental/*` packages are documented, working Providers and tools that no shipped bundle happens to mount. Deleting them would remove a capability rather than a dependency, so each needs an explicit decision, not a sweep.
- **Replaced by a Native half.** `time-context` and `tmux-context` were the only two in this shape, and both are now deleted.

The reusable test for the third group is: a Native sibling exists, nothing depends on the Cordis package, and no bundle layer names it. Two met it; the rest did not, which is why the sweep stops at two rather than continuing through the list.

## Acceptance criteria

- `verify-native-dependencies` passes at every step of the deletion.
- Each deleted package's remaining importers are named in the pull request that deletes it.
- `Programs/Web` is either migrated or explicitly recorded as out of scope, with the reason.
- No package outside `rsh/Compatibility` imports `@redspark/cordis` at the end.

## Risks

Deleting Cordis is not a follow-on step to the scenario migration; it is a second, larger migration with its own ordering. Three facts follow from the measurement and should shape the plan:

- **`Core/vendor` must go first or last, never in the middle.** Those six packages are the pinned Cordis sources themselves; anything that still imports `@redspark/cordis` depends on them transitively.
- **`Core/subprocess`, `Core/storage` and `Core/util/launch-environment` are infrastructure, not leaves.** They have Native siblings (`subprocess-local`, the session backends) but the Cordis originals are still depended upon, so a deletion order has to break those edges explicitly rather than by deleting the package.
- **The Web application surface is the largest single block, and it is already half migrated.** 33 of its 75 packages run natively; the 35 Cordis-only ones are mostly client UI mounted by the compatibility renderer. Finishing them is a rendering migration, not a runtime one, and that distinction decides whether deleting Cordis is reachable at all.

This note exists so the next round measures before it deletes. A package count is not a plan, but a plan without one is a guess.

## Alternatives considered

- **Treat the scenario migration as the whole precondition.** Rejected by the measurement: the scenarios exercise profiles, and 113 packages are reachable from profiles only through the compatibility bundles that the migration removes.
- **Delete `Core/vendor` first because it is the smallest obvious block.** Rejected: everything with a Cordis import depends on those sources transitively, so deleting them first breaks the tree before the edges are cut.
- **Fold this measurement into the migration Agent Note.** Rejected: that note records how to migrate a scenario; this records whether the runtime can be removed at all. They answer different questions and will be read at different times.
