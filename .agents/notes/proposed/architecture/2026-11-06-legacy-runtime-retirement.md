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
| Neither runtime nor bundles | :40 | Refused with a loud error, not silently |

A missing manifest is **not** the same as an uninitialised profile in practice: `bin.ts:31-33` calls `ensureShippedNativeProfile` for every `profile` and `dump-config` invocation, which writes a manifest declaring `runtime: 'native'`. Every shipped template name therefore converges on Native on first use; the templates themselves are listed in the CLI manifest's `dsh.nativeProfileTemplates`, not only the five aliases `web`/`headless`/`sdk`/`acp`/`rsh`. The legacy population is what remains: a custom-named profile, whether written by one of the two commands below, by an older `dsh`, or by hand.

The `bundles` shape has two live producers in the current tree, both reached only by a non-standard profile name:

- `dsh --profile <name> --from-default-profile web` — `bin.ts` takes the non-native arm, `prepareProfile` calls `initializeProfileFromDefault` (`profile-boot.ts:197-198`), which writes the bundle template.
- `dsh plugin --profile <name> add <pkg>` — `plugin.ts:127-135` initialises the missing manifest from `PROFILE_TEMPLATES[profile]` or `DEFAULT_PROFILE_BUNDLES`.

Both call `initProfile`, which writes `dsh.profile: { runtime: 'legacy', bundles: [...], patchReload }` (`rsh/Compatibility/DSH/boot/app-boot/src/profile.ts:182`). A shipped name never reaches them, because `ensureShippedNativeProfile` writes a Native manifest first and each command refuses a Native profile. So the legacy population is exactly: a custom-named profile created through one of those two commands, plus any manifest written by hand or by an older `dsh`.

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

1. `initProfile` and the two commands that call it either write a Native manifest or stop writing profiles at all. Today they write `runtime: 'legacy'` with `bundles`, so this is the work the retirement starts with, not a fact to confirm.
2. Telemetry or a user report establishes that no active profile resolves `legacy`. A local check is `profileRuntime(name)` over the profiles under a real home.
3. `rsh/Docs/native-config-migration.md` documents what an old profile must become, including the plugin-set difference.

## Risks

- A user whose profile was created by `--from-default-profile` or `dsh plugin` under a custom name would lose it. Those are current commands, so the migration doc plus a refusal that names the profile and the file is the mitigation; a silent rewrite is not.
- Splitting `profile-boot.ts` touches the CLI's only remaining Cordis edge, so the split must land before any package deletion, and the deletion must be its own PR.
