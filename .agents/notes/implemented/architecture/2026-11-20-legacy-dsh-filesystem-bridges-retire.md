# Agent Note: Legacy DSH filesystem bridges retire for the Native providers

Status: implemented

English | [中文](2026-11-20-legacy-dsh-filesystem-bridges-retire.zh.md)

## Problem

`Compatibility/DSH/bridge` still carried five packages that bridged legacy DSH filesystem plugins into Native profiles: `compat-dsh-runtime` (shared Cordis Context plus an allowlisted Loader), `compat-fs-local`, `compat-fs-policy`, `compat-fs-sandbox`, and `compat-tool-fs`. Together they formed a closed island: every reference outside it came from the island itself, its two tests, or generated catalogs. `snapshots/compat` replayed `compat-tool-fs` through the test-only `compat` CLI profile, and `packed-compat-bridge.e2e.ts` covered the same composition from a packed install. No shipped `dsh` profile template selected any of them.

The Native side already provides the same capability family: `rsh-fs-local`, `rsh-fs-observation-policy`, `rsh-fs-sandbox`, `rsh-native-sandbox-policy`, and `rsh-tool-fs`, whose `read`, `write`, and `edit` tools carry the schemas the legacy adapters forwarded.

## Decision

Retire the island instead of maintaining a second filesystem wiring path. The five packages, the test-only `compat` CLI profile, `snapshots/compat`, and `packed-compat-bridge.e2e.ts` are removed together, so no test keeps a retired adapter alive. Native profiles keep selecting the Native providers directly from `native-profile-template.ts`, which no compat row ever entered.

The bridge README now states that the filesystem subsystem is selected directly, and `session-snapshot-corpus.corpus.ts` drops the `compat` snapshot profile. `compat-plugin-host` stays: it is not part of the island, and the compatibility bundles and Native filesystem modules still reference it.

## Consequences

The compatibility bridge group loses its shared Cordis Context and its filesystem adapters; the remaining entries are declaration packages, Settings adapters, and the Codex subagent adapter. Recorded coverage for the filesystem tools now comes only from `snapshots/native-headless`, which exercises the Native providers the product ships.

Native profiles lose no capability: every retired adapter forwarded to a Native provider or tool that shipped profiles already select. A profile that installed a legacy DSH filesystem plugin through `compat-dsh-runtime` has no replacement path and must select the Native providers instead.

## Alternatives considered

**Keep `compat-dsh-runtime` as a migration path.** Rejected: building an installation plan around it requires the retired filesystem adapters, which are its only allowlisted entries.

**Convert the adapters into Native plugins.** Rejected: that would duplicate `rsh-fs-local`, `rsh-fs-observation-policy`, `rsh-fs-sandbox`, and `rsh-tool-fs`, which already own those roles and have their own tests and snapshots.

**Delete the snapshot but keep the packages.** Rejected: an adapter with no profile and no test is dead weight that still imports Cordis.

## Verification

- `pnpm run build`, `pnpm run typecheck`, and `pnpm run lint` pass.
- `pnpm run verify-runtime-closure:native-cli` passes with 274 packages; `pnpm run verify-runtime-closure` passes with 149 packages.
- `pnpm run verify-native-dependencies`, `verify-optional-dependency-imports`, `constraints`, `verify-package-dependencies`, and `verify-cordis-config` pass.
- `pnpm run doc-sync` passes all 33 gates.
- `pnpm run test` reports 183 failures and `pnpm run test:snapshot` reports 8, the same names as an `origin/main` checkout in this environment; no failure name is new.
