# Agent Note: Cordis / DSH compatibility inventory and handoff

Status: proposed

English | [中文](2026-09-28-cordis-dsh-compatibility-inventory.zh.md)

## Problem

The compatibility work needs an evidence-based map of Cordis/DSH ownership, existing Loader/HMR/unload coverage, and the safe plugin cohort order. Without that map, a compatibility adapter can duplicate native authority or silently broaden an unsupported legacy contract.

## Proposal

Use this inventory and test matrix as the compatibility work baseline. Keep the filesystem bridge as the first completed capability slice, maintain the source-alias checks for native exports, then admit additional DSH plugins one package family at a time after validating its contracts. Leave Native Runtime public APIs and Engine/Agent/Session changes with their owner.

## Scope and baseline

This inventory covers the compatibility owner's surface on `origin/main` at `142c9c925c7013087557676a86cad95e41b53dda`. It does not modify Native Runtime public APIs, Agent, Session, Engine, or vendored Cordis. The user's primary checkout has local changes; work is isolated in branch `refactor/cordis-compat-completion`.

The native runtime foundation and native profile loader already exist. The four filesystem adapters (`compat-fs-local`, `compat-fs-policy`, `compat-fs-sandbox`, and `compat-tool-fs`) now mount through the optional `compat-dsh-runtime`, which owns one shared Cordis Context and permits only the first-party plugin allowlist. This proves one bounded capability slice, not a generic Cordis plugin loader or a Cordis-free production application. Shipped product profiles still use the legacy composition.

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

### Source-level Cordis/DSH touchpoints

These are representative executable/type edges confirmed in authored TypeScript. They identify the main migration surfaces; run `pnpm run audit-source-import-graph -- --cordis` for direct Cordis package imports with symbol names, compiler face, package owner and file location. `--full` prints all dependency findings.

The current AST inventory reports 1,745 direct Cordis-family import/type/re-export/module-augmentation edges across both compiler faces. This includes test sources and counts a source edge once per face when it participates in both; it is not a unique-file count or a shipped-runtime dependency count.

| Surface and source examples | Observed Cordis API / behavior | Face and edge kind | B-role disposition |
|---|---|---|---|
| Vendored framework: `rsh/Core/vendor/{cordis,loader,include,group,hmr,timer,logger-console}/src` | `Context`, `Fiber`, `Service`, `Inject`, `FiberState`; Loader entry/config composition; Include patches; Group, HMR hooks, Timer and logging services | Host runtime + types; logger-console has shared/browser faces | Keep pinned vendor source unchanged. Reach it only from legacy DSH or the optional Compatibility Host; no native Engine import. |
| Legacy startup: `rsh/Compatibility/DSH/boot/app-boot/src/index.ts`, `boot/cmdline/src/index.ts`, `rsh/Programs/CLI/src/profile-boot.ts` | Cordis `Context`/`FiberState`; Loader, Include and Group setup; module augmentation, config/profile resolution, Timer/HMR setup and lifecycle events | Host runtime + types, with plugin module augmentation | Keep startup/config parsing and Cordis assembly inside the compatibility boundary. CLI still reaches this legacy path; removing that application dependency needs owner A's dual-path integration. |
| Legacy bundles: `rsh/Compatibility/DSH/bundle/{base,headless,web-app,sdk-app,sdk-minimal,acp-app,rsh}/src` | Cordis Context typing and Loader package augmentation; profile-specific legacy plugin sets | Primarily Host; type edges plus Loader side effects | Keep as DSH compatibility compositions. Do not load entire bundles into Native Engine. |
| Engine services and extension packages: e.g. `rsh/Engine/core/{tools,session,scope,system-prompt}/src`, `Engine/workflow/workflow/src`, `Engine/schedule/schedule/src`, `Engine/preset/agent-presets/src` | Runtime `Context`/`Service` registration and module augmentation, plus type-only Context/Fiber use in helpers and invariants | Host; mixed runtime and type edges. `agent-presets` also consumes Loader/Include | Native decoupling is owner A's migration. B must not edit these packages; bridge only a specifically agreed DSH contribution. |
| DSH-compatible modules: e.g. `rsh/Modules/Official/{workspace,webhook,web,terminal,todo}/**/src` and `Modules/Community/experimental/{webworker-runtime,webworker-packer}/src` | Cordis Context/Service registration and injected service types; worker code also dynamically resolves Cordis Logger/Include modules | Host runtime + types; worker loader calls are literal dynamic references | Preserve existing DSH behavior. Add a Native bridge per capability only after matching it to an existing Native service/event contract; the first supported cohort remains filesystem. |
| Web Host and Client: `rsh/Programs/Web/host/{webserver,plugin-inventory,open-in-app}/src`; `Programs/Web/client/web/src/{seed,boot,boot-client,mount,loader-status}.ts` | Host Context/service integration; Client imports Cordis at runtime, seeds it into the browser module table, and boots Cordis Loader | Host and Client; both runtime and type edges | Web dual-path and browser-artifact isolation need application-owner integration. The native Host package's optional Cordis peer alone does not make Web Client Cordis-free. |
| Desktop Host surface: `rsh/Programs/DesktopHost/src/index.ts` | Type-only `Context` and Include `PatchOptions` appear in desktop host interfaces | Host type edges | Type erasure removes the runtime edge, but the published type closure still couples this app package to Cordis; application owner must decide its native-facing type contract. |
| Tests, fixtures and benchmarks: package `tests/`, `rsh/Tests/test-support`, `rsh/Tests/benchmarks` | Construct Cordis Context/Loader to exercise old plugins, fixtures and compatibility benchmarks | Host test-only runtime/types | Keep as test/tool edges; classify separately from shipped runtime dependencies in the full manifest cleanup. |

