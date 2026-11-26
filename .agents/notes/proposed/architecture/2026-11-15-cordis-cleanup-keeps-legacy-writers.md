# Agent Note: Cordis cleanup keeps the legacy writers and three packages

Status: proposed

English | [中文](2026-11-15-cordis-cleanup-keeps-legacy-writers.zh.md)

> **2026-11-22 update.** Phase A is closed: `dsh` boots no Cordis manifest, and no snapshot or CLI test creates `legacy-headless`, `legacy-sdk`, or `legacy-acp`. Desktop boots a Native profile only, and `dsh` rejects `--profile web` and `--from-default-profile web`. The compatibility assembly is not a retained writer. What remains is recorded in [Desktop is the only independent product entry](2026-11-22-desktop-product-boundary.md): Cordis Web bundles, `profile: web` snapshots, Typert Remote Web, and the other entries there. The count table below is the 2026-11-15 measurement, not a current census. See [Desktop-only retires the browser Web deployment](../../implemented/architecture/2026-11-21-desktop-only-retires-browser-web.md) and [Cordis-only gates follow the Native boot](../../implemented/bug-fix/2026-11-21-cordis-only-gates-follow-the-native-boot.md).

> **2026-11-24 update.** No snapshot selects `profile: web`; the browser scenario lane is retired by [One Native Web scaffold for the remaining browser scenarios](2026-11-24-native-web-scaffold-and-scenario-migration.md). Statements below about remaining `profile: web` snapshots describe the 2026-11-15 state. Cordis Web bundles and Typert Remote Web remain.

## Problem

[Retiring Cordis in five measured phases](2026-11-12-cordis-retirement-five-phases.md) is still the deletion route. Two package-deletion instructions stay unsafe: `@redspark/rsh-storage-sqlite` and `@redspark/rsh-experimental-inspector` are not deletable merely because no other manifest depends on them. The Agent Teams web profile is already deleted. Phase A is closed, Desktop boots a Native profile only, and the supported browser launch is rejected. Cordis bundles, `profile: web` snapshots, and Typert Remote Web remain, so phase C and phase E stay unstarted.

## Proposal

Keep the five-phase order. Do not delete Cordis, `rsh/Core/vendor`, or the Core and Engine `Service` classes in this decision. The 2026-11-15 review fixes what may be done before phase C.

### What stays

- Fresh Desktop profiles write `runtime: 'native'` through `createNativeDesktopProfile` in `rsh/Programs/Desktop/src/project-manager.ts`. `applyRelease` still migrates an unmodified Desktop starter to Native by calling `createNativeDesktopProfile` when `isLegacyStarterProfile` is true. The recognized starter's bundle list is `@redspark/rsh-base` and `@redspark/rsh-web-app`. Explicit `runtime: 'legacy'` and other custom Cordis profiles are rejected with the retired-assembly error and are not rewritten. `prepareProfile` does not start a non-Native directory. `initProfile` in `rsh/Compatibility/DSH/boot/app-boot/src/profile.ts` still writes `dsh.profile.bundles` and does not set `runtime: 'native'`; the CLI does not boot that manifest. Snapshots with `profile: web`, and production classes that extend `TypertRemoteService`, stay until the retirement recorded in the 2026-11-22 inventory. That retirement has to replace or delete the remote-method registration before phase C can finish.
- Two of the three packages stay. `@redspark/rsh-experimental-inspector` is excluded from the `dsh` release family and still has its own tests. `@redspark/rsh-storage-sqlite` remains a selectable storage backend; its Native installer, recorded in [Native capability owners](../../implemented/architecture/2026-11-16-native-capability-gaps.md), shares that backend and does not delete the package. [What still depends on Cordis](2026-11-10-what-still-depends-on-cordis.md) already separates these cases from a package nothing can select. The Agent Teams web profile is no longer among them: [Agent Teams retires its Cordis surface](../../implemented/architecture/2026-11-18-agent-teams-retires-its-cordis-surface.md) deletes it with the two sibling composition packages once the Team service becomes Native-only.
- `initProfile` (`rsh/Compatibility/DSH/boot/app-boot/src/profile.ts`) still writes `dsh.profile.bundles` and `patchReload` for the Cordis launcher tests. The CLI copies a shipped Native template for `--from-default-profile` and refuses a manifest that does not select Native execution. `prepareProfile` does not start a non-Native directory. `applyRelease` still migrates an unmodified Desktop starter through `createNativeDesktopProfile`, and it does not rewrite explicit `runtime: 'legacy'` or other custom Cordis profiles. `web` and `sdk-minimal` are refused names. [What the legacy Cordis runtime still holds](2026-11-06-legacy-runtime-retirement.md) forbids changing `initProfile` while an active home resolves `web` or `desktop` as legacy. Desktop and the CLI do not resolve those names as legacy. Changing the function still waits for the Cordis deletion.

