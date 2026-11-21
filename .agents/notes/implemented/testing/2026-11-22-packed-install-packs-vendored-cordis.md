# Agent Note: Packed-install packs vendored Cordis

Status: implemented

English | [中文](2026-11-22-packed-install-packs-vendored-cordis.zh.md)

## Problem

`rsh/Modules/Official/sandbox/sandbox-local/tests/packed-install.e2e.ts` installs the publish tarballs for `@redspark/rsh-sandbox-local` into an external npm consumer. `consumer.mjs` and `rsh/Modules/Official/sandbox/sandbox-local/src/index.ts` both import `Context` from `@redspark/cordis`.

`packedWorkspaceClosure` in `rsh/Modules/Official/sandbox/sandbox-local/tests/packed-workspace-closure.ts` follows `workspace:` dependencies, `optionalDependencies`, and required peers. It skips optional peers. `@redspark/cordis` is an optional peer of `@redspark/rsh-sandbox-local`, `@redspark/rsh-sandbox`, `@redspark/rsh-session`, `@redspark/rsh-llm`, and `@redspark/rsh-attachment`, so the walk from `@redspark/rsh-sandbox-local` does not pack it. `@redspark/rsh-sandbox` requires `@redspark/rsh-session`. The packed set has no tarball that satisfies that Cordis peer.

This rehearsal cannot treat that omission as a successful install. `consumer.mjs` imports `@redspark/cordis`. An installer that still resolves the missing optional peer exits `ERESOLVE`: the failure node has no `version`, so the report names `@redspark/cordis@undefined`. An installer that skips the missing peer leaves the same import unresolved.

## Decision

Only this rehearsal adds vendored `@redspark/cordis`. After `packedWorkspaceClosure`, `packed-install.e2e.ts` reads the workspace inventory and, when the closure has no `@redspark/cordis`, appends the package whose directory is `rsh/Core/vendor/cordis`. If that directory is absent from the inventory, the rehearsal throws. The package version is `4.0.2`, and its `files` list includes `lib/index.js`.

`packedWorkspaceClosure` still skips optional peers. The Native packed consumer in `rsh/Programs/Web/client/web/tests/built-native-consumer.e2e.ts` installs through that walk and requires `node_modules/@redspark/cordis` to be absent. [Native browser exports install without Cordis](../process/2026-09-23-native-browser-export-dependency-closure.md) owns that evidence.

Cordis's only workspace dependency is `@redspark/cosmokit`, which `@redspark/schemastery` already brings in through a required dependency. The rehearsal does not pack Cordis's optional peers `@redspark/cordis-plugin-include` and `@redspark/cordis-plugin-loader`. It still filters `@redspark/node-addon-system*` out of this list and packs the Landlock entry through `pack-release.mjs`.

## Alternatives considered

**Follow optional peers inside `packedWorkspaceClosure`.** Rejected. The Native packed consumer depends on the skip. Following every optional Cordis peer would put `@redspark/cordis` into consumers that must install without it.

**Rely on an npm that ignores a missing optional peer, or pass `--legacy-peer-deps` or `--force`.** Rejected. Those choices avoid installing the vendored tarball. `consumer.mjs` still imports `@redspark/cordis`.

**Give `dsh-packed-consumer` a `version` so the install report does not print `@undefined`.** Rejected. The consumer manifest has no `version`, and that print is not the missing tarball. A version does not install Cordis.

**Pack `@redspark/cordis-plugin-include` and `@redspark/cordis-plugin-loader` with Cordis.** Rejected. They are optional peers of Cordis, the consumer does not import them, and `@standard-schema/spec` stays a registry dependency.

## Consequences

The sandbox-local packed-install rehearsal satisfies the Cordis import from the vendored `4.0.2` tarball. That Native packed consumer still omits Cordis, because `packedWorkspaceClosure` still skips optional peers. The rehearsal does not extend `packable` to `rsh/Core/vendor/cordis/lib/index.js`. That file is already in the vendored package, and `files` includes `lib/index.js`. The existing packed-install e2e is the regression for this tarball. It skips unless the host is Linux x64 or arm64 and `rsh/Modules/Official/sandbox/sandbox-local/lib/index.js`, the Landlock entry, and the host `landlock-run` binary exist.
