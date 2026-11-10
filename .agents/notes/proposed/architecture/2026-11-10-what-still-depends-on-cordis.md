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

Deleting a package moves four things beyond its own directory, and each one fails a different gate: the `tsconfig.host.json` project reference (typecheck), the workspace lockfile (packed install), the group README row and any sibling README that links to it (translation pairing), and the reviewed `rsh/Docs/config-catalog.zh.md` counterpart of the generated catalog (documentation build, as a link to a source file that no longer exists). The first two catch a deletion locally; the last two only appear when the doc gates run, so a deletion is not finished until `verify-translation-pairing`, `verify-config-catalog` and the doc-site build pass.

A manifest is the fifth artifact, and the only one that breaks the packed lane: `rsh/Programs/CLI/package.json` may name a deleted package under `workspace:^`, and `pnpm pack` refuses to resolve a workspace protocol whose package is gone. Neither typecheck nor lint sees this, so the local check for a deletion is `pnpm --dir rsh/Programs/CLI pack`, which is also the fastest way to prove the lockfile and the manifest agree.

Seven generated or hand-maintained artifacts move: the package directory, the `tsconfig.host.json` project reference, the manifest's `workspace:^` lines and the lockfile, the README rows and links of every page that named it, the reviewed `config-catalog.zh.md` counterpart, the architecture pages (of which `module-graph.md` is generated and `event-producer-consumer.md` is hand-written), and `tsconfig.base.json`, whose package aliases are generated from the workspace. Four of the seven are generated and must be regenerated rather than edited: the config catalog, the module graph, the package aliases, and the workspace lockfile.

Guessing which gates to run does not work: each deletion so far surfaced a different one, and every miss cost a round-trip through CI. The reliable local sequence is to delete the files, remove the references, regenerate the generated pages (`gen-config-catalog`, `gen-module-graph`), re-record the pairs, and then run `pnpm run doc-sync` plus `typecheck` and `pnpm --dir rsh/Programs/CLI pack` as one batch — `doc-sync` is the aggregate that owns the catalog, link, graph, pairing and wrap gates together, so it reports all of them in one pass.

`agent-instructions` needs three things together: a workspace directory whose name contains `:` (Windows refuses to create it, verified directly), the `delimiter-path` workspace setup that builds that directory, and a compaction policy so the recorded overflow happens. A copied turn template supplies none of them, which is why the scenario is not migrated rather than skipped-and-claimed.

`session-query-spill` cannot be replayed as recorded: its bash step greps an absolute spill path under `/tmp/dsh-acp-snap-<random>`, which no fixture can predict, and the spill path is the subject of the assertion. A migration would have to rewrite the step to discover the path, which changes what the scenario proves.

## What retiring the templates actually requires

The six templates name seven bundle packages. Measured, they are not comparable in size: `base` declares **88** dependencies and `web-app` **86**, while `headless` has 6, `rsh` 10, `sdk-app` 4, `sdk-minimal` 27 and `acp-app` 3. `base` is shared by every template except `sdk-minimal`, so it is the layer that must go last.

The shipped Native profile composes **12 rows**, and only three of them name the same concerns as `base` at all. The other **85 packages `base` pulls in have no Native counterpart in the profile**: agent loop, system prompt, the tool presets, the command surface, the Web API and its client, and so on. A Native profile today is a headless skeleton, not a replacement for a full application bundle.

That makes deleting Cordis a product-level migration rather than a packaging step: each of those 85 either needs a Native form, must be deleted as dead, or must be declared out of scope because the application it serves is itself retired. The scenario work in this note is necessary but not sufficient, and the number that governs the plan is 85, not 6.

## The measured work behind the 88

That 85 figure is the gap between `base`'s dependency list and the 12 rows the shipped Native profile names, but it overstates the work. Measured against package manifests, **64 of `base`'s 88 packages already carry a `dsh.native` entry**. Only 24 do not, and they fall into four groups:

