# Native Session approval scope

These unedited screenshots show the shipped `dsh --profile native-web` CLI, its real authenticated Host, the shipped Native Client roster and official Playwright Chromium. The Host selects the shipped fs-sandbox provider in workspace-write mode. The model is a local deterministic fixture; no API key or paid model call is used.

The browser starts one turn containing two file writes with equal parameters in different object-key order. It sends one real authenticated `session/answer-human` Host request with `{ kind: 'approval', outcome: 'allowed-session' }`, using the live Session, admission and presentation identities. The current approval buttons remain unchanged; the screenshot's Allow once button is not used to choose the Session grant.

Before the Host answer:

![Native pending approval](native-grant-pending.png)

After the Host answer, both writes complete without a second human answer:

![Native completed writes](native-grant-completed.png)

The actual third model request contains two successful tool results. The durable log contains one remembered grant and two allowed decisions; the second decision adds no new grant. The actual `approved.txt` bytes match the independent [workspace oracle](../../../snapshots/web/native-session-grant/workspace.expected/approved.txt). The browser reports no page errors or alerts. [browser-result.json](browser-result.json) contains the local run's minimal result without authentication values or local user paths.

The [recorded Session](../../../snapshots/web/native-session-grant/session.v3.jsonl), prompt/schema sidecars and workspace oracle are the keyless replay inputs and expected outputs. Only the exact durable grant fingerprint receives an `approval-scope` identity token; distinct raw fingerprints remain distinct tokens. The real HTTP fixture separately checks nine distinct raw fingerprints and original Session identity retention across cold restore and fork.

Reproduce after a normal Node 24 build with official Playwright Chromium installed:

```powershell
$env:DSH_SNAPSHOT='replay'
pnpm exec vitest run --config vitest.web.config.ts rsh/Programs/Web/application/tests/native-session-grant.e2e.ts --retry=0
```

Set `DSH_SESSION_GRANT_EVIDENCE` to a private output directory during replay to capture the two PNGs. Replay compares the recorded Session and does not rewrite it. Capture base: `2e55ca187716ceb69bfc5f2fab1532d1f1ab80b8`; current images are recaptured with the shipped fs-sandbox chain after the identity repair below.

## Sandbox target identity repair

Review of old head `fe2d4a7fc5c6162e85d2ed99cdc9828aa17c407f` found that the shared sandbox fence re-resolved `displayPath` and returned a new target for mutation. A local backend-only probe captured an absent file under the first workspace directory, rebound its alias to the second directory, and wrote the second target through the original FsTarget. [sandbox-target-proof.json](sandbox-target-proof.json) records that result and the repaired result without local user paths. This is local deterministic Native backend evidence, not an independent cloud or HTTP reproduction.

The shared fence still checks fresh containment. A changed `targetKey` now rejects with the existing `FS_STALE_VERSION`; an unchanged identity returns the original FsTarget. The same probe after repair rejects and creates neither file. The HTTP fixture and real CLI/browser fixture both select the shipped fs-sandbox provider with the Native workspace-write policy. The existing HTTP scope case covers both present-file rebinding and two absent targets, asserting stale errors and no redirected write; the ordinary original-target writes and remembered reuse still succeed.

Focused repair validation runs the three real HTTP cases with existing Native and Cordis sandbox tests: 26/26 pass. The one obsolete Cordis case that expected mutation of a fresh substituted target now expects stale rejection and zero writes. It is the only additional existing test case changed for this shared policy correction; this repair changes five formal scenarios in total, without adding a test framework. Real sandbox CLI recording and replay each pass 1/1. Old-head green CI does not validate this correction.

Evidence scope: three new authenticated HTTP scenarios cover scope changes, missing/incomplete context, one-call escalation, cold restore/fork/new Session isolation, policy precedence and grant decision flush failure. A direct Registry assertion covers delegated candidate exclusion. The ten existing approval service unit tests remain unchanged. One new real CLI browser scenario owns recording and replay. Complete delegated entry approval behavior is not claimed by the new Registry check.

## Validation