### What was re-measured

263 manifests declare `@redspark/cordis` in `dependencies`, `optionalDependencies`, `peerDependencies`, or `devDependencies`. Each concrete `exports` subpath and each `bin` entry was mapped from `lib/` or `lib/types/` to a `src` file. `./src/*`, `./package.json`, and YAML exports were not entries. From each mapped file, static relative imports and `@redspark/*` imports were followed. The walk reaches Cordis when it finds `@redspark/cordis`, `@redspark/cordis-*`, `@cordisjs/*`, or `cordis`. Generated `./typert` and `./remote` files that exist only under `lib/` stayed unmapped. Core and Engine still have 23 `class … extends Service` declarations outside `rsh/Core/vendor`, tests, and fixtures.

| Check | Count |
|---|---|
| Manifests that declare `@redspark/cordis` | 263 |
| `.ts` and `.tsx` files under `rsh/` outside `node_modules`, `lib`, and `dist` that contain `@redspark/cordis` | 1279 |
| `class … extends Service` in `rsh/Core` and `rsh/Engine`, outside vendor, tests, and fixtures | 23 |
| `snapshot.yml` files with `profile: legacy-headless` | 6 |
| `snapshot.yml` files with `profile: legacy-sdk` | 9 |
| `snapshot.yml` files with `profile: legacy-acp` | 8 |
| `snapshot.yml` files with `profile: web` | 34 |
| `snapshot.yml` files with `profile: headless` | 80 |
| Packages whose mapped entries all reach Cordis (`cordis-only`) | 75 |
| Packages with both a reaching entry and a Cordis-free entry (`mixed`) | 176 |
| Packages whose mapped entries stay off Cordis (`native-clean`) | 10 |
| Packages with no mapped code entry (`unresolved`) | 2 |

The 75 `cordis-only` packages include 21 under `rsh/Compatibility/DSH`, 12 under `rsh/Programs/Web`, 7 under `rsh/Modules/Official`, and 6 under `rsh/Core/vendor`. `native-clean` means only that every mapped entry stayed off Cordis. It does not mean the manifest declaration is unused. A text search of `.ts`, `.tsx`, `.mts`, `.mjs`, `.js`, `.yml`, and `.yaml` files, excluding `package.json`, `node_modules`, `lib`, and `dist`, found mentions in 258 of the 263 packages. `@redspark/rsh-native-jobs-controller` is not in that set: it is a native package and does not declare Cordis. [Cordis replay stops when the Native replay passes](../../implemented/testing/2026-11-14-cordis-replay-stops-when-native-passes.md) records why the six `legacy-headless` directories, the remaining `legacy-sdk` directories, and `legacy-acp` stay. The 2026-11-12 counts 84, 169, and 10 are not the current grades. Counts in the table above are the 2026-11-15 measurement. The current `profile: web` count is 32 and is listed in the 2026-11-22 inventory.

### What stays declared

`@redspark/rsh-native-jobs-controller` is on the native roster and does not declare `@redspark/cordis`. Five packages still have no mention outside `package.json`. They are not one safe edit.

