# Agent Note: Native PTC and creation presets

Status: implemented

English | [中文](2026-10-20-native-ptc-and-creation-presets.zh.md)

## Problem

The native roster marks `ptc` and `cordis` as needing migration because those folders have only `agent.cordis.yml`. The Cordis presentation selector and Cordis toolset are compatibility-optional packages, so a native profile cannot install those rows.

## Decision

Native web and TUI profiles register `ptc` and `cordis` child scopes. `ptc` installs the standard persona and `run_code` with `presentation: ptc`, and hides an inherited `workflow` tool when the parent scope publishes it. `cordis` installs a persona that tells the model how to author `agent.native.json` presets. Both folders ship `agent.native.json` with those same rows. `presentAs(mode, scope)` lets a descendant scope shadow the provider tool mode; program bindings stay visible. The Cordis compositions remain for the legacy runtime.

## Alternatives considered

**Bridge `@deepseek-ai/dsh-agent-tool-presentation` and `@deepseek-ai/dsh-tool-cordis`.** Rejected because those packages stay outside the native Desktop closure, and creation mode would still teach Cordis composition on a native host.

**Set the shared tool registry to PTC.** Rejected because standard and minimal sessions use that same registry.

**Leave the cards unselectable.** Rejected because a native session cannot choose the shipped PTC or creation preset.

## Consequences

A PTC session's model sees only `run_code`. Other inherited tools remain program bindings, except `workflow`, which that scope hides when it is published. Creation mode does not inspect or mount Cordis plugins; it writes preset directories with the file tools. An existing profile expands the new folders on the next load and does not rewrite `rsh.profile.json`. A profile that does not provide a row's required service lists that preset as invalid and still starts. A profile that already registers those ids uses its standing rows and skips the folder rows. `minimal` still has no `agent.native.json`.
