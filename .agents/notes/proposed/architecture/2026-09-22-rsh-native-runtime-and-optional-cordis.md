# Agent Note: RSH native runtime and optional Cordis compatibility

Status: proposed

English | [中文](2026-09-22-rsh-native-runtime-and-optional-cordis.zh.md)

## Problem

Runtime role metadata describes ownership but leaves Cordis responsible for execution and required by product packages. The [earlier proposal](2026-09-21-rsh-runtime-layers-and-cordis-adaptation.md) retains Cordis as the sole framework. An optional compatibility distribution requires independent native execution without duplicating Agent, Session or tool authority.

## Proposal

Build an RSH native runtime, migrate complete capabilities and application compositions, and expose Cordis through an explicitly selected official compatibility module. This is a migration decision, not a claim that current profiles are native. Preserve package names, supported profile launch, tool behavior, approval and sandbox policy, Session generations and both SDK projections. The role classification and dependency rules from the earlier proposal remain useful for the existing composition; only its sole-framework decision is superseded.

### Responsibilities and dependencies

| Owner | Responsibility | Permitted dependency direction |
|---|---|---|
| Core | Generic installation, services, events, scopes, resources and diagnostics | Native Core and declared maintained dependencies; no Engine, Module, Program or compatibility implementation |
| Engine | The single Agent loop, Session history, tool execution and workflow authorities | Native Core and public capability Definitions; no concrete Module Provider selection |
| Modules | Capability Definitions, Providers, Consumers, policies and projections | Published Definitions and registries; a Consumer does not select or import its Provider |
| Official compatibility module | Adapt selected legacy contributions, configuration and owned resources | Public native interfaces and the explicitly enabled Cordis implementation; no second writable Engine |
| Programs | CLI/profile composition, Host, Client, transport and presentation | Public native APIs and selected Providers; compatibility is an explicit deployment choice |

An accepted capability includes its Definition, selected Provider and real Consumer, plus its required policy and projection. Disabling compatibility must not remove approval enforcement, widen filesystem/process access or silently select an unrestricted Provider. Same-process plugins remain trusted code; scope visibility is not an operating-system sandbox.

### Native interfaces and execution semantics

The first interface revision must expose the following operations. Names are API design targets; P1 owns the implementation and independent-consumer declaration checks. Native execution protocol revisioning remains distinct from `dsh.runtime` role metadata and persisted Session versions.

| Interface | Required behavior | Failure and completion rules |
|---|---|---|
| Installation request and resolved plan | Explicit plugin, target, scope, configuration, required/optional services and provided services | Reject unsupported revisions/targets, duplicate providers, missing requirements and cycles before activation; resolve configuration without acquiring resources |
| Service access and publication | Read only declared dependencies; choose the nearest visible provider; absent optional dependencies are explicit | Publish only after activation succeeds and every promised service exists; never expose partially initialized services or construct a fallback Provider |
| Scope and initiator | Separate visibility ancestry, installation resource ownership and the initiating Agent/tool execution | Independent roots isolate realms; parallel callers retain their own initiator through asynchronous work; adaptation cannot infer caller identity from the registration owner |
| Owned registration and resource | Register ownership immediately; return an idempotent, awaitable disposer | Failed activation removes only its own registrations; cleanup attempts every resource and aggregates failures |
| Start, remove and stop | Start dependencies before consumers; remove dependent consumers with their selected provider; stop admission before cancellation | Await startup, admitted work and cleanup; dispose dependents before providers; a shutdown signal alone is not completion |
| Diagnostics | Expose installation identity, scope, state, dependency selection, failure and cleanup outcome | Distinguish planning, activation, ready, draining, failed and disposed states; do not publish secret configuration values |

Engine owners define business quiescence: stop admitting turns and tool work, cancel or finish owned execution, commit the resulting Session events, flush persistence, then release underlying services. Generic reverse disposal does not replace this ordering. Rollback concerns registrations and resources; completed file writes, network effects and durable events are not automatically undone.

| Event mode | Ordering and return | Error and cancellation semantics |
|---|---|---|
| Synchronous notification | Registration order; caller does not await listener promises | Listener throws propagate when the event owner requires it, including filesystem observations |
| Parallel asynchronous delivery | Admit selected listeners and await every admitted callback | Settle all callbacks before reporting failures; cancellation closes new admission but still drains admitted work |
| Serial asynchronous delivery | Await listeners in order | Stop at the first rejection and preserve the caller's failure |
| Waterfall | Continue only through explicit `next()`; omission short-circuits and repeated delegation rejects | Await delegated work, preserve middleware recovery and the caller's selected result/error; no unconditional bidirectional bridge forwarding |

Configuration reload and plugin replacement must retain the behavior supported by live Web profiles before those profiles switch. Replacement closes old admission and completes conflicting resource cleanup before publishing its successor. A failed replacement reports failure rather than silently restoring an incompatible or partly disposed composition.

### Metadata and profile configuration

