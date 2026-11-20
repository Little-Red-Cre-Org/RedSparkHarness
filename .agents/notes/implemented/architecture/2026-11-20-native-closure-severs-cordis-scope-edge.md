# Agent Note: The Native CLI closure stops at the Cordis scope edge

Status: implemented

English | [中文](2026-11-20-native-closure-severs-cordis-scope-edge.zh.md)

## Problem

`verify-runtime-closure --target native-cli` ended on one diagnostic: `@redspark/rsh -> @redspark/rsh-scope -> required Cordis peer @redspark/cordis`. The edge looked like a missing Native scope primitive, because `rsh-scope` is the registration and scoped-dispatch primitive every Cordis registry uses.

The chain was entirely compatibility-face: `rsh-native-persona` -> `rsh-persona` -> (required peer) `rsh-system-prompt` -> (required peer) `rsh-scope` -> (required peer) `@redspark/cordis`. `rsh-persona`'s Native entry imports only `@redspark/rsh-system-prompt/sections`, which is two constants; `rsh-system-prompt` already exposes that subpath as Cordis-free in `nativeSafeSourceSubpaths`. `rsh-client-file-upload` reached `rsh-scope` the same way: its Cordis entry imports `scopeOf`, while its `./native` entry installs the background worker.

## Decision

No new Native primitive. `@redspark/rsh-native-runtime` already owns `NativeScope`, and no native entry closure imports `@redspark/rsh-scope`; a second implementation would have no consumer.

`rsh-system-prompt` and `rsh-client-file-upload` mark `@redspark/rsh-scope` as an optional peer, record it in `nativeCompatibilityOnlyPeers`, and add the Client package to `OPTIONAL_NATIVE_HOST_PEERS` so the published-dependency policy admits the optional peer. `@redspark/rsh-scope` leaves the CLI manifest, so the shipped launcher no longer installs the Cordis scope primitive.

## Consequences

`verify-runtime-closure --target native-cli` passes: 13 profile templates and 274 workspace packages form a closed, Cordis-free dependency graph. The Python runtime closure and the Cordis configuration gate are unchanged.

`rsh-scope` stays in the workspace and keeps its required Cordis peer. It remains reachable from the compatibility tree, whose registries still depend on its scope-tag and dispatch-filter behavior. It leaves the product only when that tree is retired.

## Alternatives considered

**Build a Native scope primitive.** Rejected: `NativeScope` already provides visibility scoping for Native registries, and a Cordis-shaped replacement would exist only to satisfy a dependency edge that nothing Native evaluates.

**Mark `rsh-scope`'s own Cordis peer optional.** Rejected: `rsh-scope` constructs a Cordis context and reads `CordisContext.filter` at module scope; its root is the Cordis primitive.

**Move `rsh-scope` out of the CLI by deleting it.** Rejected: the compatibility registries still import it, and the compatibility tree is not part of this change.

## Verification

- `pnpm run verify-runtime-closure:native-cli` passes with 274 packages.
- `pnpm run verify-runtime-closure` (Python runtime) passes with 149 packages.
- `pnpm run verify-native-dependencies`, `verify-optional-dependency-imports`, and `constraints` pass.
- `pnpm run verify-cordis-config` passes over 132 config files.
- `pnpm run typecheck` and `pnpm run lint` pass.
