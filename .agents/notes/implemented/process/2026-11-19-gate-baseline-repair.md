# Agent Note: Restore the publication and static gate baseline

Status: implemented

English | [中文](2026-11-19-gate-baseline-repair.zh.md)

## Problem

The active PR workflow (`redspark-ci.yml`) runs the package-publication rules and a build, but neither `check:ci:static` nor `hygiene`. On `main` at `c226914203`, all five gate commands exercised here were red: `publint`, `verify-optional-dependency-imports`, `verify-cordis-config`, `verify-runtime-closure`, and `verify-publish-payload`. `rescope-vendor:check` was red as well. Those failures mixed real payload, manifest, and documentation defects with one intentionally-red migration guard.

The payload defects were concrete. Three hook packages emitted a `lib/shared-*.js` chunk absent from `files`; `native-headless` advertised `./lifecycle-events` without emitting it; `native-session` omitted `jobs-types`; `native-application` shipped bundles importing `lib/client/*.module.css` that `files` omitted; the schedule example still named the deleted `@redspark/rsh-time-context`; and the `rsh` compatibility bundle patch named `@redspark/rsh-tool-subagent` without declaring it. The native-CLI closure walk still reaches Cordis because `@redspark/rsh` intentionally keeps the Cordis superset for the packed compat-bridge test until the deletion change lands.

`agent-presets` reached its own packaged `presets/` directory through a `new URL('../presets/', import.meta.url)`, which resolves differently from `src` and every emitted `lib/types` depth. Inlining the shipped root as a module constant also pulled `discovery.ts`'s optional Cordis peers into `native-storage.ts`. `tool-str-replace-editor` imported `@redspark/rsh-fs/native` and `@redspark/rsh-sandbox/native` while declaring both peers optional. Finally, `rsh/Core/vendor/README.md` still documented the retired `@deepseek-ai` scope, and the rescope codemod's token rule rewrote a tarball's decompressed bytes and a `node_modules` path segment.

## Decision

The payload and manifest defects are repaired directly: the emitted chunks, entries, CSS, and bundle-patch dependency are published or declared. `verify-publish-payload` now applies bare-specifier installation rules only to Native entries whose `dsh.native.targets` includes `host`. A Client-only Native entry is a statically linked browser library: the Web shell build resolves its bare imports, and `rsh/Programs/Web/client/AGENTS.md` keeps those browser build inputs in `devDependencies`. The same gate exempts the exact `.ts` URLs a package reads only on its TypeScript source-launch branch, because tsdown cannot fold the `import.meta.url` extension check that makes that branch unreachable in a payload.

`verify-runtime-closure` keeps the Python-runtime walk. The native-CLI walk moves to its own `verify-runtime-closure:native-cli` command, which becomes the acceptance check for the Cordis deletion. Keeping that target inside the default command would keep the baseline red while `@redspark/rsh` deliberately retains Cordis.

`agent-presets/src/shipped-root.ts` owns `SHIPPED_PRESET_ROOT`, resolved once from `import.meta.resolve('@redspark/rsh-agent-presets/package.json')`; `discovery.ts` re-exports it, and `native-storage.ts` imports the leaf module so the Host face does not load the discovery module's optional peers. `tool-str-replace-editor` declares its `@redspark/rsh-fs` and `@redspark/rsh-sandbox` peers as required, and `native-package-policy` records the remaining `@redspark/rsh-tools` import as compatibility-only. The vendor README now names the `@redspark` scope, and the rescope codemod skips the desktop tests whose bare `cordis` tokens are payload and path content rather than specifiers.

## Verification

- `pnpm run publint`, `pnpm run verify-cordis-config`, `pnpm run verify-runtime-closure`, `pnpm run verify-publish-payload`, `pnpm run constraints`, and `pnpm run verify-package-dependencies` pass on the rebuilt tree.
- `pnpm run verify-optional-dependency-imports`, `pnpm run verify-native-dependencies`, and `pnpm run rescope-vendor:check` pass.
- `pnpm run hygiene` passes all 18 gates.
- `verify-publish-payload` reports 214 packed packages with a Native entry resolving every payload specifier.
- `npx vitest run rsh/Scripts/verify-publish-payload.spec.ts` passes 42 tests, including the Client-only scope, the Host-target counterexample, and the exact source-mode exemption.
- `pnpm run verify-runtime-closure:native-cli` remains the documented red guard until Cordis is deleted.

## Alternatives considered

### Why not remove Cordis in this change?

The deletion also removes the compatibility bundles and retires the packed compat-bridge test's Cordis dependency. Mixing that migration into a baseline-repair change would make the gate fixes and the deletion impossible to review or revert independently.

### Why not keep the native-CLI walk in the default command?

The walk is an acceptance check for a migration that has not shipped. A default command that must fail until a later change lands is not a usable baseline signal, and it hides every other closure regression behind the known Cordis failure.

### Why not publish `src/` or the repository tsconfig?

Neither is a consumer artifact. `./src/*` exports serve workspace tests and source launches; adding source trees to published tarballs would grow the payload and publish unbuilt code. The source-mode URLs have no consumer meaning at all.

## Consequences

- The static and publication gates are trustworthy again on `main`, so the Cordis deletion starts from a green baseline.
- The native-CLI closure still has to be run explicitly, and its red result is the migration's remaining worklist.
- Client-only Native entries no longer have to restate browser build inputs as installation dependencies, which keeps their manifests aligned with the Client dependency policy.
