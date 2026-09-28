# Agent Note: Cordis / DSH compatibility inventory and handoff

Status: proposed

English | [中文](2026-09-28-cordis-dsh-compatibility-inventory.zh.md)

## Problem

The compatibility work needs an evidence-based map of Cordis/DSH ownership, existing Loader/HMR/unload coverage, and the safe plugin cohort order. Without that map, a compatibility adapter can duplicate native authority or silently broaden an unsupported legacy contract.

## Proposal

Use this inventory and test matrix as the compatibility work baseline. Keep the filesystem bridge as the first completed capability slice, close source-alias gaps for native exports, then admit additional DSH plugins one package family at a time after validating its contracts. Leave Native Runtime public APIs and Engine/Agent/Session changes with their owner.

## Scope and baseline

This inventory covers the compatibility owner's surface on `origin/main` at `142c9c925c7013087557676a86cad95e41b53dda`. It does not modify Native Runtime public APIs, Agent, Session, Engine, or vendored Cordis. The user's primary checkout has local changes; work is isolated in branch `refactor/cordis-compat-completion`.

The native runtime foundation and native profile loader already exist. Four filesystem adapters already bridge selected legacy packages: `compat-fs-local`, `compat-fs-policy`, `compat-fs-sandbox`, and `compat-tool-fs`. This proves one bounded capability slice, not a generic Cordis plugin loader or a Cordis-free production application. Shipped `dsh` profiles still use the legacy composition.

## Usage map and ownership

| Area | Current owners / examples | Migration disposition |
|---|---|---|
| Vendored framework | `rsh/Core/vendor/{cordis,loader,include,hmr,group,timer,logger-console}` | Keep as the pinned DSH implementation. Do not patch vendor sources for compatibility behavior. Load only behind the compatibility boundary when selected. |
| Legacy launcher and composition | `rsh/Compatibility/DSH/boot/{cmdline,app-boot}`; `bundle/{base,web-app,headless,sdk-app,sdk-minimal,acp-app,rsh}`; profile YAML and patch resolution | Keep here. It owns Cordis config parsing, legacy profile/bundle composition, include/group/Loader wiring, Cordis HMR/config reload, and DSH startup behavior. Do not load a whole legacy bundle into a native Engine. |
| Existing DSH plugin packages | Most packages under `rsh/Core`, `rsh/Engine`, `rsh/Modules`, and Web/SDK/ACP programs still export Cordis plugins, inject `Context` services, or subscribe to Cordis events | Per capability, either migrate the owning behavior to Native Runtime's existing public contracts (owner: native-runtime team) or write an explicit adapter under `Compatibility/DSH/bridge`. Never let a native package import Cordis to avoid writing an adapter. |
| Native foundation and native entries | `Core/runtime-diagnostics/native-runtime`, native Engine packages, and `./native` entries in FS / credentials / session packages | Remain native-owned. Compatibility adapters may consume their declared interfaces; the adapter must not create a second Agent, Session writer, or tool-result authority. |
| Applications and transports | CLI, DesktopHost, Web host/client, SDK, ACP | Current compositions retain Cordis dependencies. Native profile loading exists in CLI; application-wide default selection, Web/Desktop renderer, and published runtime closure are not yet a complete dual-path product. Compatibility owns the legacy composition side, not native app integration. |
| Build, test, and documentation tooling | `Tests/test-support`, Cordis config/catalog generators and verifiers, profile fixtures, browser/CLI tests | Keep legacy Loader fixtures for compatibility assurance. Mark these as development-only dependencies where feasible; they do not prove a Cordis-free product runtime. |

The raw text scan finds Cordis references across many packages; this is intentionally not reported as an import count because docs, generated catalogs, tests, peer declarations, and actual source edges are mixed. A compiler-resolved graph is required before using counts or declaring a package Cordis-free.

## Plugin order

| Cohort | Recommendation | Reason / acceptance boundary |
|---|---|---|
| 1. Filesystem | Already implemented: local provider, observation policy, sandbox provider, filesystem tools | Keep as the reference adapter. Config/manifest refusal, unique provider/policy ownership, model-visible prompt/schema, single durable tool result, deny-path immutability, and awaited cleanup are covered by real native-host/legacy-plugin tests. |
| 2. Shell and terminal | Candidate after inventorying the exact DSH packages and Native Runtime seams | High user value, but touches process ownership, sandbox and cancellation. Adapt a single provider/tool family at a time; never bypass native approval or sandbox decisions. |
| 3. MCP and external providers | Candidate after defining the supported config and credential mapping | Broad ecosystem reach and external lifecycle/network effects. Require explicit credential ownership, bounded calls, and teardown before admitting a plugin. |
| Deferred | Whole `base` bundle, Agent loop, Session/persistence, arbitrary third-party plugins, client plugins with no native contract | These either duplicate native authority or have not been mapped to a declared interface. Refuse unsupported manifest/config shapes rather than silently ignoring them. |

The cohort table is a prioritization proposal, not a claim that shell/MCP adapters are implemented.

## Loader, HMR, and unload evidence

