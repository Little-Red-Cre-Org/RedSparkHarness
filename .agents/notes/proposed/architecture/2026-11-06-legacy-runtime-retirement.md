# Agent Note: What the legacy Cordis runtime still holds, and what retires with it

Status: proposed

English | [中文](2026-11-06-legacy-runtime-retirement.zh.md)

## Problem

Every shipped `dsh` command — `web`, `headless`, `sdk`, `acp`, `rsh` — now writes a Native profile first and launches through the Native boot path. The legacy Cordis path is still reachable, and it is reachable by *user data*, not by a flag: `resolveRshProfileExecution` reads the profile's own `package.json` and returns `legacy` for three shapes of manifest. Those profiles keep working, so nothing on the legacy side can be deleted until that population is known to be empty.

This note records what the branch decided to keep, what a retirement would have to change, and what would then become unreachable. It deletes nothing.

## Proposal

### Who still runs legacy, and why

`resolveRshProfileDirectoryExecution` (`rsh/Core/util/home-paths/src/profile-runtime.ts`) returns `legacy` for:

| Manifest state | Line | Reached by |
|---|---|---|
| No `package.json` | :31 | A profile directory someone created by hand |
| `dsh.profile.runtime: 'legacy'` | :46 | An explicit opt-out |
| `dsh.profile.bundles: [...]` | :39 | The pre-Native profile format |
| Neither runtime nor bundles | :46 | Refused with a loud error, not silently |

A missing manifest is **not** the same as an uninitialised profile in practice: `bin.ts:31-33` calls `ensureShippedNativeProfile` for every `profile` and `dump-config` invocation, which writes a manifest declaring `runtime: 'native'`. So the five standard names converge on Native on first use. The legacy population is therefore: profiles with a non-standard name and no manifest, plus any manifest that names `bundles` or `runtime: 'legacy'`.

The `bundles` shape has no shipped producer. `rsh/Compatibility/DSH/bundle/*` are bundle *packages* (`cordis.patch.yml` plus `lib/`), not profile manifests; the only manifests in the repository that declare `bundles` are test fixtures (`rsh/Programs/CLI/tests/built-bin.e2e.ts`). A `bundles` profile in the wild was written by an older `dsh`, by `dsh plugin` under a legacy CLI, or by hand.

### The call sites a retirement would change

`bin.ts` branches three times on `profileRuntime(...) === 'native'`; each legacy arm would go:

| Mode | Legacy arm | What replaces it |
|---|---|---|
| `profile` (:49-58) | `requireCompatibilityRuntime()` then `runProfile()` from `profile-boot.ts` | A refusal naming `rsh/Docs/native-config-migration.md` |
| `plugin` (:67-69) | `runPlugin()` from `plugin.ts` | The existing Native refusal at :65 already covers this |
| `dump-config` (:83-90) | `runDumpConfig()` from `dump-config.ts` | The Native branch at :76-81 already answers |

`plugin.ts` and `dump-config.ts` both import from `profile-boot.ts`, but only for pieces Native also needs: `INSTALL_ANCHOR` (the CLI package root) and `prepareProfile`/`homePatchPath`/`PROFILE_ROOT_FILENAME`. A retirement splits `profile-boot.ts` rather than deleting it: the Cordis `runProfile` composition and `healProfilesModuleFallback` go, the path and anchor helpers stay or move.

### What becomes unreachable

- `compatibility-runtime.ts` — its only callers are the three legacy arms.
- The Cordis half of `profile-boot.ts` (`composeProfile`, `runProfile`, the loader plumbing).
- **The `bundles` grammar itself**, which is the point: `resolveRshProfileDirectoryExecution`'s `bundles` branch and its `patchReload` validation exist only to serve profiles that predate Native.
- Every `@redspark/rsh-*app`/`base` bundle in `optionalDependencies` whose only consumer is a legacy composition.

Deleting those packages is a separate, larger decision: the CLI declares them as optional dependencies so that a legacy profile can resolve them, and a Native profile resolves its own package set instead.

## Alternatives considered

**Make every profile Native on sight.** Rejected as a retirement step: rewriting a user's `package.json` from `bundles` to `runtime: 'native'` would silently replace a Cordis composition with a Native one, and the two do not contain the same plugins. A migration command that reports the difference is a separate proposal.

**Delete the legacy packages now and let old profiles fail.** Rejected: it converts a working profile into a startup error with no warning, which is the failure mode [the fail-loud rule](../../../../AGENTS.md) permits only when the alternative is silent breakage — not when the profile still works.

**Keep the legacy path forever behind the same switch.** Rejected: `compatibility-runtime.ts` exists to give one clear installation remedy; if the path is permanent it also permanently pins the Cordis bundle set, the `bundles` grammar, and every optional dependency that only a bundle resolves.

## Acceptance criteria

Retirement may start only when all of these hold:

1. No released `dsh` version writes a `bundles` manifest. Verify by reading the last few releases' `PROFILE_TEMPLATES` and `initProfile` history.
2. Telemetry or a user report establishes that no active profile resolves `legacy`. A local check is `profileRuntime(name)` over the profiles under a real home.
3. `rsh/Docs/native-config-migration.md` documents what an old profile must become, including the plugin-set difference.

## Risks

- A user whose profile was created by an old `dsh` and never re-run would lose it. The migration doc plus a refusal that names the profile and the file is the mitigation; a silent rewrite is not.
- Splitting `profile-boot.ts` touches the CLI's only remaining Cordis edge, so the split must land before any package deletion, and the deletion must be its own PR.