**Deletable as vendored Cordis.** `cordis-plugin-hmr` and `cordis-plugin-timer` are pinned Cordis sources with no Native form and no reason to acquire one.

**Already replaced, under a sibling name.** `rsh-agent`, `rsh-tools`, `rsh-subagent`, `rsh-tool-jobs` and `rsh-sandbox-policy` each have a `rsh-native-*` twin that the Native profile composes instead. These need their Cordis half deleted once nothing else imports it, not migrated.

**Genuinely unported, and the real target list.** `agent-loop`, `agent-default-model`, `llm`, `session`, `system-prompt`, `jobs-local`, `tool-present`, `session-checkpoint-policy`, `subagent-spawn-in-process`, `subagent-fork-in-process`, `user-approval`, `typert-loader`, `typert-registry` and the Web `api-gateway` have no Native counterpart. Some are already covered by a differently named Native package (`native-headless` owns the loop, `native-approval` owns approval), so each needs checking rather than porting blind.

**Compatibility bridges.** `compat-settings-adapters`, `plugin-host` and `subagent-acp` exist only to adapt Cordis; they disappear with it.

Checking the unported fourteen against the Native packages that exist resolves most of them:

- **Covered by a Native package under another name.** `agent-loop` is the loop inside `native-headless` (which provides `application` and `rootExecution`); `system-prompt` is `native-prompt` (provides `promptSections`); `session` and `llm` are the library halves the Native packages import directly; `user-approval` is `native-approval`; `subagent-spawn-in-process` and `subagent-fork-in-process` are providers `native-subagent` hosts. These need their Cordis half deleted once nothing imports it.
- **Truly unported and worth a decision.** `agent-default-model` (no Native consumer, already ruled out), `jobs-local`, `tool-present`, `session-checkpoint-policy`, `typert-loader`, `typert-registry` and the Web `api-gateway` have no Native counterpart. `tool-present` is an older presentation mechanism the Native tool registry supersedes; `typert-*` are the type registry, not runtime behaviour.

So the actionable remainder is roughly seven packages, each needing a one-line decision (delete as superseded, port, or declare out of scope), plus the deletions already identified. That is a list a person can finish; "85 packages" was not.

**None of those seven is deletable today, and the reason is the same for all of them: each is still imported.** Measured, `agent-default-model` has 6 importers, `api-gateway` 5, `typert-registry` 3, `jobs-local` and `tool-present` 2 each, and `session-checkpoint-policy` and `typert-loader` 1 each — and in every case at least one importer is the `base` bundle or a live Web/CLI package (`session-controller`, `webhook`, `sdk-runtime`). The two that earlier looked like dead code, `time-context` and `tmux-context`, differed in exactly this respect: nothing imported them.

Thirteen Cordis-only packages have no importer at all, and none of them is a free deletion either. `cordis-plugin-logger-console` is vendored Cordis source. Three are the `experimental/*` profiles and bundles, which are published artifacts no shipped profile happens to name. `storage-sqlite`, `tool-str-replace-editor` and `typert/generator` are documented, working seams — `storage-sqlite` appears in `capability-seams.md` as the example of a selectable backend, and the tool editor is registered in the generated tool catalog. `fs-e2b` and `subprocess-e2b` are the remote-execution adapters. The Python SDK runtime closure is a build artifact. Deleting any of them removes a capability that a consumer outside this repository could be selecting.

The bundles are layered, not independent: `headless` declares only 6 dependencies because it is a *patch over* `base` (`cordis.patch.yml` opens with "one-shot task mode directly over dsh-base" and adjusts three rows `base` already mounts). `web-app` has 86 of its own because it adds a whole Host and client. Taking one item from that list to resolution shows what the answer usually is. `session-checkpoint-policy` exists to flush the Session at three semantic boundaries: before a model request is dispatched, before a top-level tool body runs, and before the next step. `native-headless` already does all three itself — it appends `tool/call` and awaits `persist()` **before** invoking the body (line 1862 then 1864), persists the request prefix before dispatch, and persists at each step boundary. The separate Cordis plugin therefore has no Native counterpart because the Native loop inlined the guarantee rather than adopting it as a policy.

