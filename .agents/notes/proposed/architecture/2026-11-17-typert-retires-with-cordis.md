# Agent Note: Typert retires with Cordis

Status: proposed

English | [中文](2026-11-17-typert-retires-with-cordis.zh.md)

## Problem

[Retiring Cordis in five measured phases](2026-11-12-cordis-retirement-five-phases.md) names `TypertRemoteService` as the one Phase C surface with no Native successor: 23 classes extended it on 2026-11-12, half of them under `rsh/Programs/Web`, and no capability key replaces its Remote-method registration. [Cordis cleanup keeps the legacy writers and three packages](2026-11-15-cordis-cleanup-keeps-legacy-writers.md) defers those classes and the `profile: web` snapshots to "a separate interface migration" without defining that migration's target. Phase C cannot close until this note records whether Typert moves to Native.

Cordis cannot be deleted while that question is open: Typert is a Cordis-shaped RPC face (decorated methods on services, a Loader-driven registry, generated `./typert` and `./remote` artifacts), and deleting its runtime first would leave generated clients pointing at descriptors nothing serves. Guessing in either direction is expensive — porting Typert duplicates a transport that Native already ships, while deleting it early removes legacy Web capabilities before their Native owners exist.

## Proposal

Typert is legacy-only and retires with Cordis. Native keeps the transport it already ships: the shared Connection registry (`@redspark/rsh-client-connection/native-host`) with per-package `./native` faces, as described by [native-web-host](../../../../rsh/Programs/Web/host/native-web-host/README.md). No Typert package, decorator, generator, Gateway, or `ctx.remote` namespace receives a Native successor.

### What this note freezes

- No new `@Remote` method, `TypertRemoteService` subclass, or generated `./remote` contribution is added to a package that ships a Native face. Legacy methods stay as they are until deletion; new Web behavior is implemented on the Native face.
- No package in `nativePackageDirectories` or `nativeSafeSourceSubpaths` imports `@redspark/rsh-typert-*`. The tree has zero such imports today; `verify-native-dependencies` must reject the edge so a later Native feature cannot reintroduce it.
- Typert deletion belongs to the Cordis package-removal phase (Phase E), after Phase B and Phase C finish. It is not an interface-migration prerequisite by itself: the interface migration is the Native faces that already exist.

### Web capability owners

Every Typert-backed capability either already has a Native owner or dies with the Cordis-only extension tooling. Sizes are the current tree: 24 exported `TypertRemoteService` subclasses across 33 packages importing the protocol.

| Capability | Typert service (owning package) | Native owner |
|---|---|---|
| Plugin inventory | `PluginInventoryGateway` (`Programs/Web/host/plugin-inventory`) | CLI `dsh-native-plugin-inventory` provider plus `ui-settings-plugin-inventory/src/native-*` |
| File upload | `FileUploads` (`Programs/Web/client/file-upload`) | The same package's `dsh.native` entry |
| Workspace files | `WorkspaceFiles` (`Programs/Web/api/workspace-files`) | `workspace-files/native-helpers` registered on the Native Web routes |
| Directory picking | `DirectoryPickerController` (`Programs/Web/api/workspace-controller`) | `directory-picker-native`, `-browse`, and `-auto` |
| Workspace selection | `WorkspaceController` (`Programs/Web/api/workspace-controller`) | Native workspaces in `native-session` with the Native chooser |
| Settings, credentials, authorization | `SettingsController`, `CredentialsController`, `AuthorizationController` (`Programs/Web/api/settings-controller`) | Native settings documents (`settings-file/native`) and the Native settings pages in `native-application` |
| Sessions, references, skill catalog | `SessionController`, `SessionFileReferences`, `SessionSkillCatalog` (`Programs/Web/api/session-controller`) | `native-web-session-controller` plus `native-session` |
| Commands | `CommandRuntime` (`Modules/Official/interaction/commands`) | The Native command service in the same package |
| Feedback | `MessageFeedbackService`, `SessionFeedbackService` (`Modules/Official/feedback/*`) | The packages' Native definitions |
| Scheduling | `TaskSchedulerGateway` (`Modules/Official/automation/task-scheduler`) | `native-schedule-controller` plus the Native scheduler |
| Agents, goals, models, references | `SubagentRuntime`, `AgentPresets`, `GoalService`, `LlmRuntime`, `SessionReferenceResolver` | `native-subagent`, the Agent Presets Native definition, the Native Goal service, `native-model-selection` with `native-model-execution`, and `session-reference/native` |
| Agent Teams | `TeamService` (`Modules/Community/experimental/agent-team`) | `agent-team/native` provides `agentTeams`; `tool-agent-team/native` installs the same nine tools ([decision](../../implemented/feature/2026-11-17-agent-teams-native-runtime.md)) |
| Cordis extension tooling | `DynamicCordisRunnerService`, and `LlmRuntime`/`SubagentRuntime` in `tool-cordis` | Intentionally none: these packages exist to run or inspect Cordis and are deleted with it |

