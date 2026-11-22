# Agent Note: Darwin seatbelt realpath and the unit-step build

Status: implemented

English | [中文](2026-11-22-darwin-seatbelt-realpath-and-build.zh.md)

## Problem

On darwin, `os.tmpdir()` spells a directory as `/var/folders/...` and `realpath` spells the same directory as `/private/var/folders/...`. `relative` and prefix checks treat those spellings as unrelated.

`rsh/Scripts/coalesce-staged-dsh-tools.ts` compares the staging root from `resolve` with the package directory ESM resolution already realpathed. `packageDirectoryForUrl` then reports that the staged package has no package directory beneath the staging root. The same split reaches Vite: `collectShell` passes a non-real shell root into `vite.build`, while Vite realpaths inputs and alias targets.

`rsh/Programs/Desktop/src/main.ts` calls `app.setPath('userData', desktopUserDataPath())` while the module is loading. The desktop startup spec's paths mock exports only `resolveDesktopPaths`, and its fake `app` has `getPath` and no `setPath`, so the import throws before any case runs.

`.github/workflows/sandbox.yml` runs the unit suite on the seatbelt leg only. `pnpm test` is `pnpm run build:native-system && vitest run` and does not emit gitignored `lib/`. Imports of built `lib/types` fail on that runner. The job's 20-minute budget does not cover install, a repository build, the full unit suite, and the two-file kernel e2e.

## Decision

`resolveDirectory` applies `realpathSync.native` to an existing path and keeps the `resolve` spelling for `ENOENT` and `ENOTDIR`. Windows lowercasing still applies after that. `isWithin` compares those spellings, so the staging root and the resolved package share one prefix. Distinct directories stay distinct.

`collectShell` realpaths the repository root before `browserSourceAliases`, realpaths the shell root passed to `vite.build`, and realpaths each existing input after resolving a relative input against that shell root. An absolute alias `replacement` that exists and contains no `$` is realpathed. `loadConfigFromFile` still receives the config directory it loaded.

The desktop startup spec's paths mock exports `desktopUserDataPath: () => 'desktop-test-user-data'` and does not call `resolveRshHome`. The fake `app` provides `setPath: vi.fn()`. `main.ts` and `paths.ts` are unchanged.

On `matrix.runner == 'seatbelt'`, the sandbox workflow runs `pnpm run build` immediately before `pnpm run test`. bwrap and landlock do not. The `test` script is unchanged. The job `timeout-minutes` is 60. Neither the job nor the unit step sets `continue-on-error`, and the step does not narrow or skip files. `rsh/Scripts/ci-workflow.spec.ts` asserts that order, the missing `continue-on-error`, and the 60-minute budget.

## Alternatives considered

**Realpath only one side.** Rejected: ESM resolution and Vite already realpath one side, and a prefix check still fails while the other side stays on `/var`.

**Rewrite assertions to the `/var` spelling.** Rejected: the two spellings name one directory. Recording `/var` in the assertion would preserve the mismatch instead of comparing the directories the probes resolved.

**Delete or skip TUI or Typert.** Rejected: both belong to the unit suite the seatbelt leg runs. Skipping them would leave those imports unexecuted.

**Fold `pnpm run build` into `pnpm test` for every OS.** Rejected: `pnpm test` stays `pnpm run build:native-system && vitest run`. Other unit lanes already obtain `lib/` from their own build steps, and a build inside every `pnpm test` would repeat that work.

**`continue-on-error` on the unit step.** Rejected: a failing unit suite must fail the seatbelt job. The kernel e2e stays behind that result. A timeout is a failure, not a skip.

## Consequences

Darwin prefix checks in the staged-tools coalesce and the browser shell walk compare one directory spelling, and the desktop startup spec can load `main.ts`. The seatbelt job spends a 60-minute budget on a real `lib/` build, the full unit suite, and the two-file kernel e2e.

Path spelling, the desktop startup mock, and that `lib/` build are the defects this decision closes. Other unit failures remain in the suite. The e2e step has no `continue-on-error`, and `pnpm test` still does not emit `lib/`.