The source graph records source file, compiler face, resolved owner, type/runtime distinction and literal loader target. It does not infer the target of computed imports; those are counted for explicit policy review. Package declarations are checked against each importing owner's dependency sections rather than relying on root hoisting.

## Plugin order

| Cohort | Recommendation | Reason / acceptance boundary |
|---|---|---|
| 1. Filesystem | Already implemented: local provider, observation policy, sandbox provider, filesystem tools | Keep as the reference adapter. Config/manifest refusal, unique provider/policy ownership, model-visible prompt/schema, single durable tool result, deny-path immutability, and awaited cleanup are covered by real native-host/legacy-plugin tests. |
| 2. Shell and terminal | Candidate after inventorying the exact DSH packages and Native Runtime seams | High user value, but touches process ownership, sandbox and cancellation. Adapt a single provider/tool family at a time; never bypass native approval or sandbox decisions. |
| 3. MCP and external providers | Candidate after defining the supported config and credential mapping | Broad ecosystem reach and external lifecycle/network effects. Require explicit credential ownership, bounded calls, and teardown before admitting a plugin. |
| Deferred | Whole `base` bundle, Agent loop, Session/persistence, arbitrary third-party plugins, client plugins with no native contract | These either duplicate native authority or have not been mapped to a declared interface. Refuse unsupported manifest/config shapes rather than silently ignoring them. |

The cohort table is a prioritization proposal, not a claim that shell/MCP adapters are implemented.

### DSH plugin matrix and current support

The table below is based on `Compatibility/DSH/bundle/*/cordis.patch.yml`, default profile composition, and existing bridge manifests. It records capability-family boundaries; it does not imply that every config, entry point, or third-party plugin in a family is supported.

| Plugin/capability family | Current legacy entry | Host / Client | Cordis semantics and resources | Status and disposition |
|---|---|---|---|---|
| Filesystem providers and policy | `dsh-fs-local`, `dsh-fs-observation-policy`, `dsh-fs-sandbox`, `dsh-tool-fs`; Native bridges live in `bridge/compat-fs-*` | Host; the tool bridge consumes native Agent, Tools, Prompt, and Session capabilities | Provider, policy/sandbox decisions, tool and prompt registration; durable Session results remain owned by native services | **One bounded filesystem v1 slice is supported.** Four bridges have real Native Host tests; manifest/config rejection boundaries are defined by each package README and tests. This does not imply arbitrary legacy filesystem plugin support. |
| Shell / Terminal | `dsh-subprocess-local`, `dsh-bash-sandbox`, `dsh-pwsh-sandbox`, `dsh-tool-bash`, `dsh-tool-pwsh`; `sdk-minimal` also composes `dsh-terminal` and `dsh-terminal-bash` | Host | Process/PTY ownership, approval and sandbox policy, timeout/cancellation, asynchronous completion cleanup | **Candidate, not bridged.** First split process capability, policy decision, and tool contribution; do not bypass native approval/sandbox checks or treat `abort` as process exit. |
| LLM providers and credentials | `dsh-llm-deepseek`, `dsh-llm-pi-ai`, `dsh-credentials-local`, `dsh-llm-retry` | Host; some settings are controlled by the Web Client | Provider route/registration, per-request credential resolution, settings reload, request cancellation and provider lifecycle | **Needs evaluation.** Compatibility requires native provider registration and credential capability contracts; never copy keys into general Cordis Context or a browser bundle. |
| Agent / Session / Tools core | `dsh-agent`, `dsh-agent-loop`, `dsh-session`, `dsh-session-persistence-jsonl`, `dsh-tools`, and `dsh-tool-*` | Host; results are exposed through Web/ACP/SDK | Agent creation, Session read/write, Tool execution and result persistence | **Exists in legacy DSH; excluded as a whole from the compatibility bridge.** RSH Native must remain the sole business authority. Only individual contributions such as the filesystem tool may map to native extension points; the complete loop/store/executor is unsupported. |
| Web Host / API / Client | `dsh-web-app`, `dsh-host-webserver`, `dsh-api-*`, `dsh-client-*`, `dsh-cordis-client-runner` | Host + Client | Host service registration, RPC/event bridge, browser module table and client plugin lifecycle | **Legacy product path remains active; not nativeized.** Making Host Cordis optional does not prove the Client bundle can run without Cordis; support and artifact dependency checks must be separate. |
| ACP / SDK / RSH bundles | `dsh-acp-app`, `dsh-sdk-app`, `dsh-sdk-minimal`, `dsh-rsh` | Host | Startup arguments, Loader composition, Agent/Session/Tool assembly; some bundles include the legacy loop | **Legacy entry points remain; do not load them wholesale into Native Engine.** Determine per package whether it reuses Native Agent/Session/Tools; exclude compositions that conflict with the single native authority. |
| Scheduling, MCP, external providers, arbitrary third-party plugins | Enumerate per user profile and installed-plugin inventory; current default bundles do not form a unified Native bridge roster | Host; some plugins may also include Client faces | External process/network, credentials, callbacks, concurrent work and unload | **Not in the first cohort; config must be explicitly rejected or remain on the legacy DSH path.** Select a cohort only after identity, capability, cancellation, rollback and cleanup contracts are known per plugin. |

