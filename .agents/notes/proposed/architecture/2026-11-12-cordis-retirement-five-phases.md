# Agent Note: Retiring Cordis in five measured phases

Status: proposed

English | [中文](2026-11-12-cordis-retirement-five-phases.zh.md)

## Problem

`rsh/Docs/architecture.md` still describes the harness as an all-plugin Cordis harness, and that remains literally true. Native profiles boot their plugins through `NativeContext` and read capability keys, but the services behind those keys are implemented by `class X extends Service` subclasses whose scope, lifetime and event dispatch belong to Cordis. The 2026-11-12 baseline states the inference plainly: Native runs on top of Cordis classes, so Cordis cannot be deleted until that skeleton is removed.

The baseline's numbers were re-measured against the tree at `7419c1be0c` before any phase was scheduled, because each phase is sized by one of them. Four claims moved enough to change the plan: the type-only import population is three times the reported figure, the Core+Engine skeleton is 23 classes rather than 15, one of the four immediately-deletable packages is the Python wheel's deploy root, and the eleven scenarios are 246 recorded cases of which 207 still replay through legacy or web profiles.

This note records the measured baseline, the five-phase route it supports, and the exit evidence each phase must produce. It changes no code.

## Proposal

Five serial phases: A closes the legacy exits, B completes Native capability, C sheds the Cordis skeleton, D drains the remaining references, and E deletes packages. Each phase lands as its own PR off freshly fetched `origin/main`, and each exit is the next phase's usable input.

### What re-measurement changed

| Baseline claim | Measured on 2026-11-12 | Effect on the route |
|---|---|---|
| 252 of 377 packages reference `@redspark/cordis` | 263 of 360 tracked `rsh/` manifests declare it; 1280 `.ts` files import it | D is wider than planned |
| 110 value-level, 142 type-only | 824 files value-level, 456 files type-only | Type-only removal is the larger half of D |
| 48 packages, 51 classes, 15 in Core+Engine | 70 classes repo-wide; 23 in Core+Engine, plus 2 in `Core/vendor` | C covers eight more classes than budgeted |
| The six core libraries are all `extends Service` | Confirmed; none has an external subclass, and 15 of the 23 already ship a Native provider | C pays for consumer rewrites, not providers |
| Four zero-reference packages are immediately deletable | Three; `dsh-python-runtime-closure` is the deploy root named by `rsh/Scripts/build-exe-for-python-sdk.ts:23` | E1 shrinks; the deploy root becomes the reverse checklist |
| Eleven scenes need a `<scene>-native.snapshot.ts` | 246 cases; 39 replay on native profiles, 207 on legacy or web | B is counted in cases, not scenes |

### Coverage sorts into three grades

Each of the 263 declaring packages falls into one grade, decided by resolving every manifest `exports` subpath to its `src` entry and following relative and `@redspark/*` imports from there:

| Grade | Packages | What removing Cordis asks of it |
|---|---|---|
| `cordis-only` | 84 | No entry reaches Cordis-free source: rewrite the package or delete it |
| `mixed` | 169 | One entry, usually `./native`, is already Cordis-free; the rest is the legacy half |
| `native-clean` | 10 | Declares the peer and nothing reaches it: the declaration is stale |

These three grades are the 2026-11-12 measurement. [Cordis cleanup keeps the legacy writers and three packages](2026-11-15-cordis-cleanup-keeps-legacy-writers.md) recomputed them. Do not use 84, 169, or 10 as the current counts.

### The Native half is already Cordis-free

No file on a Native side reads a Cordis service name: no `native.ts` and no `src/native-*` file calls `ctx.sessions`, `ctx.tools` or any other `ctx.<service>`. Native entries resolve dependencies through capability keys, and 103 distinct keys are provided across the tree. Two packages host a Cordis plugin from a Native entry on purpose — `rsh/Core/runtime-diagnostics/cordis-bridge` and `rsh/Engine/preset/native-persona` — and `rsh/Scripts/native-package-policy.ts` records both.

That bounds phase C: it is not 165 entry rewrites but the deletion of each legacy half, which concentrates in 1280 files carrying 399k lines. `rsh/Modules/Official` (94k) and `rsh/Programs/Web` (89k) hold nearly half of that.

### Phase A — close the legacy exits

- The 13 names in `dsh.nativeProfileTemplates` boot Native. The shipped name `sdk-minimal` no longer boots; its bundle remains composable from a custom legacy profile. `native-sdk` now carries the platform persistent shell that `sdk-minimal` combined with `rsh-terminal`.
- The launcher refuses `sdk-minimal` on boot, dump, plugin management, and `--from-default-profile`, and points at `--profile sdk`. Existing directories are not rewritten. The packaged Python smoke asserts that refusal and no longer compares the minimal snapshots. The continuation benchmark uses the custom name `bench-minimal` so it can still compose `@redspark/rsh-sdk-minimal`. The three legacy arms and other custom legacy names remain.
- A local `profileRuntime` check of the active home returned `legacy` for `web` and `desktop`. Criterion 2 of [Legacy runtime retirement](2026-11-06-legacy-runtime-retirement.md) does not hold, so this phase does not refuse those names and does not change `initProfile`.
- The three legacy arms in `bin.ts` (`profile`, `plugin`, `dump-config`) retire after `2026-11-06-legacy-runtime-retirement.md`, which owns what becomes unreachable.
- Exit: every shipped name boots Native, a custom name that would need legacy is refused by name, and `initProfile` writes no legacy manifest.

