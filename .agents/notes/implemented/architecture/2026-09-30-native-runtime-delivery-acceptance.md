# Agent Note: Native runtime delivery acceptance

Status: implemented

English | [中文](2026-09-30-native-runtime-delivery-acceptance.zh.md)

## Problem

The native runtime migration needs one durable handoff that distinguishes verified product paths, compatibility-only paths, and platform checks that were not available on the local machine.

## Decision

The native default composition and package closure are the delivered P5 baseline at merge commit `1de1837e3ae8a49f8959957267e2602e87114d98`.

The acceptance record treats the native runtime, native Engine packages, native filesystem and headless profiles, native Web client, Desktop Host, CLI optional-dependency checks, packed native consumer, and Cordis-free declarations as the native product surface.

The compatibility surface remains explicit: Cordis, Loader, HMR, legacy profile boot, and the five reviewed runtime-layer edges stay behind compatibility or legacy entry points, and `collectRuntimeLayerViolations` rejects each exception when its manifest edge disappears.

The supported local delivery path on Windows is the source Desktop launcher from the merged P5 worktree. It starts Electron from the native Desktop build and uses an isolated `DSH_HOME`; the installed unsigned package path remains unverified because the local Visual Studio installation lacks the Spectre-mitigation libraries required by the patched `node-pty` build.

## Evidence

- `pnpm run build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run hygiene`, `pnpm run doc-sync`, and `pnpm run verify-third-party-notices` passed on the P5 head before merge.
- The packed native consumer passed without Cordis in the production consumer fixture.
- The built CLI E2E passed after the launcher removed the Node 24 SQLite warning from child stderr assertions.
- GitHub Actions run `36662253793` passed the native addon matrix and run `36662253803` passed Linux and Windows RSH CI, including build, typecheck, terminal regressions, profile smoke, client tests, lint, and documentation checks.
- Windows source Desktop startup was observed from the merged worktree with Electron 44 processes and the configured inspector ports; the updated GUI, Web, and TUI shortcuts resolve to the same worktree launcher.

## Compatibility matrix

| Surface | Supported path | Evidence or limit |
| --- | --- | --- |
| Native CLI and headless | `dsh` native profiles | Built CLI E2E, profile smoke, and keyless native tests passed. |
| Native Web client | `native.html` and native Web boot | Production Web smoke and CI build passed. |
| Native Desktop | Source Desktop launcher | Windows source startup passed; installer packaging awaits Spectre-capable MSBuild inputs. |
| Native packed consumer | Cordis-free package installation | Packed consumer test passed. |
| Legacy Cordis profiles | Explicit optional compatibility dependencies | Supported only through the documented compatibility entry points and reviewed matrix. |
| Cross-platform Desktop installers | Windows x64 unsigned locally; signed release targets elsewhere | Local Windows packaging is blocked by missing Spectre libraries; macOS and signed Windows claims require their release environments. |

## Alternatives considered

**Claim a signed installer from the source startup:** A source Electron launch proves the native Desktop path, but it cannot prove installer signing or the missing Windows build prerequisites.

**Delete every compatibility exception during delivery:** The five edges are still consumed by legacy owners; deleting their declarations without migrating those consumers would hide a real dependency.

## Consequences

The repository can select the native default without requiring Cordis in the native production dependency closure, while legacy consumers retain an explicit compatibility route. The five remaining runtime-layer exceptions are live, named manifest edges owned by their legacy consumers; they are not treated as native dependencies and remain subject to stale-exception validation.

The acceptance record does not claim universal DSH plugin compatibility, signed installer output on this Windows host, or platform results that were not executed. Future changes that remove one compatibility edge must delete its exact exception and keep the negative stale-exception test passing.