Node `24.14.1`, pnpm `11.28.5`, official Playwright Chromium; normal hooks remain enabled. [results.json](results.json) preserves both full runs and their separate comparisons.

The current sandbox repair's complete `check:all` run reports **54 passed, 7 failed and 0 skipped in 1210.22 seconds**. Unit tests report **131 failed, 22625 passed, 1 expected fail and 100 skipped** across 22857 tests; 47 files fail, 1388 pass and 10 skip. Snapshot tests report **72 failed, 95 passed and 10 skipped** across 177 tests; 11 files fail and 31 pass. Expected-output tests report **4 failed and 31 passed** across 35 tests; 3 files fail and 10 pass. The seven failed gates are client domain graph, test, duplication, test:snapshot, test:expected, client UI i18n and module graph. Build, Web build, doc typecheck, documentation build, translation pairing, export JSDoc and persistence catalog pass in this same full run. The local raw log is `output/playwright/grant-sandbox-full-checks.log`; it is retained locally rather than publishing local user paths and unrelated raw output.

An additional paired unit comparison selects **11 files** containing additional failure headers in this repair's full run. Its independently built exact-main baseline reports **527 passed, 30 failed and 9 skipped** across 566 tests. The proposal runs those same files plus the five owning files and reports **595 passed, 30 failed and 9 skipped** across 634 tests. All 30 failed cases match; the selected comparison has zero proposal-only failures. The 68 owning tests pass. This subset does **not** classify all 131 full-run unit failures, and the full run remains unsuccessful. The exact selected files and common cases are recorded in `sandboxRepair.narrowUnitComparison` in results.json. The earlier snapshot, expected-output and structural comparisons below remain earlier evidence; no new complete paired full suite is claimed.

The original pre-repair `check:all` run reports 53 passed, 8 failed and 0 skipped in 1170.96 seconds. Its introduced persistence-catalog failure was repaired by the official generator; that gate, export JSDoc, all 35 doc-sync gates, all 45 original owning runtime tests and the original browser replay passed afterward. The original eight-failure result is retained.

Actual repair validation commands from the repository root, with the Node 24 build environment shown below:

```powershell
pnpm run lint
# After correcting the two fixture indentation errors reported above:
pnpm run lint:contracts-ready
pnpm exec vitest run rsh/Programs/Web/api/native-web-session-controller/tests/session-grant.host.spec.ts rsh/Modules/Official/fs/fs-sandbox/tests/native.spec.ts rsh/Modules/Official/fs/fs-sandbox/tests/fs-sandbox.spec.ts --maxWorkers=1 --retry=0 --reporter=json --outputFile=output/playwright/grant-sandbox-repair-focused-final.json
$env:DSH_SNAPSHOT='record'
pnpm exec vitest run --config vitest.web.config.ts rsh/Programs/Web/application/tests/native-session-grant.e2e.ts --retry=0
$env:DSH_SNAPSHOT='replay'
pnpm exec vitest run --config vitest.web.config.ts rsh/Programs/Web/application/tests/native-session-grant.e2e.ts --retry=0
Remove-Item Env:DSH_SNAPSHOT
pnpm run check:all
$comparison=Get-Content -Raw .github/pr-evidence/native-session-grant/results.json | ConvertFrom-Json
$repairFiles=$comparison.sandboxRepair.narrowUnitComparison.files
$owningFiles=$comparison.sandboxRepair.narrowUnitComparison.owningFiles
# Baseline checkout, with comparison loaded through its absolute grant-checkout path:
pnpm exec vitest run @repairFiles --maxWorkers=1 --retry=0 --reporter=json --outputFile=output/playwright/grant-sandbox-extra-base.json
# Proposal checkout:
pnpm exec vitest run @repairFiles @owningFiles --maxWorkers=1 --retry=0 --reporter=json --outputFile=output/playwright/grant-sandbox-extra-proposal.json
```

Original grant and persistence-catalog repair commands from the repository root:

