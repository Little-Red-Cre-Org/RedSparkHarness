# Agent Note: A Native entry for the recorded-session replay provider

Status: implemented

English | [中文](2026-11-09-native-llm-replay-entry.zh.md)

## Problem

`llm-replay` substitutes the model for every keyless snapshot scenario, and 37 of the 86 recorded scenarios under `snapshots/session/` name it directly. It had no `./native` entry: it registered a Cordis `llm` adapter or a `llm/stream` waterfall listener, so only a Cordis composition could compose it.

That was the single largest blocker for moving those scenarios to a Native profile. Whichever way the migration proceeds, a Native composition has to be able to replay a recorded session before any scenario can run through it.

## Decision

The package publishes `./native`, providing the `model` service the Native model-execution Provider consumes. `ReplayModel` implements the same per-session positional replay as the Cordis entry and reuses the existing `loadSessionScripts` and `resolveScriptedEntry` engine, so a recorded session, its override sidecar, and its child logs mean the same thing on both runtimes.

Configuration mirrors the Cordis `Config`: `file`, `overrideFile`, `childFiles`, `providers`, and `paceMs`, each defaulting to the same `RSH_SNAPSHOT_*` environment variable, plus the same eager validation of `paceMs` and a fixture path.

Two behaviors are deliberately identical to the Cordis entry because snapshots depend on them. A newly seen live session claims the next unclaimed script, so concurrent sessions keep their recorded order. A live session the recording does not contain, or one that exhausts its entries, fails rather than silently continuing — an unrecorded subagent must surface as an error, not as empty model output.

The Cordis export is unchanged. The package keeps `@redspark/cordis` as an optional peer so the Cordis entry still loads, and adds the Native peers its entry imports.

## Alternatives considered

**Build the Native composition on the Cordis entry through `cordis-bridge`.** Rejected. The Native runtime deliberately composes no Cordis Context, and the native-headless corpus asserts that with a loader probe that throws on Context construction. Hosting replay would have meant introducing exactly the Context those scenarios prove is absent.

**Give the Native entry its own script interpreter.** Rejected. `loadSessionScripts` already resolves fixtures, override sidecars, and child logs with the format diagnostics the corpus relies on. A second reader would drift from the Cordis one on the first fixture-format change.

**Return a plain catch-all model without provider catalogs.** Rejected. Scenarios that exercise model selection, image pricing, retry policy, or output-token limits read those facts from the configured route; dropping them would silently change what those scenarios can record.

## Consequences

A Native composition can now replay a recorded session, which is a precondition for migrating any scenario in `snapshots/session/`. The entry changes no product behavior: it ships only in the test-support tier and composes only when a profile names it.

The duplicated surface is the replay bookkeeping — the script cursor, the unrecorded-session failure, and the chunk emitter now exist twice, once per runtime. The shared parts (fixture parsing, entry resolution, override application) are not duplicated. When the Cordis entry is eventually retired, the Native one is the successor and needs no further porting.

Verification: `rsh/Tests/test-support/llm-replay/tests/native.spec.ts` replays a committed `fs-read` fixture, asserts one terminal `finish`, advances the cursor across a session's steps, and rejects both an unrecorded session and an exhausted script. The existing 558 Cordis-entry tests are unchanged and still pass.