| Concern | Existing evidence | Remaining compatibility gap |
|---|---|---|
| Cordis Loader startup and composition | `rsh/Tests/test-support/loader-smoke`; app-boot profile/config tests; `Core/runtime-diagnostics/plugin-host` real Loader startup-failure test | Add a single bridge acceptance fixture that verifies selected package/config validation happens before activation and sees the shipped export shape. |
| Config HMR / reload | `app-boot/tests/hmr-config.spec.ts` covers path aliases, add/change/unlink, missing parent, serialized refresh/dispose, and watcher failure; `app-boot/tests/config-reload.spec.ts` and `CLI/tests/profile-hmr.spec.ts` cover config and profile policy | This is legacy Cordis HMR, not native plugin hot replacement. The native path has no hot-replacement contract yet; do not expose it until its owner specifies replacement semantics. |
| Descriptor/HMR ownership | `Core/runtime-diagnostics/plugin-host/tests/plugin-host.spec.ts` covers failed startup, duplicate owners, waiting for teardown, cancellation during replacement/start, concurrent replacements, and repeated disposal | The plugin-host is a compatibility adapter, not proof that every native bridge can be hot-replaced safely. |
| Bridge load/unload | Four `Compatibility/DSH/bridge/*/tests/native.spec.ts` cover rejection before activation, native consumer behavior, selected policy and sandbox decisions, tool/prompt registration, one Session result, and bridge-owned disposal | Expand shared assertions across bridge packages for partial activation failure and prove service/event/tool registries return to the original state after each failure and unload. |
| Native lifecycle | Native Runtime host tests cover activation rollback, owned cleanup, events, and awaited removal | No generalized HMR or external DSH package discovery; these remain explicit deferred capabilities. |

## Source dependency audit requirements

`verify-native-dependencies` resolves imports and follows native-entry source closures for its explicit native/transitional roster in Host and Client compiler projects. `verify-package-dependencies` derives published package dependencies from source for its classified package set. Together they cover important cases, but they are not a repository-wide Cordis-boundary graph audit. This branch also makes `verify-tsconfig-paths` check every workspace `./native` export has an alias into that package's own `src/` tree; that caught missing aliases for native prompts, sandbox policy, credential entries, Web Client, and all four compatibility bridges. The follow-up graph audit must:

1. Build both compiler faces and resolve each import from its importing file, including TS paths, relative paths, package exports, and package self-references.
2. Follow re-exports and reachable source edges across package boundaries; retain type-only and runtime edges separately.
3. Check the resolved owning package against the importing package's declared dependencies, including undeclared relative cross-package imports.
4. Distinguish Core, Engine, Modules, Programs, Compatibility, tests, generated files, and vendored sources using an explicit policy roster.
5. Reject Cordis source/type/module-augmentation edges from the native roster, while permitting them only in `Compatibility/DSH`, explicitly legacy packages, and test-only fixtures as classified.
6. Include negative fixtures for alias escape, `../` package escape, re-export chains, `import type`, computed import, missing manifest dependency, and Host/Client-specific resolution.

Do not enforce a repository-wide Cordis ban until the package inventory classifies existing legacy owners; otherwise the gate either fails current supported DSH behavior or needs an unbounded exception list.

## Handoff contracts already available

The compatibility work should consume, not redefine, the existing API: `NativePlugin.resolve(config)`, `NativeHost` installation planning/activation/removal, explicit host/client targets, declared services/events, scoped event dispatch, and `context.own()` disposers. Before admitting each DSH package, document its exact supported legacy manifest/config version, required native services, policy/actor mapping, and refusal behavior. Any missing contract goes back to the native-runtime owner; compatibility must not add a second lifecycle or widen security policy.

## Validation recorded in this branch

- Loader/HMR/config reload, plugin-host replacement, and all four filesystem bridge suites: 8 files, 54 tests passed.
- `gen-tsconfig-paths.spec.ts`: 8 tests passed, including native export source-alias coverage.
- `build:lib:host` passed; the built CLI native-headless replay passed with a Cordis Context creation probe, and the compatibility-profile replay passed with a real workspace write plus exactly one durable tool call/result. These are the current native-only and compat-on headless paths, not full Web/Desktop proof.
- `verify-tsconfig-paths`, `verify-native-dependencies`, and `verify-package-dependencies` passed; the latter classified 62 published packages.
- These checks validate the listed owners and bridge slice. They do not establish full Cordis-free CLI/Web/Desktop behavior or repository-wide dependency closure.

## Acceptance criteria

- Publish this inventory and baseline matrix in the branch before adding a new plugin cohort.
- Keep each adapter opt-in and package-specific; unsupported package versions/config keys fail before acquiring resources.
- Test load success, load failure after partial setup, unload during admitted asynchronous work, and no residual registration; include the real legacy implementation behind a real Loader composition where applicable.
- Document every supported DSH plugin and every known unsupported shape. Do not claim Cordis is optional at product level until the native owner wires and verifies complete native and compatibility application paths.

## Alternatives considered

**Load the entire legacy base bundle:** rejected because it can introduce competing Agent, Session, and tool owners.

**Start a new plugin family before the inventory and unload baseline:** rejected because configuration, policy, asynchronous work, and cleanup obligations differ by package.

## Risks

The existing compiler-aware gates cover explicit rosters, not all source owners. A broader gate needs a reviewed ownership roster and negative fixtures before it can safely reject legacy Cordis imports across the repository. Cordis HMR coverage also does not imply native hot replacement.