Use a new `package.json.dsh.native` declaration with `apiVersion: 1`, `entry` (an exported package subpath), `targets` (`host` and/or `client`), and service-name arrays `requires`, `optional` and `provides`. The entry exports `plugin`, whose native protocol declaration must agree with this metadata. Its `resolve(config)` operation validates configuration and returns activation data without acquiring resources. Unknown revisions, invalid exports and unsupported targets fail before activation; statically decidable metadata errors fail before importing plugin code. Preserve `dsh.runtime` unchanged as role metadata; npm, native API, DSH compatibility and Session versions remain separate.

Select native composition through `dsh.profile.runtime: "native"` and `dsh.profile.config: "rsh.profile.json"`; an omitted runtime preserves the existing legacy interpretation during migration. `rsh.profile.json` is JSON with `formatVersion: 1`, `scopes` and `installations`. Scope rows contain unique `id` and optional `parent`; installation rows contain unique `id`, package-name `plugin`, `scope`, optional `config` and optional `disabled`. Root scopes omit `parent`. Reject unknown fields, missing references and scope cycles; `disabled: true` excludes that row before dependency planning. Package metadata resolves the exported entry; user configuration cannot select arbitrary module paths. The deployment selects Host or Client and validates each selected entry against it.

Keep `dsh --profile` and the existing `--patch` option. For native profiles, a patch is JSON with `formatVersion: 1` and `installations` rows keyed by existing installation `id`; rows replace the complete `config` value and/or set `disabled`. Reject duplicate or unknown ids, unknown fields, executable YAML and implicit Cordis interpretation. Apply explicit patches in argument order before resolving the plan. Legacy bundle, home and profile Cordis patches remain owned by the compatibility interpreter; migration must preview and explicitly map applicable values or refuse unsupported input, never silently ignore a user's existing patches. P1 owns protocol declarations and validation; P2 updates manifest readers, profile resolution, generators and consumers together before enabling native launch. No new CLI flag or executable is introduced.

### First compatibility scope

These are the selected first compatibility targets, not currently supported native bridge claims. The bridge must select one Provider per scope and one authoritative direction per event; native and legacy contributions may not both execute or record the same operation.

| Legacy target | Required native interfaces | Acceptance / refusal |
|---|---|---|
| `rsh/Modules/Official/fs/fs-local` | Filesystem Definition, owned Provider registration and cancellation | A legacy Provider can serve an unchanged native Consumer; duplicate providers fail before activation |
| `rsh/Modules/Official/fs/fs-observation-policy` | Filesystem decision/observation events and the initiating session identity | Preserve unseen/absent/present distinctions, stale guards and per-session isolation; unload drops only that policy's state |
| `rsh/Modules/Official/fs/tool-fs` | Native Tools and System Prompt registries, filesystem, execution actor, optional attachment and approval capabilities | One tool registration/execution and one durable model-visible result; required capability absence rejects, optional attachment absence retains existing behavior |
| `rsh/Modules/Official/fs/fs-sandbox` | Shared local storage and native sandbox-policy resolution | Denied mutation leaves files unchanged; no automatic fallback to bare local storage |
| `rsh/Compatibility/DSH/bundle/base` as a whole | Contains Engine authority and full product composition | Not loaded inside the bridge; selectively adapt supported contributions instead of creating a second loop or store |
| Undeclared plugins, unsupported versions or configuration constructs | An explicit supported adapter and mapping | Reject with the plugin/field identified; no silent omission or speculative private-API emulation |

### Migration ownership and phase exits

Each phase is developed, validated, committed and pushed as its own PR. Review findings are fixed and revalidated until the phase is ready to merge. Only after its merge does the next phase start from freshly fetched `origin/main`. Existing later-phase prototypes are retained separately and incorporated only when their phase starts.

| Phase / owner | Paths and deliverable | Prerequisite / exit evidence |
|---|---|---|
| P0 / implementation owner | This decision: responsibility table, execution semantics, compatibility scope, migration ownership, baseline selection and interface handoff | Review the design and run the selected existing-composition baseline; merge the documentation PR |
| P1 / implementation owner | `rsh/Core/runtime-diagnostics`, `rsh/Scripts`, workspace/compiler/build wiring: independent runtime, diagnostics, lifecycle fixtures and dependency checks | P0 merged; valid/invalid graph, lifecycle, event and scope cases plus packed native library consumer; exact source/type/manifest rules execute in a top-level check |
| P2 / implementation owner | `rsh/Modules/Official/fs`, minimal `rsh/Engine` authorities, `rsh/Programs/CLI` profiles and `snapshots`: real native filesystem/headless flow | P1 merged; real files, tool execution, logging, persistence, cancellation, restore and exit through the supported profile entry; only the external model is substituted; prove no Cordis Context is created |
| P3 / implementation owner | Official compatibility module and the selected matrix above | P2 merged; native services consumed by legacy plugins and legacy contributions consumed by native registries; version/config refusal, no duplicate authority/events, awaited unload |
| P4 / implementation owner | Remaining `rsh/Engine`, `rsh/Modules`, `rsh/Programs/Web`, Desktop, SDK, ACP and TUI owners | P3 merged; capability-complete migration, initiator/concurrency/security behavior, supported reload and replacement, Host/Client boot and both SDK projections |
| P5 / implementation owner | Profile defaults, package manifests/exports, compiler faces, bundling and distributions | P4 merged; full target profile acceptance before default switch; installed production closure and public declarations work without Cordis/bridge; browser and renderer included |
| P6 / implementation owner | Owning documentation, generated catalogs and final requirement/evidence audit | P5 merged; every promised entry, data behavior, negative dependency fixture and platform claim has matching evidence; remove stale migration exceptions and merge delivery PR |
| B1 / implementation owner | Cordis/DSH usage and plugin inventory, classified by native migration, retained compatibility and test tooling | Maintain the inventory and update its classifications as migrations land |
| B2 / implementation owner | Loader/HMR/unload baseline and supported-path gap resolution | Keep Cordis behavior under its owner and validate each supported reload/unload path in its owning runtime |

