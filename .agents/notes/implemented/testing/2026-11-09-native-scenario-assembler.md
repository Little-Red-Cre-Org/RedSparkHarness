# Agent Note: A shared assembler for recorded Native scenarios

Status: implemented

English | [中文](2026-11-09-native-scenario-assembler.zh.md)

## Problem

Every recorded Native scenario repeated the same sequence by hand: create an isolated Harness home, copy the shipped `native-headless` profile, symlink the packages the profile reaches, rewrite the composition, launch `dsh --profile` behind the Cordis-context probe, read the persisted Session, and remove the directories. The twelve harnesses that carry an explicit module link table spell that setup out each time, and the sequence is the part most likely to drift as the shipped profile changes.

Before any scenario could be moved off the Cordis `legacy-headless` profile, that setup had to exist once.

## Decision

`@redspark/rsh-session-snapshot` publishes `assembleNativeScenario`, which owns the whole sequence:

- a temporary Harness home with `work`, `sessions`, and a `profiles/native-headless` directory
- the shipped composition copied as the starting point, so a scenario inherits the real product rows and states only its differences
- `storage`, `fs`, and `model` rows filled from the scenario's own paths and replay script
- a baseline module link set plus the scenario's extra modules, and source-materialized local packages for a profile-local entry
- `run()`, which launches the shipped profile through `dsh` behind `deny-cordis-context-register` and fails on a nonzero exit
- `dispose()`, which removes the home

`reexportPackage` builds the small `node_modules` package a profile needs to reach a built `./native` entry, which is how the replay provider is installed without touching the shipped profile.

`snapshots/native-headless/fs-read-native.snapshot.ts` is the worked example: it replays a committed `snapshots/session/` fixture through a Native profile and asserts the produced event sequence equals the recording's.

## Alternatives considered

**A fixed module link table inside the assembler.** Rejected on measurement: across the twelve harnesses that declare one, no single link appears in all of them, and the top entries appear in only seven. The package set is genuinely per scenario, so the assembler takes it as input instead of guessing.

**Generate a profile file per scenario and keep it committed.** Rejected. The shipped composition changes with the product; a committed copy would silently diverge, which is the drift this exists to prevent.

**Reuse the Cordis `materializeProfilePatch` path.** Rejected. Native patches address existing rows by id and cannot add one, so a scenario needs the whole composition rewritten rather than a patch layered over it.

## Consequences

A scenario now states its differences rather than its plumbing: the worked example is 67 lines including its assertions, against roughly 120 for the same scenario written by hand. The assembler is 183 lines, paid once.

The assembler removes boilerplate, not per-scenario substance. The example still names seven module links and five appended rows, because those are what that scenario actually composes. Moving the remaining `snapshots/session/` scenarios is therefore still per-scenario work: each one's module set and row set must be derived from its Cordis composition and checked against the recording.

The example is registered in the snapshot corpus, so a drift in the shipped profile or in the assembler fails a landed test rather than a future migration.
