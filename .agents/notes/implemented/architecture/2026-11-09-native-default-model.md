# Agent Note: A Native default model selection

Status: implemented

English | [中文](2026-11-09-native-default-model.zh.md)

## Problem

`@redspark/rsh-agent-default-model` publishes the route an Agent falls back to when it has no session-specific selection. It existed only as a Cordis service: `AgentDefaultModelConfig` reads a stored settings section through `ctx.settings` and is read by the Cordis agent loop.

`native-headless` has the same concept but no owner. Its `NativeHeadlessAuthority.defaultModelSelection` callback is consulted on every root step before Session selection capture, and nothing in a composed profile supplied it. A Native profile therefore had to write the route into the `app` row config, which no settings change could reach.

## Decision

The package publishes `./native`, providing the `agentDefaultModel` service. `NativeAgentDefaultModel` carries the composed entry and adopts a stored settings section when the `settings` service is installed: `register` supplies the resolved section, `watch` adopts each committed change, and the registration is disposed with the Provider. The section outranks the composed entry from the first step, so an operator changing the default in the Native Settings page reaches the next Agent without a restart.

`native-headless` now reads `agentDefaultModel` as an optional service and passes `() => defaultModel.currentSelection()` into the authority, so a profile that composes the row gets the fallback without changing the application row.

The service type and the branded selection live in `src/native-definition.ts`, following the existing mixed-entry pattern: a strict native owner may import a mixed package's declaration module, but not its entry. `native-headless` therefore imports the definition, not `./native`.

Three composition facts had to be registered for the row to load at all: the package has no `dsh.native` manifest before this change, its `tsdown` entry built only `index.js`, and its path aliases were absent until `gen-tsconfig-paths` ran. Each of those failed differently — an invalid-package rejection, a missing `lib/native.js`, and a source the compiler face never saw.

## Alternatives considered

**Keep setting the route in the `app` row config.** Rejected. That value is a static composition entry; a deployment changing its default model would need a profile edit and a restart, and the Native Settings page could not reach it.

**Fold the default into `modelSelection`.** Rejected. `native-model-selection` already takes the Program's current defaults as an argument and records per-Session intent; it deliberately owns no global default. Merging the two would put deployment policy inside the per-Session service.

**Read the settings document directly.** Rejected. A Provider that reads the document itself would bypass the resolved-value publication and change notifications the settings service owns, and would diverge from the Cordis owner on when a write becomes effective.

## Consequences

A Native profile can now compose a deployment default model that a settings change reaches live, which is the shape the Cordis owner already had. This removes one of the two remaining blockers for moving the recorded session scenarios off the Cordis profile: 23 scenarios name this package.

The Provider is optional. A profile without it keeps the `app` row config as its fallback, exactly as before.

Verification: `tests/native.spec.ts` covers the composed entry with no settings Provider, a stored section outranking it, an adopted committed change, and rejected configuration. Replacing the adoption call with a no-op fails the override case.