### Deletion scope

The package-removal phase deletes these together, not in separate sweeps:

- `rsh/Core/typert/{generator,loader,protocol,registry}` and the `typertPlugin` build step.
- `rsh/Programs/Web/api/gateway` and `rsh/Programs/Web/api/remotes`, including their forwarded-event selection and `ctx.remote.$mount()` assembly.
- The Cordis faces named above — the `*Controller` packages, the legacy halves of `workspace-files` and `file-upload`, and the `@Remote` surface of mixed Engine packages — while their Native faces stay.
- `extensions/{tool-cordis,cordis-host-runner,cordis-client-runner,ui-cordis}`, `experimental/inspector`, and the Cordis half of Agent Teams once its Native runtime exists.
- Generated `lib/typert*.js`, `lib/remote*.js`, and declaration merges, plus their `package.json` exports; `Tests/test-support/remote-mock`; the `typert` doc-graph entries; the `type-equiv` manifest entries for Typert symbols; and the `gen-doc-graphs`/`gen-cordis-inspect-catalog` dependence on `typert-generator`.

## Alternatives considered

**Port Typert to Native.** Rejected. The Native side already has an authenticated channel registry with Fetch routes, streaming, cancellation, and reconnect behavior; a Typert port would keep two RPC pipelines and two code generators. The registry also reacts to Loader entries, which Native does not have, so the port is not a transport swap but a second product surface with no current consumer.

**Extract Typert into a Cordis-free generic typed-RPC library.** Rejected. Its value is the decorated Host surface plus generated client merges, and every consumer is a legacy Cordis assembly. Extracting it would keep the generator, the Gateway protocol, and the `ctx.remote` client shape alive after their only consumers are gone, while the Native Connection registry would still need its own definitions.

**Replace the Native Connection registry with Typert.** Rejected. That would regress shipped Native Web authentication, route registration, live client reload, and streaming to an unported surface, and it contradicts the phase order: Native capability is the exit criterion for deleting Cordis, not the code being deleted.

**Keep the classes as plain Node services without the wire face.** Rejected for Web controllers. A controller whose only role is to expose methods through `ctx.remote` has no behavior left once the wire face is gone; the Native owner already holds the state and policy.

## Acceptance criteria

- `verify-native-dependencies` rejects `@redspark/rsh-typert-*` imports from every package in `nativePackageDirectories` and from every `nativeSafeSourceSubpaths` entry, with a fixture proving the rejection.
- A repository search for `TypertRemoteService`, `@Remote`, `@redspark/rsh-typert-`, and `ctx.remote` outside `rsh/Core/vendor`, `rsh/Compatibility`, legacy tests, and the legacy halves finds nothing after deletion.
- The deletion PR removes the four Core packages, Gateway and Remotes, the generated artifacts and their exports, the doc-graph and `type-equiv` entries, and the `typertPlugin` build step in one change; `pnpm run build`, `pnpm run typecheck`, `pnpm run test:coverage`, and `doc-sync` pass on the result.
- No snapshot directory still selects `profile: web` or a legacy SDK/ACP profile, and the Native Web, TUI, SDK, and ACP suites pass with the same model-visible output they produce today.
- Agent Teams keeps its Native runtime (`agent-team/native` and `tool-agent-team/native`); the deletion PR removes `TeamService`, its Typert methods, and the Web Team panel's Remote wiring together.

## Risks

Agent Teams now has a Native runtime, so the former open dependency is closed. The remaining Typert consumer is the Web Team panel: deleting the transport before that panel moves to the Native client removes the only browser surface for rosters and tasks, so the deletion PR must remove the panel and its Remote wiring in the same change.

Two face pairs remain until deletion: the legacy `ctx.remote` client and the Native client for settings, workspaces, sessions, and tools. Every new Web feature therefore lands twice or lands Native-only. The freeze above chooses Native-only for new work and accepts that legacy Web stops gaining features during the removal window.

Generated artifacts are the likely residue. `./typert` and `./remote` exports, declaration merges, the `type-equiv` manifest, and the doc-graph generator all reference the protocol indirectly; deleting the source packages without removing those entries leaves a tree that typechecks against stale declarations or fails at build time. The acceptance criteria require one deletion change for all of them.

Today's zero native imports are not enforced by a gate. Without the rule, a future Native provider could import `typert-protocol/types` for `RemoteResult` or `RemoteError` and silently re-create the dependency this note removes; the gate is the durable part of the decision.