That is the pattern to expect for most of the list: not a port, but a decision that an existing Native package already owns the concern. It also means the count of real work falls each time an item is checked.

The next item checked, `tool-present`, does not resolve that way and is the first genuine port. It is a 109-line Cordis tool exposing `present`, the call that declares finished files as deliverables. **No Native profile composes it and no Native package implements it** — verified by searching for a `present` tool registration across `src` and for the row across every native test profile, both empty. It is portable in principle: it needs the scoped registry that already exists, plus two things the Native side does not expose — an open-turn boundary (it reads `sessionProjections.stateOf(session, 'turnBoundary')`) and the presented-files projection that the Web client renders. So the cost is the tool plus those two seams, not the 109 lines alone.

Two items checked, one resolved for free and one a real port. That ratio is the useful output of this round: the list is not uniformly hard, but it is not uniformly free either, and only checking each item tells which it is.

The third item, `typert-loader`, resolves to a third category: **it is Cordis-shaped by construction.** Its job is to watch Loader entries — it reacts to `internal/plugin` emissions, resolves each mounted entry's manifest, and withdraws registrations when the entry unmounts. The Native runtime has no Loader to watch, so nothing about it survives the deletion; the Native side contains zero references to `typert` at all. Its sibling `typert-registry` is likewise the reflection/RPC layer the Cordis Web API uses, and the Native Web host does not.

So the categories are three, not two: **already owned by a Native package** (`session-checkpoint-policy`), **portable with extra seams** (`tool-present`), and **Cordis-shaped, deleted with the runtime** (`typert-loader`, and its registry once the Cordis Web API is out of scope). `agent-default-model` turns out to belong to the first category rather than being an open question: it provides `agentDefaultModel`, which has **no runtime consumer in `rsh/Engine`** — only documentation, generator scripts and its own tests name it — while `native-model-selection` provides `modelSelection`, the service Native profiles actually compose. `compat-*` belongs to the third category. `jobs-local` is the fourth item and belongs to the first category: `native-jobs` already provides the `jobs` service, and the Native background-job scenarios exercised it — `background-job-admission` asserts the concurrency limit through it. The two implementations differ in size (311 lines against 496) because the Cordis one carries extra production-side bookkeeping, not because the Native one lacks the capability the seam promises.

That leaves one genuinely open item: the Web `api-gateway`, which is gated behind deciding whether the Cordis Web API is in scope at all.

So `base` is the layer every other template stands on, and it is the only one whose retirement actually means anything.

The Native side already demonstrates that the shape is achievable: `native-ptc` composes 19 real product rows — agent, tools, prompt, model execution, jobs, sandbox policy, subprocess, shell, bash tool, code runtime and session persistence — and runs a working agent. What it lacks is not depth but breadth: no system prompt identity beyond the prompt registry, no agent instructions, no attachments at startup, no command surface, no Web API. Those are the 24 packages.

That inverts the ordering the objective states. Step 4 cannot be finished before step 5, because a package stays alive as long as its bundle layer imports it, and the bundle layer stays alive as long as a profile template names it. The first real move is therefore to make a Native profile able to replace the `base` layer — which is the 85-package question — or to delete the consumers that are themselves out of scope (the Web API, the Python SDK runtime).

## The Web surface decides the endgame

**Five of the six Cordis template names already have a shipped Native composition.** `rsh/Programs/CLI/src/native-profile-template.ts` maps `headless` to `native-headless`, `web` to `native-web`, `sdk` to `native-sdk`, `acp` to `native-acp` and `rsh` to `native-tui`; only `sdk-minimal` has no counterpart. The CLI declares thirteen native templates in its manifest, and `native-web` ships its own client installations. So the step-5 work is not "build a Native Web profile" — that exists — but "retire the Cordis bundles that the same names still resolve to", and close `sdk-minimal`.