```powershell
$env:NODE_OPTIONS='--max-old-space-size=4096'
$env:VCToolsVersion='14.44.35207'
$env:DSH_OXLINT_THREADS='2'
$env:DSH_GATE_CONCURRENCY='1'
pnpm run build
pnpm run lint
pnpm run check:all
pnpm run gen-persistence-catalog
pnpm run verify-translation-pairing --write rsh/Docs/persistence-catalog.md
pnpm run verify-persistence-catalog
$env:DSH_DOC_TYPECHECK_USE_BUILD_OUTPUT='1'
pnpm run doc-sync
pnpm run verify-export-jsdoc
pnpm exec vitest run rsh/Programs/Web/api/native-web-session-controller/tests/session-grant.host.spec.ts rsh/Modules/Official/interaction/native-approval/tests/native.spec.ts rsh/Engine/core/native-headless/tests/native.spec.ts --maxWorkers=1 --retry=0 --reporter=json --outputFile=output/playwright/grant-owning-regression-final.json
$env:DSH_SNAPSHOT='replay'
pnpm exec vitest run --config vitest.web.config.ts rsh/Programs/Web/application/tests/native-session-grant.e2e.ts --retry=0
```

Baseline comparisons use an independently built, clean checkout at `2e55ca187716ceb69bfc5f2fab1532d1f1ab80b8` with its own dependencies. The following commands reproduce the exact selected file sets from `results.json`; on the baseline, read that file through its absolute path in the grant checkout. Paid-provider credentials are absent and there is no API-key `.env` file in either checkout.

```powershell
$comparison=Get-Content -Raw .github/pr-evidence/native-session-grant/results.json | ConvertFrom-Json
$unitFiles=$comparison.unitComparison.files
pnpm exec vitest run @unitFiles --maxWorkers=1 --retry=0 --reporter=json --outputFile=output/playwright/grant-baseline-unit-failures.json
pnpm exec vitest run @unitFiles rsh/Programs/Web/api/native-web-session-controller/tests/session-grant.host.spec.ts rsh/Modules/Official/interaction/native-approval/tests/native.spec.ts rsh/Engine/core/native-headless/tests/native.spec.ts --maxWorkers=1 --retry=0 --reporter=json --outputFile=output/playwright/grant-proposal-paired-unit.json
$snapshotFiles=$comparison.snapshotComparison.files
$env:DSH_EXAMPLE_MODE='lib'
$env:DSH_SNAPSHOT='replay'
pnpm exec vitest run --config vitest.snapshot.config.ts @snapshotFiles --maxWorkers=1 --retry=0 --reporter=json --outputFile=output/playwright/grant-baseline-snapshot.json
$expectedFiles=$comparison.expectedComparison.files
pnpm exec vitest run --config vitest.expected.config.ts @expectedFiles --maxWorkers=1 --retry=0 --reporter=json --outputFile=output/playwright/grant-baseline-expected.json
pnpm exec vitest run rsh/Modules/Official/attachment/attachment-local/tests/request-image.spec.ts rsh/Scripts/benchmark-npm-resolution.spec.ts --maxWorkers=1 --retry=0 --reporter=json --outputFile=output/playwright/grant-isolated-proposal.json
pnpm exec vitest run --config vitest.snapshot.config.ts rsh/Programs/Web/application/tests/minimal-preset.snapshot.ts snapshots/native-tui/commands-presets.snapshot.ts snapshots/native-tui/native-tui.snapshot.ts snapshots/native-tui/preset-controls.snapshot.ts --maxWorkers=1 --retry=0 --reporter=json --outputFile=output/playwright/grant-proposal-snapshot-differences.json
```

The 45-file paired unit comparison records 100 failures on each side and 99 common cases. The proposal-only image-cache rename `EPERM` reproduces on main in isolation; proposal isolation passes. Both isolated npm benchmark runs pass. This does not classify every one of the 122 original full-run unit failures as baseline. The failed snapshot subset reproduces 70 failures on main, including the two minimal-preset cases. The three full-run TUI differences pass narrow replay on both sides. The four expected-output failures reproduce on main. Domain-graph and UI-i18n failures, 90 duplication clones, and the same three stale module-graph documents also reproduce on main. Those unrelated modules remain unchanged.