B1/B2 are implementation-team deliverables, not external dependencies or prerequisites that suspend the authorized route. Other B work, including dependency-check negatives and compatibility fixtures, belongs to the implementation owner when required. The implementation owner resolves each of the six `runtimeLayerExceptions` in `rsh/Scripts/check-workspace-constraints.ts` during P4, with the owning capability migration. Any remaining exception must identify its exact path, responsible owner and removal phase before P5; broad indefinite allowlists are not acceptable.

Before a profile switch, provide configuration migration preview and backup, and retain a reproducible validated version with an explicit legacy profile for rollback. Rollback selects a validated version/composition; it never silently substitutes a Provider or assumes older builds can read newly written data.

### Baseline and handoff evidence

The P0 regression baseline uses the existing plugin-host ownership tests, real filesystem Loader composition and base-bundle composition below. It demonstrates the compatibility behavior available at the starting revision, not native execution. Provider, policy and data-specific tests are selected again in the phase that changes their owner; a passing baseline does not prove future migration.

```sh
pnpm exec vitest run rsh/Compatibility/DSH/bridge/compat-plugin-host/tests/plugin-host.spec.ts rsh/Modules/Official/fs/tool-fs/tests/runtime-loader-composition.spec.ts rsh/Compatibility/DSH/bundle/base/tests/base.spec.ts
```

P1 hands P2/P3 the public planning, service, scope/initiator, event, configuration, diagnostics and awaited-disposal interfaces together with deterministic lifecycle fixtures. P2 adds the real profile fixture with filesystem and durable Session assertions. P3 adds the supported bridge matrix and refusal cases. Tests use observable readiness and controlled barriers; elapsed time, an issued abort or a launched process is insufficient completion evidence.

## Alternatives considered

**Keep only role descriptors over Cordis:** This records ownership but retains a mandatory framework dependency and cannot support native-only deployment.

**Run a new loop beside the legacy base bundle:** This creates competing Agent, tool and Session authorities and makes logging, cancellation and recovery ambiguous.

**Replace every package before validating a product path:** This delays the discovery of policy, lifecycle, Client and SDK regressions. Complete capability slices provide earlier behavioral evidence.

**Treat source tests as distribution acceptance:** Compiler aliases and installed workspace dependencies can hide declaration, export and production-closure defects. Separate packed-consumer evidence is required.

## Acceptance criteria

- P0 is complete when its tables, interface obligations, compatibility selection, delegated exclusions and executed baseline are reviewed and its PR is merged; this does not complete P1–P6.
- Native Core, Engine and migrated Modules exclude Cordis/bridge source imports, type references and required production dependencies; checks resolve aliases, subpaths, dynamic loads and module augmentations and reject invalid fixtures.
- Real native filesystem and headless profiles execute, log, cancel, restore and shut down using one Engine authority, unchanged approval/sandbox decisions and preserved Session generations.
- Compatibility is explicitly selected, bounded by the supported matrix, refuses unsupported inputs and releases its own contributions without duplicate execution or durable records.
- The installed CLI binary has no static load of optional packages; compatibility modes check their direct optional dependencies before dynamic import, and native profile launch succeeds from a production install without optional dependencies.
- CLI, Web, Desktop/renderer, TUI, ACP and both SDKs retain their supported behavior, including applicable configuration reload and plugin replacement.
- Packed native-only consumers compile and run without Cordis or the bridge; final documentation distinguishes verified Windows results from platform coverage not run locally.

## Risks

Framework coupling can hide in types, manifests, generated artifacts, initiator propagation and teardown rather than direct imports. A backend-only result can conceal missing tool policy, Client presentation or SDK projections. Unsupported legacy behavior must be rejected explicitly until its mapping is implemented and tested. Historical data is preserved, but a successful write does not imply a future older build can read new data; this migration avoids gratuitous format changes.
