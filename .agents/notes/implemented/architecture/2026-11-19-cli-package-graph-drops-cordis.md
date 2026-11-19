# Agent Note: The shipped CLI package graph no longer reaches Cordis

Status: implemented

English | [中文](2026-11-19-cli-package-graph-drops-cordis.zh.md)

## Problem

`dsh` boots only Native profiles, but its manifest still described the Cordis application it no longer starts. `@redspark/cordis`, `cordis-plugin-loader`, and the seven `rsh/Compatibility/DSH/bundle` layers sat in `dependencies` or `optionalDependencies`, so `pnpm pack` still produced a CLI that carried a second application's composition. The Native profile rows added by the profile templates were declared optional, which made `verify-runtime-closure --target native-cli` report them as missing.

That guard is the Cordis-deletion guard: it walks the CLI manifest's required closure and rejects every Cordis package, so a green result is the evidence that the shipped launcher reaches no Cordis runtime. Before this change it reported nineteen diagnostics, mixing stale Cordis declarations with rows the Native profiles genuinely mount.

## Decision

The CLI manifest describes only the Native application. `@redspark/cordis` and `cordis-plugin-loader` leave both sections; the bundle layers leave `optionalDependencies`; `@redspark/rsh-app-boot` moves to `devDependencies` because only the `dsh-badge` Cordis snapshot fixture still boots through it.

Every package a Native profile row mounts is a hard `dependencies` entry: `rsh-request-context`, `rsh-session-telemetry`, `rsh-session-telemetry-otel`, `rsh-skill`, `rsh-skill-filesystem`, `rsh-terminal`, `rsh-terminal-bash`, `rsh-tool-bash-persistent`, `rsh-tool-pwsh-persistent`, and `rsh-tool-skill`. Reaching those rows also made `rsh-http-routes`, `rsh-invariants`, `rsh-scope`, and `rsh-system-prompt` required.

The browser client packages that export both faces declare `@redspark/cordis` as an optional peer. `rsh-client-resources`, `rsh-client-ui-brand-official`, `rsh-client-ui-input-trigger`, `rsh-client-ui-message-feedback`, `rsh-client-ui-model-selection`, `rsh-client-ui-open-in-app`, `rsh-client-ui-permission-presets`, `rsh-client-ui-pet`, `rsh-client-ui-plan`, `rsh-client-ui-reference`, and `rsh-client-ui-schedule` mount through their `./native` export in the Native profile; their Cordis entry imports at most the `Context` type, so the peer is not a packaging dependency. `rsh-host-open-in-app` treats `@redspark/cordis` and `@redspark/rsh-http-routes-cordis` the same way.

Those twelve packages join `mixedNativeEntryDirectories` because each ships a Cordis entry and a `./native` installer that mount the same implementation. Classifying them exposed four Cordis-free subpaths their native sources read: `rsh-file-reference/grammar` and `/types`, `rsh-session-reference/types`, `rsh-schedule/client`, and `rsh-host-open-in-app/shared`. Each is now declared in `nativeSafeSourceSubpaths`; every one carries types or pure formatting, and none imports Cordis.

`rsh-tool-skill` declares `rsh-agent` and `rsh-tools` as optional peers and records both in `nativeCompatibilityOnlyPeers`. Its `./native` entry builds registrations through `rsh-native-tools`; the two peers are value-imported only by the Cordis entry, so a Native install never needs them.

## Consequences

`verify-runtime-closure --target native-cli` reports one diagnostic instead of nineteen:

```
@redspark/rsh -> @redspark/rsh-scope -> required Cordis peer @redspark/cordis
```

The remaining diagnostic is the Cordis service face, not packaging drift. `rsh-scope` mints its contexts with `CordisContext` and reads `CordisContext.filter` at module scope, so it cannot declare the peer optional; it reaches the CLI through `native-persona` → `rsh-persona` → `rsh-system-prompt` → `rsh-scope`. Closing it requires a Native scope primitive that does not build on a Cordis `Context`, which is the service-skeleton phase.

The `rsh/Compatibility/DSH` tree stays. Its bundles are still the composition of the Desktop compatibility assembly, the browser compatibility application, and the WebWorker preview, so deleting the tree retires those three surfaces rather than removing dead code.

## Alternatives considered

**Declare the `rsh-scope` peer optional.** Rejected: `rsh-scope` is the scope primitive itself; its module scope constructs a Cordis context and reads `CordisContext.filter`, so the import is not a compatibility-entry detail that an optional peer can describe.

**Declare `rsh-agent` and `rsh-tools` optional without recording them.** Rejected: `verify-optional-dependency-imports` rejects an optional peer loaded at module scope by any source outside the Cordis-free closure, so both are recorded in `nativeCompatibilityOnlyPeers` to state that only `tool-skill`'s Cordis entry imports them.

**Ship `rsh-agent` and `rsh-tools` as CLI dependencies.** Rejected: both declare a required `@redspark/cordis` peer, so the Native closure would reach Cordis again; the packaging would be honest only after their Cordis halves exist.

**Delete `rsh/Compatibility/DSH` in this change.** Rejected: the Desktop compatibility assembly still resolves `@redspark/rsh-desktop-host-compatibility`, and `rsh/Tests/test-support/client-runtime` still composes the `rsh-base` and `rsh-web-app` rosters. Removing it is a product retirement of the Desktop legacy profile, the compatibility Web bundle, and the WebWorker preview, not a packaging edit.

## Verification

- `pnpm run verify-runtime-closure:native-cli` reports exactly the `rsh-scope` diagnostic above.
- `pnpm run verify-cordis-config` passes over 132 config files.
- `pnpm run verify-optional-dependency-imports` passes.
- `pnpm run verify-native-dependencies` and `pnpm run constraints` pass.
- `pnpm run typecheck` passes.
