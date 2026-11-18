# Agent Note: Cordis cleanup keeps the legacy writers and three packages

Status: proposed

English | [中文](2026-11-15-cordis-cleanup-keeps-legacy-writers.zh.md)

## Problem

[Retiring Cordis in five measured phases](2026-11-12-cordis-retirement-five-phases.md) is still the deletion route, but three of its near-term instructions are unsafe on the current tree. It treats `@redspark/rsh-storage-sqlite`, `@redspark/rsh-experimental-inspector`, and `@redspark/rsh-experimental-agent-team-web-profile` as deletable because no other manifest depends on them. It also cannot close phase A by refusing every new custom legacy profile: the remaining Cordis replays and the CLI tests create `legacy-headless`, `legacy-sdk`, and `legacy-acp` with `--from-default-profile`. Desktop still writes a legacy manifest, so removing that writer would strand the desktop app before the Web migration exists.

## Proposal

Keep the five-phase order. Do not delete Cordis, `rsh/Core/vendor`, or the Core and Engine `Service` classes in this decision. The 2026-11-15 review fixes what may be done before phase C.

### What stays

- Fresh Desktop profiles and unmodified legacy starters write `runtime: 'native'` through `createNativeDesktopProfile`. An explicit `runtime: 'legacy'` profile and a custom Cordis profile stay bootable when the compatibility host is present. Snapshots with `profile: web`, and production classes that extend `TypertRemoteService`, stay until a separate UI migration. That migration has to replace the remote-method registration before phase C can finish.
- Two of the three packages stay. `@redspark/rsh-experimental-inspector` is excluded from the `dsh` release family and still has its own tests. `@redspark/rsh-storage-sqlite` remains a selectable storage backend; its Native installer, recorded in [Native capability owners](../../implemented/architecture/2026-11-16-native-capability-gaps.md), shares that backend and does not delete the package. [What still depends on Cordis](2026-11-10-what-still-depends-on-cordis.md) already separates these cases from a package nothing can select. The Agent Teams web profile is no longer among them: [Agent Teams retires its Cordis surface](../../implemented/architecture/2026-11-18-agent-teams-retires-its-cordis-surface.md) deletes it with the two sibling composition packages once the Team service becomes Native-only.
- `initProfile` (`rsh/Compatibility/DSH/boot/app-boot/src/profile.ts`) still writes `dsh.profile.bundles` and `patchReload`. A bundle list selects legacy execution. Custom names still initialize through `--from-default-profile`, and an existing legacy directory still boots. Shipped names still boot Native. `sdk-minimal` stays refused. [What the legacy Cordis runtime still holds](2026-11-06-legacy-runtime-retirement.md) still forbids changing `initProfile` while an active home resolves `web` or `desktop` as legacy.

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

The 75 `cordis-only` packages include 21 under `rsh/Compatibility/DSH`, 12 under `rsh/Programs/Web`, 7 under `rsh/Modules/Official`, and 6 under `rsh/Core/vendor`. `native-clean` means only that every mapped entry stayed off Cordis. It does not mean the manifest declaration is unused. A text search of `.ts`, `.tsx`, `.mts`, `.mjs`, `.js`, `.yml`, and `.yaml` files, excluding `package.json`, `node_modules`, `lib`, and `dist`, found mentions in 258 of the 263 packages. `@redspark/rsh-native-jobs-controller` is not in that set: it is a native package and does not declare Cordis. [Cordis replay stops when the Native replay passes](../../implemented/testing/2026-11-14-cordis-replay-stops-when-native-passes.md) records why the six `legacy-headless` directories, the remaining `legacy-sdk` directories, and `legacy-acp` stay. The 2026-11-12 counts 84, 169, and 10 are not the current grades.

### What stays declared

`@redspark/rsh-native-jobs-controller` is on the native roster and does not declare `@redspark/cordis`. Five packages still have no mention outside `package.json`. They are not one safe edit.