### Phase B — complete Native capability

- The optional `diagnostic` on `NativeExternalSubagentOutcome` (`rsh/Engine/subagent/native-subagent/src/external-driver.ts:361`) has shipped; [Native external diagnostic](../../implemented/architecture/2026-11-13-native-external-diagnostic.md) records it. `native-sdk` mounts the platform persistent shell. `code-runtime-python` stays unmounted. [Native SDK persistent shell](../../implemented/architecture/2026-11-13-native-sdk-persistent-shell.md) records both choices. An external one-shot can also run as an Agent-owned job; [Native external background](../../implemented/architecture/2026-11-14-native-external-background.md) records it.
- The composable ACP child is not a gap: `rsh-acp-child` already provides `externalSubagentDriver`. No shipped profile carries the experimental Python runtime: a release package must not name it, and the profiles that run code already provide `codeRuntime` through `@redspark/rsh-code-runtime-process-sandbox`.
- The 207 legacy and web cases move to Native profiles in scenario batches, each batch recording its case diff as evidence. Eighty `snapshots/session/` directories whose Native replay passed now have `profile: headless`, so the Cordis runner no longer selects them. [Cordis replay stops when the Native replay passes](../../implemented/testing/2026-11-14-cordis-replay-stops-when-native-passes.md) records the composition rule and the blockers that keep the other 6 `legacy-headless` directories, plus `legacy-acp` and the remaining `web` directories. `native-web-session-core`, `native-conversation`, `native-question-cancel`, `native-session-grant`, and `bash-abort-row` left that inventory after their Native replay passed. Thirty-four `snapshots/web/` directories stay `profile: web`. `skill-tool-row` and `workflow-run`, the web members of `default`, left after `native-workflow-open.e2e.ts` passed. `web-schedule` left after `native-schedule-catalog.e2e.ts` passed with the catalog and sidebar marker folded from the Session log. `minimal-preset` stays because its model-facing composition is still `agent.cordis.yml`. `web-ptc` left after both `native-present.e2e.ts` and `native-ptc-round.e2e.ts` passed. `sdk-upload`, `session-title`, `image`, `system-prompt-in-history`, `ptc`, `sdk-minimal`, `sdk-default`, and `sdk-dsh-sdk-diagnostic` left the SDK runner after their Native replays passed; 9 `snapshots/sdk/` directories stay `legacy-sdk`. The remaining `legacy-sdk` and `legacy-acp` cases have recorded blockers in that note.
- Exit: no case replays through `legacy-headless`, `legacy-sdk` or `legacy-acp` without a recorded blocker, and `native-sdk` covers what `sdk-minimal` covered.

### Phase C — shed the Cordis skeleton

- The 23 classes split 15 and 8: fifteen already have a Native provider under the matching capability key, so their batch deletes a class and rewrites consumers; eight need a provider built first.
- Every batch makes the same three edits: publish the Service Definition as a capability key, register the Native Provider from `NativeContributions`, and move each consumer from `ctx.<name>` to `context.require('<key>')`.
- `TypertRemoteService` is the exception and belongs to Web: 23 classes extend it, half of them in `rsh/Programs/Web`, and no capability key replaces its Remote-method registration.

| Batch | Classes | Already provided | Consumer sites to rewrite |
|---|---|---|---|
| C1 session | 7 | 6, plus `sessionTelemetry` from `session-telemetry-otel` | 74 `ctx.sessions` |
| C2 llm | 2 | 1 (`TokenMeter`) | 19 `ctx.llm` |
| C3 agent, tools, prompt | 5 | 2 (`ToolResultPruner`, `CompactionEngine`) | 49 `ctx.tools`, 39 `ctx.agents`, 25 `ctx.systemPrompt` |
| C4 loop, context | 2 | 1 (`FileReferenceService`) | 23 `ctx.subagents`, 2 `ctx.agentLoop` |
| C5 Core leaves | 7 | 4 | 14 `ctx.jobs`, 39 `ctx.invariants`, 7 `ctx.storage`, 5 `ctx.typert` |

### Phase D — drain the remaining references

- 456 files import `@redspark/cordis` for types only. Each needs its declarations moved to the owning package or to a `./native` subpath, and the 25 imported names concentrate in `Context` (1153 sites) and `Service` (102).
- On 2026-11-12, 84 packages were `cordis-only`, 35 under `rsh/Programs/Web` and 20 under `rsh/Modules/Official`. The current grades are in [Cordis cleanup keeps the legacy writers and three packages](2026-11-15-cordis-cleanup-keeps-legacy-writers.md). D still follows whichever packages remain `cordis-only`.
- Exit: `@redspark/cordis` is imported only by `rsh/Core/vendor` and the two sanctioned hosting entries.

