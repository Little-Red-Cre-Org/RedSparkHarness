# Agent Note: Admit Cordis-free leaf packages to the strict native roster

Status: implemented

English | [中文](2026-10-08-cordis-free-leaf-packages.zh.md)

## Problem

The [compatibility inventory](2026-10-01-cordis-compatibility-inventory.md) classified eleven packages as `migration-required` although their production sources import nothing from Cordis. The workspace dependency policy still required a matching Cordis peer and development dependency for every package outside the strict native roster, so these packages declared a framework peer they never load. Native consumers of those libraries inherited an unused Cordis requirement, and the inventory could not distinguish them from packages that still implement Cordis plugins.

## Decision

Add `dsh-chunked-list`, `dsh-deque`, `dsh-package-manifest`, `dsh-util-time` and `dsh-client-ui-dockkit` to `nativePackageDirectories` in `native-package-policy.ts`, and remove `@deepseek-ai/cordis` from their `peerDependencies` and `devDependencies`. None of the five has a workspace dependency outside the admitted native graph, and none of their tests imports Cordis. The four Core utilities use the default Host and Client compiler faces; `dsh-client-ui-dockkit` uses the default Client face for Web Client packages. Their exports, entries, bundles and behavior are unchanged, and no `dsh.native` installer is added because none of them registers a service.

The remaining six packages stay outside the roster:

- `dsh-typert-generator` projects Cordis service and event declarations into catalogs; its tests import and augment `@deepseek-ai/cordis`, and its development dependencies include legacy packages outside the native graph.
- `dsh-fs-e2b` and `dsh-host-directory-picker-native` default-export subclasses of legacy services (`FileSystem` from `dsh-fs`, `DirectoryPicker` from `dsh-host-directory-picker`), so they remain Cordis plugins through those packages, and their specs construct a Cordis `Context`.
- `dsh-experimental-agent-team-profile` and `dsh-experimental-agent-team-web-profile` publish `cordis.patch.yml` bundle layers consumed by the Cordis Include loader and depend on experimental Cordis plugins.
- `dsh-python-runtime-closure` is the dependency-only deploy root of the Python runtime wheel; it declares Cordis and Loader packages in `dependencies` because the wheel ships the legacy `sdk` profile.

## Alternatives considered

**Make the Cordis peer optional instead of removing it:** The inventory counts optional Cordis peers as Cordis requirements, and an optional peer on a package that never loads Cordis still documents a dependency that does not exist.

**Convert all eleven packages:** Removing the peer from the six retained packages would leave real Cordis runtime or test requirements undeclared, or misclassify Cordis compositions as framework-free.

## Consequences

Native and compatibility consumers import the same five modules without installing Cordis, and `verify-package-dependencies`, `check-workspace-constraints` and `verify-native-dependencies` now reject any Cordis declaration or import added to them. The inventory's `migration-required` count falls from 159 to 154 and its `native-migrated` count rises from 62 to 67. The six retained packages become migration candidates only after their legacy service bases or bundle formats gain native replacements.

## Verification

The compatibility inventory reports the five packages as `native-migrated`. The package dependency, workspace constraint and native dependency gates pass with the packages in the strict roster, and the packages' own specs and the specs of their Web and Engine consumers pass unchanged.