- `@redspark/rsh-compat-fs-local`, `@redspark/rsh-compat-fs-policy`, `@redspark/rsh-compat-fs-sandbox`, and `@redspark/rsh-llm-mock-server` are `@redspark/rsh-*` libraries outside `nativePackageDirectories`. `checkCordisPeerPolicy` in `rsh/Scripts/check-workspace-constraints.ts` requires `@redspark/cordis` as both a peer dependency and a dev dependency. Removing the declaration fails that check. `@redspark/rsh-native-jobs-controller` is in `nativePackageDirectories`, so that rule forbids the declaration instead.
- `dsh-python-runtime-closure` (`rsh/Programs/SDK/python/sdk-runtime`) is the Python wheel deploy root. It also depends on `@redspark/rsh-cordis-host-runner` and `@redspark/rsh-tool-cordis`. Removing `@redspark/cordis` would change the wheel. [Retiring Cordis in five measured phases](2026-11-12-cordis-retirement-five-phases.md) keeps that closure as the reverse checklist.
- `rsh/Core/vendor` stays. The 23 Core and Engine `Service` classes stay. `rsh/Programs/Desktop/src/project-manager.ts` stays and writes Native profiles. `@redspark/rsh-storage-sqlite` and `@redspark/rsh-experimental-inspector` stay. `--from-default-profile` copies a shipped Native template. It does not create `legacy-headless`, `legacy-sdk`, or `legacy-acp`.

### What this decision does not start

Phase C and phase E do not start. `rsh/Core/vendor` stays while any package still imports `@redspark/cordis`. The two hosting entries `rsh/Core/runtime-diagnostics/cordis-bridge` and `rsh/Engine/preset/native-persona` stay with it. Do not port `cordis_define`, `cordis_undefine`, or `cordis_inspect_query`. Do not delete their three scenarios ahead of `@redspark/rsh-tool-cordis`.

## Alternatives considered

**Refuse every new custom legacy profile.** The CLI already does this. The 2026-11-15 rejection assumed snapshot runners and CLI tests still created `legacy-headless`, `legacy-sdk`, and `legacy-acp` with `--from-default-profile`. They do not. That refusal is not a reason to keep a Desktop legacy writer.

**Delete the packages that no other manifest depends on.** Rejected. A missing manifest dependency is not the absence of a capability. The storage backend is selectable and the inspector package still has tests. The Agent Teams web profile is deleted later for a different reason: its runtime surface no longer exists, not because nothing depended on it.

**Start phase C now that `prepareProfile` does not start a non-Native directory and the CLI refuses a non-Native manifest.** Rejected. Typert classes and the Cordis Web bundles still remain. Deleting the `Service` classes first leaves those bundles and the `profile: web` snapshots without the types they boot. Phase C stays unstarted.

**Remove every declaration that no other file names.** Rejected for the packages that remain. Four are required by `checkCordisPeerPolicy`. `dsh-python-runtime-closure` ships the dependency in the Python wheel. `@redspark/rsh-native-jobs-controller` is the exception: its source does not reach Cordis, and the native roster forbids the declaration.

## Acceptance criteria

- [Retiring Cordis in five measured phases](2026-11-12-cordis-retirement-five-phases.md) no longer says the three packages can be deleted now, and its 84 / 169 / 10 grade table is marked as the 2026-11-12 measurement.
- `initProfile` documents that a new manifest stores `dsh.profile.bundles` and does not set `runtime: 'native'`.
- No package directory is removed by this decision. Fresh Desktop profiles still write `runtime: 'native'`. `applyRelease` still migrates an unmodified Desktop starter to Native through `createNativeDesktopProfile`. Explicit `runtime: 'legacy'` and other custom Cordis profiles are rejected with the retired-assembly error and are not rewritten. `prepareProfile` does not start a non-Native directory.
- `@redspark/rsh-native-jobs-controller` does not declare `@redspark/cordis`. The other no-mention packages stay declared.

## Risks

- An export walk can call a package `native-clean` while `checkCordisPeerPolicy` still requires the Cordis peer. Deleting from the export grade alone fails the workspace check or drops a legacy plugin host.
- `--from-default-profile` copies a shipped Native template. A Cordis profile directory is refused by the Native boot check. The remaining risk is deleting bundles, `profile: web` snapshots, or Typert before the 2026-11-22 inventory's preconditions are true.