That distinction matters because the two readings imply very different remaining work, and the earlier reading in this note ("the Native Web path is built and never wired") was wrong: it is built *and* wired, and a Web e2e test composes it with twenty-four module links.

The earlier measurement still describes the package inventory, so it stays as the cost of the residual Cordis surface. Of the 75 packages under `rsh/Programs/Web`, **35 are Cordis-only, 33 already carry a `dsh.native` entry, and 7 neither**. The split matters: the client is already half migrated (27 native against 22 Cordis), while the API side is the reverse (2 native against 6 Cordis).

Decisively, `native-web-host` exists and is complete — it provides `nativeWebHost`, `hostConnection`, `httpRoutes` and `application` — but **nothing outside the package consumes it**. So the Native Web path is built and has never been wired into an application profile. Deleting Cordis outright therefore cannot happen before someone assembles a Native Web profile that composes `native-web-host` and the 27 migrated client packages, and ports or drops the remaining 28.

That is a product programme, not a cleanup step. It is also the honest boundary of this objective: steps 1 to 3 and the engine-side part of step 4 are done or measured, while step 5 depends on a Web decision the objective does not make.



- `verify-native-dependencies` passes at every step of the deletion.
- Each deleted package's remaining importers are named in the pull request that deletes it.
- `Programs/Web` is either migrated or explicitly recorded as out of scope, with the reason.
- No package outside `rsh/Compatibility` imports `@redspark/cordis` at the end.

## What the two driver-shaped scenarios actually need

`system-prompt-in-history` and `model-switch-notice` were both blocked for a stated reason that checking disproves. Neither needs a mid-turn driver. What they need is **a capability the Native runtime does not have**.

The first asserts that a route declaring `systemPromptUpdate: 'in-history'` appends a fresh `system/message` after cached history instead of replacing node 0 when the rendered prompt changes. `rsh-llm` resolves that flag on the route capability, but nothing read it in the Native loop, and the loop also rendered the prompt sections **once per run** rather than once per step. Both are now implemented: the step boundary re-renders the sections, and an in-history route appends the changed prompt instead of replacing the cached node. The scenario replays on a Native profile, which closed this item rather than recording it as blocked.

The second changes the selected model after a `todo_write` through `installModelSelection`, which is built entirely out of two Cordis waterfalls: `system-prompt/assemble` rewrites the provider and model variables, and `agent/request` rewrites the resolved call config. The Native loop has no equivalent seam — it reads each step's route from the `modelSelection` service, which requires `modelDirectory`, which the replay Provider does not provide and which a real one only supplies through a live provider catalog. Reproducing the recording on a Native profile therefore needs a Native model-directory fixture, not a driver port: the switching mechanism already exists, but its input cannot be supplied by replay alone.

Both are therefore recorded as blocked on runtime capability rather than on test infrastructure, which changes what unblocking them costs: it is loop work, and it must ship with its own scenario coverage, not as a fixture tweak.

`skill-load` is blocked by content, not by capability: its setup copies `agent-presets/presets/cordis/skills/editing-cordis-compositions/SKILL.md`, and that file no longer exists in the repository. The tool, the registry and the filesystem source all have Native entries and a migrated scenario composes and invokes them successfully — it answers that the skill is unknown, because the fixture it was recorded against was retired with the presets. Replaying it therefore needs a re-recording against a skill that still exists, not a Native port.

## Acceptance criteria

The proposals above are satisfied per package as each is resolved: a package that an existing Native package already owns needs its Cordis half deleted once nothing imports it; a `Cordis-shaped` package disappears with the runtime; a genuinely unported one gets a Native entry. The scenarios count when they replay on the Native profile in CI. The Web scope decision is recorded before any Web package moves.

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
