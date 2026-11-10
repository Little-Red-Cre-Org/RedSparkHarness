# Agent Note: A Native deployment persona

Status: implemented

English | [中文](2026-11-09-native-persona.zh.md)

## Problem

The Cordis prompt registry composes a deployment persona from two named sections, `deployment:persona-prefix` and `deployment:persona-suffix`, and takes them from `Config.personaPrefix` / `Config.personaSuffix`. Thirty-eight recorded session scenarios configure a persona this way, most through `{{cwd}}` and `{{model}}` references.

The Native prompt registry had no equivalent. It rejected every configuration value and composed only the sections other Providers registered, so a Native profile could not state who the Agent is. Moving those thirty-eight scenarios to a Native profile therefore could not preserve their model-visible prompt.

## Decision

`native-prompt` accepts `personaPrefix` and `personaSuffix`, registering each as a section with the Cordis names and orders: `deployment:persona-prefix` at 0 and `deployment:persona-suffix` at 10200. Both run through the Registry's existing strict `{{variable}}` interpolation, so an unresolved reference fails assembly instead of reaching the model with literal braces.

The shared names are the point. A contribution registered in a nearer scope shadows an ancestor's, so an Agent preset that registers `deployment:persona-prefix` replaces the deployment persona exactly as it does on Cordis, and the deployment text still applies to every other Agent.

Configuration is validated at load: a non-empty string when present, and no other field.

## Alternatives considered

**Render the persona in `native-headless` beside `config.systemPrompt`.** Rejected. The application already concatenates the Registry's rendered sections after its configured prompt; a second channel would place the persona by a different rule than every other section and would not be shadowable by a preset.

**Give the Native side its own section names.** Rejected. A composition that swaps a persona by name would then need two names on either runtime, and a preset written for Cordis would silently stop replacing anything.

**Accept an arbitrary section roster from configuration.** Rejected. Sections are contributions with owners that dispose them; a static configuration list has no owner and no ordering relationship to first-party guidance.

## Consequences

A Native profile states its persona the way a Cordis profile does, with the same names, orders, and interpolation, so a recorded scenario's system prompt can be reproduced on either runtime. This removed one of the two blockers for moving the recorded session scenarios off the Cordis profile.

The persona is one section among the Registry's others, so it disappears with its Provider and is replaced by the same rule as every other section.

Verification: `tests/persona.spec.ts` covers prefix-before-suffix order, a scoped shadow by name, strict variable interpolation and its failure, an absent configuration, suffix ordering against a later section, configuration rejection, and disposal. Disabling the prefix registration fails four of the seven.
