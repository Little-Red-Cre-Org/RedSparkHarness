# Agent Note: Native Models settings uses shared provider editors

Status: implemented

English | [中文](2026-10-11-native-models-settings-page.zh.md)

## Problem

The Cordis Models page and the native Settings window both need the same API provider forms, while native-application cannot import the Cordis feature package or copy its CSS without creating a second presentation owner.

## Decision

`ui-primitives` owns the props-only provider cards, model editors, footer and stylesheet. The legacy Models plugin and native application supply their own settings operations, schema operations and localized copy to those components.

The native Models page joins `modelsListProviders`, `modelsListConfigurableProviders`, redacted Settings descriptors and credential descriptions. It writes provider edits through revision-fenced `settingsMutate`, stores API keys through credential actions, sends discovery through `modelsDiscover`, and reloads on Settings, credential-reference and adapter events. The Subscription models section renders one authorization row per Host entry and places each matching account card inside its row; account summaries without a matching flow remain in that section. Returning to Models reloads authorization entries so an in-flight login can resume. The shared [SettingsPanel](2026-10-11-shared-settings-panel.md) continues to own the window chrome.

## Alternatives considered

**Business-frame idle timeout alone.** Rejected for authorization subscriptions because a healthy flow can wait for user input without producing business frames. The Host sends transport-only SSE comment heartbeats; the Client times out silent transport, including response-header waits. Subscription loss refreshes Host state and permits one automatic resubscription per attempt before requiring manual refresh. It does not cancel the Host attempt. Terminal frames end observation, and superseded subscriptions cannot apply late frames.

**Import the legacy Models feature package.** Rejected because its data layer and page integration depend on Cordis and legacy slots, which native-application cannot import.

**Copy the editor components and stylesheet into native-application.** Rejected because the two pages would have separate owners for the same provider presentation.

**Use only the generic native JSON settings editor.** Rejected because it does not provide the curated model-list editor or endpoint discovery controls.

## Consequences

Both pages render one provider-editor implementation while keeping their data ownership independent. The native application must adapt Host actions and published schemas to the editor callbacks, and each page supplies its own complete localized copy. Endpoint discovery receives an entered API key for that request; the discovery action does not store it.
