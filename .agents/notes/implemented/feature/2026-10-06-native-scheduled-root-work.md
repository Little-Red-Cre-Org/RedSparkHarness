# Agent Note: Native scheduled root work

Status: implemented

English | [中文](2026-10-06-native-scheduled-root-work.zh.md)

## Problem

The compatibility scheduler stores durable plans, but a native profile cannot execute a due plan through its selected Program without creating a second Agent or Session writer. A scheduled request also must not inherit management tools and recursively create more plans.

## Decision

The `task-scheduler` package exposes a native Provider and model-tool Consumer over its existing SQLite plan and receipt store. The selected Program's `rootExecution` service captures the creator's immutable route and owns every due root Session. Each shipped interactive native profile has its own database. A due run first opens an idle root transaction to remove inherited task management, then executes its prompt through the same root authority. Before publishing either owner, the Program persists an ignorable `session/root-origin` record and exposes that classification on the active owner. Provider replacement and cold restore therefore continue to deny scheduled Sessions interactive management even if the process stops after maintenance and before prompt admission. The result is an independent persisted Session; a completed receipt certifies a settled Agent turn, not the correctness of the work.

Native plans record the route and resolved execution configuration. Startup checks that each stored route still resolves to that configuration before admitting due work. Compatibility plans carry Agent and permission presets instead and cannot be adopted by the native Provider. Interrupted receipts are retained without replay because external effects may have happened. Native Goal continuation and personal reminder delivery are unavailable until their own Providers exist; the native tool does not offer those modes.

The Cordis gateway loads `@deepseek-ai/dsh-typert-protocol`, and the published Client declarations refer to its `RemoteResult` type. The Native entry does not use this protocol, so the peer is optional for Native consumers; compatibility profiles that install the package must provide it.

## Alternatives considered

**Run the compatibility Agent loop in a native profile:** Rejected because it would create a second execution and Session authority.

**Reconstruct a route from the saved model and workspace:** Rejected because deployment policy and prompt configuration could change silently on restart.

**Replay interrupted runs automatically:** Rejected because a model or tool may have performed external effects before interruption.

## Consequences

The scheduler is an opt-in installation in `native-web` and `native-tui` first-use compositions. Existing user profile files stay untouched. The shipped native SDK profile does not install the scheduler by default, but a keyless TypeScript and Python carrier validates scheduled-origin persistence and same-Session cold restore through its `rootExecution` service. ACP scheduling is not validated by this change.

## Verification

Focused native Host scenarios cover due-plan execution, independent durable Sessions, origin persistence before maintenance-only owner publication, Provider replacement and cold restore, denied recursive management, owner management without model requests, cancellation, and canonical tool results. Paired TypeScript and Python SDK cases confirm the ignorable origin marker remains in the durable Session across close and same-Session cold restore, while the current-run projection does not replay that historical marker and preserves turn events and the final response. Profile-template and native dependency checks cover installation metadata and the Cordis-free entry graph.
