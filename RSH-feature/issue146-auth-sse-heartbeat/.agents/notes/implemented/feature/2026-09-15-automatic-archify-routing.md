# Agent Note: Automatic Archify routing

Status: implemented

English | [中文](2026-09-15-automatic-archify-routing.zh.md)

## Problem

Harness users need validated architecture and runtime-flow artifacts without manually installing a separate profile or paying a prompt-context cost on ordinary code and discussion tasks. Archify already owns typed specifications, validation, renderers, examples, viewer assets, and its CLI. Recreating that implementation in Harness would create a second maintenance owner, while exposing a broad model-visible Skill catalog entry would change every eligible request prefix and invite false-positive use.

## Decision

`@deepseek-ai/dsh-archify` is a released `skill/` plugin and a direct dependency of `@deepseek-ai/dsh-base`. It pins `@tt-a1i/archify-dsh@0.1.0`, resolves its installed `SKILL.md` through the package manifest, and exposes one bundled `archify` provider. The upstream package owns its instruction body, schemas, diagnostics, renderers, examples, viewer, and CLI. Harness owns the provider, routing policy, package version, profile composition, and compatibility coverage.

The Cordis provider is `{ modelInvocable: false, userInvocable: true }`. Generic model catalogs and the `skill` tool therefore do not advertise or load it, while Cordis profiles retain the existing direct `/archify` gesture. The package-root plugin registers before `dsh-tool-skill` in `dsh-base`, so an explicit gesture remains the final injected instruction and automatic selection cannot duplicate it.

The shared matcher observes all eligible direct-user text as one bounded input. The combined text must fit within configurable `maxUserTextChars`; over-budget text disables automatic routing even when its observed prefix contains both configured phrase families. Within the bound, a match requires an action and diagram phrase and skips any direct `/archify` gesture. Manual `/archify` remains available independently of the automatic observation limit.

The Cordis listener runs during `agent/pre-step`. It returns ordinary requests unchanged, ignores text from any non-user source, and resolves a matching winning scoped Skill with the turn abort signal. It appends one rendered instruction message with the typed `archify-auto-invocation` source, making the selected upstream body model-visible and durable through the existing `user/message` event, without changing `agent-loop`, Session format versions, SDKs, tools, presenters, credentials, or sandbox policy.

The package also exports a Cordis-free Native Host plugin at `./native`. It registers the same hidden Skill provider and shell environment contributor, then registers a `requestContexts` provider when `autoInvoke` is enabled. The provider uses the shared configuration defaults and direct-user matcher, resolves the winning Skill with the request scope, owner Session cwd, and abort signal, and returns an instruction message with the same source type when the Skill remains user-invocable. The absolute package directory is returned only through `DSH_ARCHIFY_SKILL_DIR`; the instruction body and source type do not contain it. Exporting this entry does not select it in the shipped Cordis profile composition.

Archify commands still use existing shell, filesystem, permission, and `present` capabilities. The agent validates the candidate, runs upstream delivery, and records accepted JSON and HTML through `deliverables/presented`; no Archify-specific tool or client card exists.

The provider contributes its resolved upstream directory as managed `DSH_ARCHIFY_SKILL_DIR` to existing shell tools. Rendered instructions enumerate installed JSON resources and require discovery through the shell, because code workers do not inherit these per-execution environment contributions. Self-contained commands keep the user workspace as the working directory and prefix package resources with the managed variable. Delegation carries the same guidance; PATH lookup and repository search are not availability checks. The instruction body contains no machine-specific package path.

## Alternatives considered

**Keep the private opt-in profile bundle.** Rejected because a user must know the package and profile lifecycle before the product can help, despite a stable enough upstream payload and a small deployment-owned routing rule.

**Copy selected upstream source into Harness.** Rejected because it forks the schemas, diagnostics, renderers, viewer, and tests without an independent Harness interaction that warrants a second implementation owner.

**Add native `archify_validate` and `archify_render` tools.** Rejected because current shell and delivery surfaces already provide the required permission and Session behavior. New tool schemas, Service Definition/provider/consumer roles, Session events, SDK projections, and presenters would duplicate working behavior.

**Advertise Archify to every model through the generic catalog.** Rejected because its summary would alter every catalog-bearing request and model discovery can select the wrong work. Hidden deterministic routing leaves ordinary requests unchanged.

## Verification

Cordis compatibility tests cover hidden provider discovery, unmatched and non-user bypasses, automatic injection, explicit invocation, deployment controls, durable agent-loop instructions, real profile boot, failure preservation, and `present` recording. A shell regression executes the rendered commands from a separate Unicode workspace, reads the enumerated JSON files, and checks showcase delivery. The `archify-auto-routing` keyless headless snapshot replays the injected instructions with its own PowerShell header pin through `dsh --profile headless`. The Native SDK Archify snapshot exercises automatic request-context injection, manual `/archify` loading after cold recovery, both SDK projections, and durable source events; it also checks that the installed absolute path stays out of model requests and the Session log. These checks do not establish successful live-model Godot analysis or human-reviewed visual quality.

## Consequences

Cordis standard base-backed profiles gain the same low-overhead capability, including Desktop through its base-bundle runtime closure. A Native Host composition can install the exported `./native` entry explicitly; exporting it does not change a shipped Native default. An explicitly assembled Native TUI can also route `/archify` when the composition installs Archify and the Native `dsh-tool-skill` consumer with its request-context registration. Normal requests perform bounded in-memory text checks only; they neither read the upstream Skill nor receive an Archify catalog entry or instructions. A Cordis or Native TUI user can select the exact behavior with `/archify`, and a deployment can disable automatic selection or replace phrase lists through a later profile patch. Visual quality remains a human check after upstream validation, and upgrade remains an explicit dependency change with the same routing, loader, and artifact acceptance.