### Phase E — delete packages

- E1 is not a deletion. Those three packages still have no other manifest consumer, and [Cordis cleanup keeps the legacy writers and three packages](2026-11-15-cordis-cleanup-keeps-legacy-writers.md) keeps them.
- `Core/vendor` goes first or last and never in between: while any Cordis package survives, the vendored `Service`, `Context` and loader are its dependency.
- `dsh-python-runtime-closure` is the reverse checklist. Its workspace dependencies are the set the Python wheel ships, so a package absent from it needs a different justification than one present.
- Exit: no manifest declares `@redspark/cordis`, and build, typecheck, unit tests and keyless snapshot replay all pass.

### What the neighbouring notes still own

This route sits among four proposals rather than replacing them, so each keeps its own subject:

- [Legacy runtime retirement](2026-11-06-legacy-runtime-retirement.md) owns which profile shapes reach legacy and what becomes unreachable when they stop; phase A consumes its findings instead of restating them.
- [What still depends on Cordis](2026-11-10-what-still-depends-on-cordis.md) owns the per-package inventory and the capability gaps behind the unplayable scenarios; phases B, D and E read it as the running classification rather than holding a second copy.
- [Native runtime and optional Cordis](2026-09-22-rsh-native-runtime-and-optional-cordis.md) owns the P0–P6 construction route that built the Native runtime; phases A–E start after P5 and answer the deletion question that route left open.
- [Cordis cleanup keeps the legacy writers and three packages](2026-11-15-cordis-cleanup-keeps-legacy-writers.md) owns the 2026-11-15 execution hold: Desktop and Web stay, the three zero-consumer packages stay, and phase C does not start while those writers remain.

### Hard dependencies between phases

- A precedes B, B precedes C, C precedes D, D precedes E. Each phase's exit is the next phase's usable input, and inverting a pair means maintaining two compositions at once.
- Within E, E1 is not an independent deletion, E6 is first-or-last, and E5 breaks its edges explicitly instead of waiting for a cascade to reach them.
- Only B's snapshot batches and C's class batches can run in parallel; both land as separate PRs off freshly fetched `origin/main`.

## Alternatives considered

**Delete the vendored framework first and let the tree go red.** Rejected: the vendored `Service`, `Context` and loader are what 263 manifests depend on today, so an early deletion converts a working tree into a compile failure without teaching anything about the consumer surface.

**Migrate the skeleton by reference count alone.** Rejected as the only ordering signal: `ctx.invariants` looks small at 39 sites but is wired through 38 package-owned `invariant.ts` companions, and `ctx.sessions` leads at 74 sites while `SessionStore` already has a Native provider. The batch order weights provider availability as well as site count.

**Keep `NativeContext` as a Cordis facade and delete only `Service`.** Rejected: the facade would keep a Cordis `Context` alive, so the loader, the fiber tree and its teardown ordering would survive the deletion and the "no Cordis" claim would be false.

**Migrate by area — all of Core, then Engine, then Modules.** Rejected: a service is deleted when its last consumer moves, and consumers live across areas. Area order would leave every batch half-done and force a second pass over the same files.

## Acceptance criteria

- Phase A is done when every name in `dsh.nativeProfileTemplates` and every shipped alias boots Native, and a custom name that would need legacy is refused with a message naming `rsh/Docs/native-config-migration.md`.
- Phase B is done when no snapshot case replays through `legacy-headless`, `legacy-sdk` or `legacy-acp` without a recorded blocker, and `pnpm run test:snapshot` passes keyless.
- Phase C is done when `class <name> extends Service` matches nothing under `rsh/Core` or `rsh/Engine` outside `Core/vendor`, and no source file outside `Core/vendor` reads a Cordis service name.
- Phase D is done when `@redspark/cordis` is imported only by `rsh/Core/vendor` and the two sanctioned hosting entries.
- Phase E is done when no manifest declares `@redspark/cordis`, when `pnpm run build`, `pnpm run typecheck`, `pnpm run test` and `pnpm run test:snapshot` pass, and when `rsh/Docs/architecture.md` no longer describes a Cordis harness.

## Risks

- The skeleton is load-bearing for teardown. `NativeContext.own` and `ctx.effect` do not share an ordering guarantee, so a batch that swaps one for the other must carry a lifecycle fixture; otherwise the defect appears as a leak or a double close under load rather than as a test failure.
- Deleting a legacy half deletes its tests, which are the only behavioral record of that Cordis provider. Each batch carries the coverage forward or records the loss in the PR.
- `TypertRemoteService` has no Native successor and half its subclasses are in Web, so C cannot close until that Remote-method surface is designed.
- The three grades are a measurement, not a property: they were computed by resolving `exports` to `src`, so a package exporting only built `lib/` paths is misgraded, and the measurement is rerun after each phase.
