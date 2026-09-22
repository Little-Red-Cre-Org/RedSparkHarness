# Agent Note: Framework-free native installation foundation

Status: implemented

English | [中文](2026-09-22-native-runtime-foundation.zh.md)

## Problem

Cordis Fiber owns current plugin installation and service visibility. A native product cannot reach its existing Agent, tool and Session capabilities while that ownership is required by every package. The [native-runtime migration proposal](../../proposed/architecture/2026-09-22-rsh-native-runtime-and-optional-cordis.md) defines the complete product route; this note records the foundation that now exists.

## Decision

`@deepseek-ai/dsh-native-runtime` under `rsh/Core/runtime-diagnostics/native-runtime` provides an independent installation plan, scoped services, four event modes, owned registrations and awaited disposal. `resolveInstallation` rejects target, dependency and provider conflicts before activation. Configuration resolution returns activation work and does not acquire resources. The Host publishes every promised service only after activation succeeds and rolls back registrations and resources on failure.

The Host records configuration-free diagnostics with opaque installation identities, selected provider identities, lifecycle state, failure phase and cleanup outcome. `run(scope, initiator, work)` passes each initiating actor explicitly into its asynchronous operation and stop drains admitted work. The runtime does not guess the actor from a plugin's installation scope. `parseNativeEntryManifest` checks the new `dsh.native` JSON declaration and exported subpath before code loading; `validateNativePluginEntry` checks the imported declaration before planning. Existing `dsh.runtime` keeps its role-metadata meaning.

`@deepseek-ai/dsh-brand` and the new `@deepseek-ai/dsh-errors` are portable Core utilities. The model error module re-exports the shared error identity for existing consumers; `dsh-llm` requires `dsh-errors` as a peer so `instanceof HarnessError` retains one shared constructor. The `verify-native-dependencies` gate checks both TypeScript compiler faces and every native source owner against the explicit native roster, and refuses external source and manifest dependencies, computed loads and malformed native metadata. The repository's Cordis peer rule remains in force for non-native packages.

## Alternatives considered

**Keep Fiber behind a renamed interface:** The native packages would still require Cordis at type or runtime load and fail the independent distribution goal.

**Infer the initiator from installation or event registration:** Parallel Agent/tool calls could use one another's session authority. The actor remains an explicit per-operation value.

**Globally remove Cordis peer requirements:** That would hide accidental missing peers in legacy packages. The exception is limited to the exact native package roster and has negative tests.

## Consequences

The runtime library can be built and consumed without Cordis, and its source and manifest edges are checked from both compiler faces. Current `dsh` profiles still use the legacy composition. Engine must supply the real Agent/tool actor, own Session flush order and connect the native runtime to a real profile before native product behavior exists. An operation cannot await `stop()` or `remove()` while that operation is part of the drain; orchestration invokes and awaits disposal from outside the affected work. Static manifest validation does not load packages; the future profile loader owns that I/O and the before-import check.
