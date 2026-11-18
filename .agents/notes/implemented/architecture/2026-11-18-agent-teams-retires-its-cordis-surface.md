# Agent Note: Agent Teams retires its Cordis surface

Status: implemented

English | [中文](2026-11-18-agent-teams-retires-its-cordis-surface.zh.md)

## Problem

[The Native Agent Teams runtime](../feature/2026-11-17-agent-teams-native-runtime.md) made `@redspark/rsh-experimental-agent-team` and `@redspark/rsh-experimental-tool-agent-team` Native-only: the domain service and its nine tools register through `NativeContext`, and neither manifest declares `@redspark/cordis`. Three packages existed only to compose the Cordis half. `agent-team-profile` was a `cordis.patch.yml` layer inserting `ctx.agentTeams` and the Cordis tools. `agent-team-web-profile` inserted the browser layer after the stable Web bundle. `client-ui-agent-team` rendered the roster and task board from the generated `ctx.remote.agentTeams` Typert methods.

Once the service has no Cordis registration, no loader can mount either profile layer, and the browser contribution consumes Remote methods the Native service does not publish. The three packages are published artifacts, so leaving them in place would advertise a composition that cannot start.

## Decision

Delete `agent-team-profile`, `agent-team-web-profile`, and `client-ui-agent-team`, together with the Web panel scenario and every row that named them. The deletion moves the CLI devDependency, the public-experimental package policy, the `cordis-client-runner` slot-catalog occupant, the Web application test entry, the experimental package table, the capability-seams entry, and the generated config catalog and module graph.

The Agent Teams capability itself stays. Its Web presentation retires with the Cordis surface: a Native profile still provides `agentTeams` and the nine tools, but nothing renders the roster in a browser.

The tool catalog harvest follows the package. `gen-tool-catalog` no longer mounts a Cordis plugin for the Team tools; it boots the Native registry with stub `agentTeams`, `agents`, `activeSessions`, and `promptSections` seams, and reads the same nine schemas from the real registry. A future Team schema change therefore appears in the catalog without a second Cordis harness.

Test coverage moved with the implementation. `native-roster`, `native-mailbox`, `native`, `projection-events`, and `session-message` carry the identity, provisioning, recovery, task, and stream cases the deleted Cordis suites held. The invariant companion's candidate-event replay is covered by the journal's strict projection read before each mutation.

## Alternatives considered

**Keep the three packages as published artifacts.** Rejected: their entire content is patch rows for a service no longer registered on `ctx`, and a shipped profile that names them cannot start.

**Port the roster and task board to Native events in the same change.** Rejected here: it needs a Native Team projection exposed to a client plus Web slots that no shipped Native Web surface has. That is a product addition, not the cleanup that removing an unmountable composition requires.

**Keep the Cordis mount recipe in the catalog generator.** Rejected: the package no longer exports a Cordis plugin, so the generator could not typecheck against it.

## Consequences

`agent-team` and `tool-agent-team` are Native-only and match no Cordis service name in their sources. [What still depends on Cordis](../../proposed/architecture/2026-11-10-what-still-depends-on-cordis.md) loses three `cordis-only` packages, and [Cordis cleanup keeps the legacy writers and three packages](../../proposed/architecture/2026-11-15-cordis-cleanup-keeps-legacy-writers.md) no longer applies its web-profile clause; the other two retained packages are unaffected.

A deployment that mounted `agent-team-web-profile` loses the Team panel. The model-facing tools and durable Team state are unchanged.

The generated config catalog lists neither Team package any more. It classifies a package by its Cordis entry point, and both entries are now Native plugins whose configuration is a zod schema. The package READMEs point at the resolver instead, and the two sections return when the generator learns the Native entry shape.

## Verification

- No manifest, tsconfig, README, policy list, or generated catalog names the three packages.
- `pnpm install` resolves the workspace and `pnpm run typecheck` passes.
- `pnpm run gen-tool-catalog` reproduces the same nine Team tool schemas from the Native registry.
- `@redspark/rsh-experimental-agent-team` and `@redspark/rsh-experimental-tool-agent-team` declare no `@redspark/cordis` dependency, peer, or import.

## Risks

- Removing a published package is a breaking change for a consumer outside this repository. The experimental name carries no stability promise, and the composition it described could not start after the Native-only runtime change.
- The Web Team UI has no replacement. Treat a future browser roster as a new capability with its own projection seam rather than restoring the Remote-method path.