### B2 targeted test baseline

On the current worktree snapshot, the following targeted suites pass: 11 test files and 69 tests, with no skips. The list extends the original nine-suite DSH baseline with the optional compatibility Host and source-graph fixtures. This is not a full repository test run or evidence that Native Runtime HMR exists.

```text
pnpm exec vitest run \
  rsh/Tests/test-support/loader-smoke/tests/loader-smoke.spec.ts \
  rsh/Compatibility/DSH/boot/app-boot/tests/hmr-config.spec.ts \
  rsh/Compatibility/DSH/boot/app-boot/tests/config-reload.spec.ts \
  rsh/Programs/CLI/tests/profile-hmr.spec.ts \
  rsh/Core/runtime-diagnostics/plugin-host/tests/plugin-host.spec.ts \
  rsh/Compatibility/DSH/bridge/compat-fs-local/tests/native.spec.ts \
  rsh/Compatibility/DSH/bridge/compat-fs-policy/tests/native.spec.ts \
  rsh/Compatibility/DSH/bridge/compat-fs-sandbox/tests/native.spec.ts \
  rsh/Compatibility/DSH/bridge/compat-tool-fs/tests/native.spec.ts \
  rsh/Compatibility/DSH/bridge/compat-dsh-runtime/tests/native.spec.ts \
  rsh/Scripts/verify-source-import-graph.spec.ts
```

Coverage boundary: Loader smoke and app-boot/profile suites cover legacy config, config reload, and Cordis composition; plugin-host covers local owner constraints, awaited disposal, and replacement semantics; the four filesystem bridge suites cover this Native Host slice. This set is not the complete suite for all historical DSH plugins, and it does not establish that Client HMR and Native plugin replacement are equivalent.

### B3 source dependency audit status

The existing checks are substantive but partial. `verify-native-dependencies` uses TypeScript Host/Client compiler projects to inspect import closures for the explicit Native roster and mixed-package native entries, checking literal imports/requires, type imports, re-exports, module declarations, and literal dynamic imports. `verify-package-dependencies` separately derives dependencies from source for its classified packages. `verify-tsconfig-paths` checks that workspace `./native` exports map to their own package `src/` aliases. This branch has passing results for all three.

The new `pnpm run audit-source-import-graph` audit parses both TypeScript compiler faces, resolves each source reference with that file's effective TS options, and records package-owner edges for imports, type imports, re-exports, module augmentations, import types, and literal loaders. Its six fixture tests cover a cross-package relative re-export, a TS alias, type/runtime distinction, Cordis via an alias, a computed loader, and different Host/Client alias resolutions. Add `--graph` to emit JSONL containing compiler face, config, source location, type/runtime kind, computed status, and resolved package target; summary output goes to stderr. Computed imports record location without guessing their destination.

The full scan on this branch covered 25,028 Host/Client references from 4,146 compiler source entries, across 308 of 314 workspace owners. The six owners absent from both TS faces are platform-specific native addon packages and the Python runtime closure. Thirty-three computed loaders were cataloged but cannot be attributed to a concrete target without runtime policy. After correcting the test/runtime dependency classification and the Compatibility manifests, 1,177 repository findings remain: 822 undeclared external edges, 172 undeclared workspace edges, and 183 unresolved source references. Compatibility/DSH itself now has zero source-graph findings. The unresolved set includes legitimate CSS and Vite virtual-resource imports. Remaining dependency findings still need review across the other owners; they include tests, root-managed tooling, and legacy bundles and should not be treated as product defects without classification. No alias-target mismatch or Native Cordis-boundary finding appeared. This is a complete TS-source discovery pass, not a cross-language or clean repository baseline and not a CI gate. `verify-native-dependencies` remains the enforced Native Cordis boundary.

