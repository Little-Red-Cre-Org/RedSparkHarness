# Agent Note: Native Web profile packages and installation dependencies

Status: implemented

English | [中文](2026-10-06-native-web-profile-installation.zh.md)

## Problem

Native Web Client packages are selected from `dsh.native` profile rows, while the legacy browser module table loads `dsh.client` rows through a `./client` export. Treating a native-only package as a dynamic Client module invents a loader entry that has no consumer, and its published declarations can still fail for consumers when referenced workspace types remain only in development dependencies.

## Decision

The explicit `nativeProfileClientDirectories` set classifies `native-session` and `native-application` as native-profile Client packages. `verify-client-packages` accepts this mode only when the package selects the native Client target, exports `./native`, and declares neither `dsh.client` nor the `staticLinked` preset; `verify-native-dependencies` validates the selected native manifest and its source entry. The legacy module table continues to require a real `dsh.client` row and `./client` export.

The publication invariant scanner follows helper identifiers only when they are named bindings imported from the canonical `tsdown.client.ts` module. It reads literal emitted-path lists from `clientOnly` and `staticLinkedLeaf` wrappers; a same-spelling local helper cannot claim files for the package payload. The optional-dependency source scan accepts a local CSS import only when the referenced asset exists.

The SDK loader fixture returns the async `tool-subagent` compatibility installer from its `ctx.inject()` callback. Cordis waits for that Promise before reporting the Agent-scoped plugin ready and rolls back its effects if startup fails; dropping the Promise lets startup race the lazy import and hides its rejection from the plugin fiber.

Loader-managed declarative fresh agents wait for the public `loader.await()` when session persistence has not mounted. After the tree settles, a selected Provider acquires its write handle before the Agent is published; a successful tree without one remains memory-only, while a failed tree reports startup failure. Omitted `sessionId` still creates a fresh random identity, and a supplied stable id keeps its resume-or-create behavior. Direct Context compositions without Loader retain their immediate mount-order behavior.

`native-web-assets` reads each selected profile row, validates `dsh.native`, and resolves its `./native` export. `dev-web` keeps these package builds outside both the Cordis module-table roster and the statically linked shell-library roster.

Workspace packages referenced by published declaration files are listed in `publishedTypeDependencies` and installed as ordinary dependencies. Installing a dependency closes its declarations; it does not activate the dependency's `NativePlugin`, which runs only when selected by the native profile. Shared Client runtime values remain peers through `sharedClientRuntimePeers`; the dependency gate requires a real value import from the selected Client source files and the matching manifest peer, so type-only imports do not establish shared identity.

## Alternatives considered

Keeping `dsh.client` and adding a `./client` export was rejected because these packages have no legacy module-table consumer; that entry would expose an unrelated loader protocol. Removing `dsh.client` without a separate Client mode was rejected because the package-mode gate would classify the native packages as unsupported. Using peers for declaration-only relationships was rejected because those type providers do not need to share runtime value identity with their consumers. Treating Client runtime imports as Host export identities was rejected because the Host relay census must describe Host consumers only.

Inferring a build helper from its spelling instead of its imported binding was rejected because a local decoy or unrelated module must not expand the published payload. Ignoring unresolved CSS imports was rejected because a missing local asset leaves emitted browser code incomplete.

## Consequences

`native-session` declares its public declaration providers `native-runtime`, `client-connection`, `native-model-selection`, `agent-presets`, and `brand` as dependencies. `native-application` declares `native-runtime` as a dependency for published declarations, and `client-native-session` as a shared Client peer plus a development dependency because its Settings page imports `NativeSessionRpcError` at runtime and must resolve the same constructor as the selected Consumer. Both packages remain selected through `dsh.native`; the `client-connection` provider's optional Cordis peer does not add a Cordis requirement to the native installer.

The existing [profile fallback decision](2026-09-25-profile-module-fallback-optional-dependencies.md) governs discovery of installed optional compatibility packages; this note governs published declaration closure for the native Web packages.

## Verification

A fresh consumer installed five selected native packages and their packed dependency closure with `autoInstallPeers: true` and no workspace packages. Strict NodeNext typechecking passed with `skipLibCheck: false`; Node imported the four Host native entries, while the Client entry typechecked separately. Cordis was neither installed nor resolvable. Pnpm reported failed optional-peer lookups for four native packages that returned registry 404s, while the same packages resolved from their local tarballs on required dependency paths.

The paired package references are [native-session](../../../../rsh/Programs/Web/client/native-session/README.md) and [native-application](../../../../rsh/Programs/Web/client/native-application/README.md).
