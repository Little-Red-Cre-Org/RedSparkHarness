# Agent Note: Native Plugins settings cards

Status: implemented

English | [中文](2026-10-16-native-plugins-settings-cards.zh.md)

## Problem

Native Settings needs a Host-backed way to configure the built-in plugin namespaces without reading local configuration files or importing the Cordis plugin UI.

## Decision

The Plugins configuration tab presents four cards: Shell (`shell`), Agent loop (`agent-loop`), Subagent (`subagent-model-selection`), and DeepSeek Web Search (`web-search-deepseek`) in the [Plugins section](../../../../rsh/Programs/Web/client/native-application/src/plugins-section.tsx).

Each settings draft keeps the descriptor revision where editing began and submits that revision through [`NativeSessionClient.settingsMutate`](../../../../rsh/Programs/Web/client/native-session/src/native.ts). A Host conflict leaves the draft available and displays a conflict notice.

Refreshes retain the last received settings descriptors and revisions, credential metadata, and model catalog while loading or failure state changes separately. Older reads and lower descriptor revisions do not replace newer data.

The Web Search API key value is write-only in the Client. The card reads configured and writable metadata with `credentialsDescribe` and sends entered values through `credentialsSet`; both actions belong to the [Native Session client](../../../../rsh/Programs/Web/client/native-session/src/native.ts).

A missing Host namespace displays a localized message that the current Host has not opened the plugin's settings; the Client has no local-file fallback. The message belongs to [native application locales](../../../../rsh/Programs/Web/client/native-application/src/locales.ts).

The Plugin list tab remains a localized coming-soon panel. Inventory management is deferred to a follow-up.

The Subagent card follows the Host-owned route allowlist recorded in the [user-authorized subagent model decision](2026-08-24-user-authorized-subagent-model-routes.md).

## Alternatives considered

**Reuse the legacy plugin settings page.** Rejected because its page and data integration depend on Cordis slots; Native Settings uses the selected Host actions, following the same separation as the [Native Models page](../architecture/2026-10-11-native-models-settings-page.md).

**Read plugin settings from local files when a Host omits a namespace.** Rejected because the selected Host's Settings actions own the values presented by this page; a local fallback would show a different source of truth.

**Apply drafts without a revision check.** Rejected because another writer can change a namespace while the user edits it; `settingsMutate` reports that conflict instead of accepting a draft based on an older descriptor.

**Build plugin inventory management in the same change.** Deferred because this page currently owns settings and credential actions; the inventory tab remains a follow-up.

## Consequences

The Native page edits the four built-in settings namespaces through Host actions, keeps pending drafts fenced to their starting revision, and reports a stale draft without replacing it with an inferred local value. The focused [settings page tests](../../../../rsh/Programs/Web/client/native-application/tests/settings-page.spec.tsx) cover the card flow, retained settings revision, and credential metadata after a refresh omits its namespace.
