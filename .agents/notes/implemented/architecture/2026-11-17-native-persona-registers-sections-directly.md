# Agent Note: Native persona registers prompt sections directly

Status: implemented

English | [中文](2026-11-17-native-persona-registers-sections-directly.zh.md)

## Problem

`native-web`, `native-tui`, and Desktop install `@redspark/rsh-native-persona` on every standing preset. Its Native entry ran the shipped Cordis persona plugin through `@redspark/rsh-cordis-bridge`, which dynamically imports `@redspark/cordis`. A Native profile therefore still required the Cordis runtime even though its own plugin graph is Cordis-free. Deleting the vendor tree would fail at persona activation.

## Decision

`@redspark/rsh-persona/native` owns persona section registration: both sections, complete-prompt policy, and runtime-context suppression. Section names come from `@redspark/rsh-system-prompt/sections`; each prompt registry supplies its own orders, so the Cordis registry keeps its named placements and the Native registry uses `PERSONA_PREFIX_ORDER` and `PERSONA_SUFFIX_ORDER` from `@redspark/rsh-native-prompt`. The Cordis `apply` and the Native installer both call that owner and differ only in the adapter and disposer binding (`ctx.effect` versus `NativeContext.effect`).

`@redspark/rsh-native-persona` requires only the preset scope's `promptSections` capability. It presents that registry through `PersonaPromptSections` and imports no Cordis package. The package drops `@redspark/rsh-cordis-bridge` and its Cordis peer dependency.

`cordisHostingNativeReferences` now lists only `rsh/Core/runtime-diagnostics/cordis-bridge`; `native-persona` is no longer an admitted Cordis host.

## Alternatives considered

**Keep the bridge and delete Cordis later.** Rejected. The bridge makes every shipped Web and TUI persona row a runtime Cordis consumer, so the first deletion step would break Native startup before any legacy package was removed.

**Duplicate the persona registration logic in the Native installer.** Rejected. Section names, ordering, and complete-prompt behavior would drift between the two rows. The shared owner keeps one authority.

## Consequences

A Native profile can activate its persona row with no Cordis package installed. The Cordis `dsh-persona` plugin keeps the same configuration, section names, ordering, and suppression behavior. `@redspark/rsh-cordis-bridge` remains for Native entries that explicitly host a Cordis plugin, but no shipped Native profile does so.
