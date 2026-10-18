# Agent Note: The Python runtime ships its declared closure and nothing else

Status: implemented

English | [中文](2026-10-18-python-runtime-declared-closure.zh.md)

## Problem

The single-file Python SDK runtime deploys [`dsh-python-runtime-closure`](../../../../rsh/Programs/SDK/python/sdk-runtime/package.json) with `pnpm deploy --legacy --prod`. That command hoists the CLI package's `optionalDependencies`, so the staged tree carried the whole legacy Cordis assembly and the compatibility bundles regardless of what the deploy root declared. Retiring those declarations alone changed nothing in the artifact: the packages still arrived, still occupied the tree, and still travelled into the executable. A declaration list that does not decide the artifact cannot be the single source of truth for "which plugins the exe ships".

## Decision

The staged tree is pruned to the declared closure. After deploy and before asset packaging, [`rsh/Scripts/python-runtime-closure-prune.ts`](../../../../rsh/Scripts/python-runtime-closure-prune.ts) walks from the deploy root's declared dependencies, follows every neighbour the runtime can actually resolve — dependencies, non-optional peers, and the optional peers a retained package value-imports — deletes every unreachable package, removes the `.pnpm` store, and drops nested `node_modules` trees under retained packages.

The walk is what the runtime resolves, not what the manifest promises. A first version followed required peers alone and removed `@deepseek-ai/dsh-scope`, which `dsh-agent-presets` value-imports while declaring it only as an optional peer; the packaged executable then failed at import. Every peer now counts except the optional legacy Cordis assembly, and the post-prune check follows the same rule so the two cannot disagree.

The deploy root declares the reachable closure instead of a superset: 36 declarations that no shipped profile or retained package requires are gone, and 22 reachable packages that were missing (the session-format family, storage, workspace, agent-presets, native-approval, and others) are added. `verify-runtime-closure.ts` gains the complementary equality check, so a declaration that reaches nothing fails the gate rather than silently widening the artifact.

Three Cordis packages remain: `cordis`, `dsh-cordis-host-runner`, and `dsh-tool-cordis`. The shipped `cordis` agent preset mounts them on purpose, because it is the preset that edits the live composition. Every other Cordis package is gone, and the build fails when one survives outside that set.

## Alternatives considered

**Retire the declarations and let deploy follow them.** Rejected because `--legacy` deployment hoists the CLI package's optional dependencies: the tree keeps the legacy assembly, so the wheel and the executable would still carry it and the measurement would describe the manifest rather than the artifact.

**Delete known legacy packages by name.** Rejected because a name list encodes today's exclusions instead of the closure that keeps the runtime working; the next package added to the preset would silently vanish from the artifact.

**Ship the compatibility distribution from the same deploy root.** Rejected because the two distributions make opposite promises. The Python runtime is the native-only carrier, and the compatibility distribution keeps its own packaging path through `@deepseek-ai/dsh`, whose 49 optional dependencies — including the Cordis packages and `dsh-app-boot` — are untouched, so explicitly enabling Cordis still packages.

## Consequences

The pruned tree keeps 212 `@deepseek-ai` packages with no links, no `.pnpm`, and no nested `node_modules`. A pruned CLI leaf refuses the legacy profile with `dsh: compatibility mode requires optional packages`, because compatibility mode requires packages this distribution deliberately omits. The Python `legacy-sdk` boot cases therefore skip against the bundled carriers and state that reason instead of asserting a composition the artifact no longer carries.

A patch row replaces an installation's complete `config` value, so a patch that sets only `systemPrompt` also drops the template's `maxSteps`. The `sdk` profile template configures `deepseek-v4-flash`, matching the Python SDK default. Both facts are pinned by the bundled-runtime tests that boot the `sdk` profile through the executable and through the development node closure.

Remaining cleanup outside this decision: the prune removes `.pnpm` unconditionally, deletes nested `node_modules` without validating their contents, cannot pre-inspect in a dry run, and the build reports non-`ENOENT` errors as a silent skip in `coalesce-staged-dsh-tools.ts`.
