# Agent Note: Native client settings slots and open-in-app

Status: implemented

English | [中文](2026-11-05-native-client-settings-slots-and-open-in-app.zh.md)

## Problem

Two Native client surfaces were installed without being reachable. The Native settings page rendered its own inline sections and called no slot renderer, so `settings.plugins.tab` and `settings.section` had declarers and injectors but no page. `@redspark/rsh-client-ui-open-in-app` had only a Cordis half whose button lands in `conversation.session.header.utilities`, a seat a Native client does not declare.

## Decision

The Native settings host declares `settings.plugins.tab` and `settings.section` as children of the `sidebar.settings` registration and renders them: the Plugins page renders every declared tab, and the Models page renders `settings.section` filtered to `models`. `ui-settings-models` injects its existing `ModelsSection` into that slot instead of the application carrying a second models editor, and declares `settings.models.provider-card` and `settings.models.footer` as that entry's children. `ui-settings-plugin-inventory` keeps injecting `settings.plugins.tab`.

`ui-open-in-app` gains a Native entry that reuses the browser half's controller, label table, icon component, and busy delay. Both halves call the same host routes through the page Fetch carrier, so only placement and the directory source differ: the entry contributes the split button into `native.conversation.actions` at order -10 and reads the workspace directory from the selected Session header's `cwd`, because a Native client has no Session summary projection.

## Alternatives considered

### Why not let the Models page keep its own inline editor?

The inline editor duplicated what `ui-settings-models` already ships, and the package's slot registration stayed dead. Rendering the contribution keeps one implementation and makes the slot gate meaningful.

### Why not put the open-in-app button in the Cordis header seat on the Native build?

That seat exists only in the browser composition. A Native client's action row is `native.conversation.actions`, and injecting there is what makes the button appear at all.

## Consequences

A Native settings page now shows whatever a client package registers into the two settings slots, so a new settings contribution needs no application edit. The Models page shows one editor again. The open-in-app button is available in Native clients and keeps sharing the browser half's availability read and persisted choice through the same host routes.
