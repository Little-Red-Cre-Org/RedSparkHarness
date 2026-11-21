# Agent Note: Cordis-only gates follow the Native boot

Status: implemented

English | [中文](2026-11-21-cordis-only-gates-follow-the-native-boot.zh.md)

## Problem

`dsh` boots only Native profiles: `rsh/Programs/CLI/src/bin.ts` reads a `rsh.profile.json` composition and refuses a Cordis `bundles` manifest with `does not exist or does not select Native execution`. Three checks kept assuming the retired path.

`rsh/Tests/benchmarks/agent-continuation/profile-continuation.worker.ts` wrote a `bench-minimal` profile declaring `dsh.profile.bundles: ['@redspark/rsh-sdk-minimal']` and launched it through the built `dsh`. The CLI refuses that manifest, so the `profile-continuation` scenario of `check:ci:bench` could not pass. It was last edited before the legacy boot path retired.

`rsh/Programs/SDK/python/sdk/tests/test_bundled_runtime.py` built a `legacy-sdk` profile from `@redspark/rsh-base` and `@redspark/rsh-sdk-app` and asserted that a missing patch entry surfaced. The CLI now rejects the profile before any patch is read, so the case either skipped or failed for a reason unrelated to its assertion.

`rsh/Scripts/verify-runtime-closure.ts` still listed `rsh/Programs/CLI/src/bin.ts` importing `@redspark/rsh-app-boot`, an edge the launcher no longer has. The guard could not fail.

## Decision

Retire the two cases whose subject is the Cordis boot, and drop the stale guard row.

The `profile-continuation` scenario measured end-to-end SDK continuation through the `sdk-minimal` Cordis bundle. That bundle is a retirement candidate, the profile it needs cannot boot, and a Native replacement would measure a different launch path with its own calibration. The scenario, its worker, its synthetic `LlmAdapter`, and their build entries go; a Native profile-launch benchmark is a separate measurement rather than a silent repoint.

The Python case loses its only meaning once the CLI refuses a `bundles` manifest. `test_bundled_runtime_boots_the_sdk_profile` and `test_python_sdk_applies_an_ordered_profile_patch` keep covering both carriers.

## Alternatives considered

**Repoint the benchmark at the Native `sdk` template.** Rejected in this change: the synthetic model is a Cordis `LlmAdapter` registered on `ctx.llm`, and the Native model seam runs through `native-model-execution`. Porting it needs a Native scripted provider plus a fresh reference-machine calibration, which would replace the measured subject rather than repair it.

**Keep the Python case and assert the new refusal.** Rejected: the refusal is already covered by `smoke-python-runtime.py`, and the case's recorded premise, that a legacy carrier resolves its patch graph, no longer exists.

**Leave the stale guard row.** Rejected: a guard that can never match reads as coverage for an edge the tree no longer has.

## Consequences

`check:ci:bench` keeps three calibrated scenarios instead of four. The `agent-continuation` README no longer advertises an SDK profile variant, and the workload constants it used stay because the remaining scenarios share them.

No Cordis package becomes deletable: the bundles, `rsh-app-boot`, and `rsh-cmdline` are still composed by the in-process Web scaffold described in [Retiring Cordis in five measured phases](../../proposed/architecture/2026-11-12-cordis-retirement-five-phases.md).

## Verification

- `pnpm run typecheck`
- `pnpm run verify-runtime-closure:native-cli` (13 templates, 274 packages)
- `npx vitest run rsh/Scripts/verify-runtime-closure.spec.ts` (9 tests)