- `@redspark/rsh-compat-fs-local`, `@redspark/rsh-compat-fs-policy`, `@redspark/rsh-compat-fs-sandbox`, and `@redspark/rsh-llm-mock-server` are `@redspark/rsh-*` libraries outside `nativePackageDirectories`. `checkCordisPeerPolicy` in `rsh/Scripts/check-workspace-constraints.ts` requires `@redspark/cordis` as both a peer dependency and a dev dependency. Removing the declaration fails that check. `@redspark/rsh-native-jobs-controller` is in `nativePackageDirectories`, so that rule forbids the declaration instead.
- `dsh-python-runtime-closure` (`rsh/Programs/SDK/python/sdk-runtime`) is the Python wheel deploy root. It also depends on `@redspark/rsh-cordis-host-runner` and `@redspark/rsh-tool-cordis`. Removing `@redspark/cordis` would change the wheel. [Retiring Cordis in five measured phases](2026-11-12-cordis-retirement-five-phases.md) keeps that closure as the reverse checklist.
- `rsh/Core/vendor` stays. The 23 Core and Engine `Service` classes stay. `rsh/Programs/Desktop/src/project-manager.ts` stays. The three retained packages stay. `--from-default-profile` stays, because the remaining replays and CLI tests still create `legacy-headless`, `legacy-sdk`, and `legacy-acp`.

### What this decision does not start

Phase C and phase E do not start. `rsh/Core/vendor` stays while any package still imports `@redspark/cordis`. The two hosting entries `rsh/Core/runtime-diagnostics/cordis-bridge` and `rsh/Engine/preset/native-persona` stay with it. Do not port `cordis_define`, `cordis_undefine`, or `cordis_inspect_query`. Do not delete their three scenarios ahead of `@redspark/rsh-tool-cordis`.

## Alternatives considered

**Refuse every new custom legacy profile now.** Rejected. The snapshot runners and the CLI end-to-end tests create `legacy-headless`, `legacy-sdk`, and `legacy-acp` with `--from-default-profile` for each run. Refusing that class of name deletes the remaining Cordis evidence before the recorded blockers move.

**Delete the packages that no other manifest depends on.** Rejected. A missing manifest dependency is not the absence of a capability. The storage backend is selectable and the inspector package still has tests. The Agent Teams web profile is deleted later for a different reason: its runtime surface no longer exists, not because nothing depended on it.

**Start phase C while an explicit legacy profile still boots.** Rejected. Those profiles boot the `Service` classes phase C would remove. Deleting the classes first leaves a Cordis Desktop profile that neither runtime can start.

**Remove every declaration that no other file names.** Rejected for the packages that remain. Four are required by `checkCordisPeerPolicy`. `dsh-python-runtime-closure` ships the dependency in the Python wheel. `@redspark/rsh-native-jobs-controller` is the exception: its source does not reach Cordis, and the native roster forbids the declaration.

## Acceptance criteria

- [Retiring Cordis in five measured phases](2026-11-12-cordis-retirement-five-phases.md) no longer says the three packages can be deleted now, and its 84 / 169 / 10 grade table is marked as the 2026-11-12 measurement.
- `initProfile` documents that a new manifest stores `dsh.profile.bundles` and does not set `runtime: 'native'`.
- No package directory is removed by this decision. Fresh Desktop profiles still write `runtime: 'native'`, and an explicit legacy profile is not rewritten.
- `@redspark/rsh-native-jobs-controller` does not declare `@redspark/cordis`. The other no-mention packages stay declared.

## Risks

- An export walk can call a package `native-clean` while `checkCordisPeerPolicy` still requires the Cordis peer. Deleting from the export grade alone fails the workspace check or drops a legacy plugin host.
- A person can still create a Cordis profile with `--from-default-profile`. That is the retained path for the remaining replays and tests, not a silent rewrite of an existing directory.