### Interface requirements and B4 entry decision

The existing Native API provides `NativePlugin.resolve(config)`, `NativeHost` installation planning/activation/removal, host/client targets, declared services/events, and `context.own()` disposers. The filesystem adapters map to those contracts without changing them. The compatibility runtime validates Cordis major version 4 and plugin identity through a first-party allowlist; `dsh-plugin-host` owns child Fiber and descriptor cleanup. Filesystem waterfall events preserve `next()` and actor arguments, and observation events forward once to the native scope. Unsupported config fields fail before mount. These checks establish the selected filesystem semantics only; they do not define a generic scope-to-actor mapping or replacement contract.

The selected adapters use the CLI NativeHost in focused tests, but app-level native/compatibility composition remains with the Native Runtime owner. Do not implement a generic Cordis Host or claim the product Cordis switch is complete from this slice.

## Loader, HMR, and unload evidence

| Concern | Existing evidence | Remaining compatibility gap |
|---|---|---|
| Cordis Loader startup and composition | `rsh/Tests/test-support/loader-smoke`; app-boot profile/config tests; `Core/runtime-diagnostics/plugin-host` startup-failure tests; compatibility runtime verifies Cordis v4 and mounts the existing plugin-host adapter | The native compatibility runtime does not load a legacy Loader profile or arbitrary package. |
| Config HMR / reload | `app-boot/tests/hmr-config.spec.ts` covers path aliases, add/change/unlink, missing parent, serialized refresh/dispose, and watcher failure; `app-boot/tests/config-reload.spec.ts` and `CLI/tests/profile-hmr.spec.ts` cover config and profile policy | This is legacy Cordis HMR, not native plugin hot replacement. The native path has no hot-replacement contract yet; do not expose it until its owner specifies replacement semantics. |
| Descriptor/HMR ownership | `Core/runtime-diagnostics/plugin-host/tests/plugin-host.spec.ts` covers failed startup, duplicate owners, waiting for teardown, cancellation during replacement/start, concurrent replacements, and repeated disposal | The plugin-host is a compatibility adapter, not proof that every native bridge can be hot-replaced safely. |
| Bridge load/unload | Five compatibility bridge suites cover refusal, mounting multiple plugins in one shared Context, independent removal, partial activation rollback, awaited asynchronous teardown, filesystem policy decisions, tool/prompt registration, and admitted-work drain | Extend these assertions when another capability family is admitted. |
| Native lifecycle | Native Runtime host tests cover activation rollback, owned cleanup, events, and awaited removal | No generalized HMR or external DSH package discovery; these remain explicit deferred capabilities. |

## Source dependency audit scope and future gate

`verify-native-dependencies` resolves imports and follows native-entry source closures for its explicit native/transitional roster in Host and Client compiler projects. `verify-package-dependencies` derives published package dependencies from source for its classified package set. The new whole-repository source graph discovery tool now covers both compiler faces and offers JSONL export for classification; it is not yet a gate because 1,177 findings remain to be classified in other directories. This branch also makes `verify-tsconfig-paths` check every workspace `./native` export has an alias into that package's own `src/` tree; that caught missing aliases for native prompts, sandbox policy, credential entries, Web Client, and all four compatibility bridges. Promoting whole-graph discovery to a gate still requires:

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

- Current targeted DSH/HMR/compatibility and source-graph run passes: 11 Vitest files / 69 tests, no skips. Native Cordis and package dependency policy checks pass.
- `tsc -b tsconfig.host.json` and the Host `tsdown` workspace build pass.
- `verify-native-dependencies` passes its Host/Client native graph; `verify-package-dependencies` validates 62 published packages; the lockfile passes frozen offline verification.
- `verify-tsconfig-paths` and `verify-module-graph` pass after regeneration. A Cordis-free native profile and a compatibility-enabled profile remain distinct paths; current tests do not establish full Cordis-free CLI/Web/Desktop behavior.
- Source graph discovery now covers both faces and cross-owner resolution; its 1,177 repository findings remain open for ownership classification (822 external dependencies, 172 workspace dependencies, 183 unresolved references). Compatibility/DSH itself has zero findings. The audit is informational pending baseline review; B3 discovery/tooling is complete, while repository-wide dependency cleanup and app-level Cordis OFF/ON acceptance are not.

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
