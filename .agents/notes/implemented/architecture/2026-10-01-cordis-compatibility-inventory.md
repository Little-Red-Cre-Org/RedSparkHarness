# Agent Note: Cordis compatibility inventory and Loader/HMR baseline

Status: implemented

English | [中文](2026-10-01-cordis-compatibility-inventory.zh.md)

## Problem

The native runtime migration needs a current, reviewable boundary for Cordis and DSH usage. A package manifest alone cannot distinguish production compatibility code, native packages that still have legacy edges, and test-only Loader compositions. Loader, Include, HMR, and unload behavior also needs one evidence-backed baseline so the compatibility module does not silently become a second native authority.

## Decision

`rsh/Scripts/compatibility-inventory.ts` is the B1/B2 inventory authority. It combines the compiler-face source import graph with workspace manifests and reports every package that declares a Cordis/DSH dependency, has a direct Cordis source use, or is covered by the native package policy. Each row is classified as `native-migrated`, `native-mixed`, `framework-free`, `compatibility-retained`, `test-tooling`, or `migration-required`. Rows preserve package versions, roles, capabilities, native entries and targets, legacy main entries, Client platforms, and each Cordis dependency's section, range, and optional status. Production and test Cordis uses are counted separately; `--uses` prints file, line, compiler face, import kind, and symbols; `--json` returns the structured observations.

The baseline records four compatibility capabilities: Cordis Loader activation and Fiber disposal, Include YAML composition and patch layering, file/config HMR refresh, and compatibility-plugin ownership and unload. Their evidence and tests remain under `Core/vendor`, `Compatibility/DSH`, and the filesystem Consumer's real Loader composition. Native installation plans and `NativeContext` disposal are separate mechanisms; the inventory does not treat the Cordis Loader or HMR implementation as native runtime code.

The report identifies policy-owned native exports separately from the remaining legacy graph, including mixed package subpaths. `framework-free` means no direct production Cordis use or declared production Cordis requirement; it does not certify the transitive dependency closure. Native replacement and automatic delivery of changed module code or Client compositions need evidence through their own application launchers. Cordis HMR tests cannot certify those mechanisms. Compatibility adapters may consume native services, but they cannot create a second Agent, Session, or Tools authority.

The first compatibility scope is the Host filesystem family exposed by [compat-dsh-runtime](../../../../rsh/Compatibility/DSH/bridge/compat-dsh-runtime/README.md): selected legacy filesystem Providers, observation policy, sandbox policy adaptation, and filesystem tools contributing to native registries. This scope preserves native approval and sandbox decisions and rejects changed declarations or unsupported configuration. It excludes arbitrary plugins, complete legacy application bundles, Client compatibility, and native profile HMR; Cordis Loader/HMR baseline evidence does not establish support for those paths.

The checkout's Cordis manifest selects `4.0.2`; the bridge validates major version 4, rather than promising that every major-4 release has been tested. Each selected DSH adapter validates its required runtime role and capability before mounting. Package versions and dependency ranges come from the generated inventory; npm versions, native API revisions, and Session format versions are separate authorities.

## Alternatives considered

**Maintain a manually edited package list:** Rejected because package manifests do not reveal source-level type/value imports, and the list would drift as migration changes land.

**Classify every DSH package as native:** Rejected because a `dsh.native` declaration does not remove a remaining Cordis edge; the report must expose the migration work still required.

**Move Loader/HMR into the native Core:** Rejected because those implementations own Cordis configuration and Fiber semantics. Native replacement requires its own installation, replacement, and quiescence contract.

## Consequences

`pnpm exec tsx rsh/Scripts/compatibility-inventory.ts` gives maintainers one repeatable B1/B2 report and fails if its evidence paths disappear; append `--uses` when a reviewer needs each file, line, face, and imported symbol. The report is intentionally a current-state diagnostic rather than a completion claim: `migration-required` rows and the native HMR gap remain visible until their source and tests change. The script reuses the source graph authority, so native Cordis boundary findings remain governed by `verify-native-dependencies`.

## Verification

The inventory tests cover classification, production versus test uses, optional and development requirements, plugin entry metadata, and missing source or regression evidence. `pnpm exec tsx rsh/Scripts/compatibility-inventory.ts --uses` generates the file-level report from the current checkout. Counts include observations repeated across compiler faces; the report is regenerated after migration changes instead of treating a recorded count as an acceptance criterion.

The five baseline suites pass 59 tests under `pnpm exec vitest run rsh/Compatibility/DSH/bridge/compat-plugin-host/tests/plugin-host.spec.ts rsh/Compatibility/DSH/boot/app-boot/tests/config-reload.spec.ts rsh/Compatibility/DSH/boot/app-boot/tests/hmr-config.spec.ts rsh/Compatibility/DSH/boot/app-boot/tests/user-patches.spec.ts rsh/Modules/Official/fs/tool-fs/tests/runtime-loader-composition.spec.ts --reporter dot`. They exercise Loader startup failure, transactional replacement and rollback, patch layering, filesystem watchers, asynchronous teardown, cancelled or competing HMR owners, and real filesystem tool configuration and release on Windows. The baseline does not claim Linux/macOS evidence or native profile replacement support.
