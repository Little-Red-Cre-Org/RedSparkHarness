# Agent Note: Native Web profile packages and installation dependencies

Status: implemented

English | [中文](2026-10-06-native-web-profile-installation.zh.md)

## Problem

Native Web Client packages are selected from `dsh.native` profile rows, while the legacy browser module table loads `dsh.client` rows through a `./client` export. Treating a native-only package as a dynamic Client module invents a loader entry that has no consumer, and its published declarations can still fail for consumers when referenced workspace types remain only in development dependencies.

## Decision

The explicit `nativeProfileClientDirectories` set classifies `native-session` and `native-application` as native-profile Client packages. `verify-client-packages` accepts this mode only when the package selects the native Client target, exports `./native`, and declares neither `dsh.client` nor the `staticLinked` preset; `verify-native-dependencies` validates the selected native manifest and its source entry. The legacy module table continues to require a real `dsh.client` row and `./client` export.

`native-web-assets` reads each selected profile row, validates `dsh.native`, and resolves its `./native` export. `dev-web` keeps these package builds outside both the Cordis module-table roster and the statically linked shell-library roster.

Workspace packages referenced by published declaration files are listed in `publishedTypeDependencies` and installed as ordinary dependencies. Installing a dependency closes its declarations; it does not activate the dependency's `NativePlugin`, which runs only when selected by the native profile. Shared Client runtime values remain peers through `sharedClientRuntimePeers`; the dependency gate requires a real value import from the selected Client source files and the matching manifest peer, so type-only imports do not establish shared identity.

## Alternatives considered

Keeping `dsh.client` and adding a `./client` export was rejected because these packages have no legacy module-table consumer; that entry would expose an unrelated loader protocol. Removing `dsh.client` without a separate Client mode was rejected because the package-mode gate would classify the native packages as unsupported. Using peers for declaration-only relationships was rejected because those type providers do not need to share runtime value identity with their consumers. Treating Client runtime imports as Host export identities was rejected because the Host relay census must describe Host consumers only.

## Consequences

`native-session` declares its public declaration providers `native-runtime`, `client-connection`, `native-model-selection`, `agent-presets`, and `brand` as dependencies. `native-application` declares `native-runtime` and `client-native-session` as dependencies. Both packages remain selected through `dsh.native`; the `client-connection` provider's optional Cordis peer does not add a Cordis requirement to the native installer.

The existing [profile fallback decision](2026-09-25-profile-module-fallback-optional-dependencies.md) governs discovery of installed optional compatibility packages; this note governs published declaration closure for the native Web packages.

## Verification

A packed consumer with only `native-application` as a direct dependency installed with `autoInstallPeers: true`, compiled its public imports under strict NodeNext with `skipLibCheck: false`, and imported both the root and `./native` entries at runtime. Cordis was not installed or resolvable.

The paired package references are [native-session](../../../../rsh/Programs/Web/client/native-session/README.md) and [native-application](../../../../rsh/Programs/Web/client/native-application/README.md).
