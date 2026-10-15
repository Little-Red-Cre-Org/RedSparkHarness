# Agent Note: Native Settings pages follow the legacy settings layout

Status: implemented

English | [中文](2026-10-15-native-settings-legacy-alignment.zh.md)

## Problem

The native Settings window showed raw namespace JSON on General, wider custom cards on Models, and a plain roster on Agent presets. Users moving from the Cordis Web GUI met a different layout and could not change common preferences without editing JSON. `native-application` cannot import legacy Cordis plugins or their runtime, so it has to reproduce the layout from Host data alone.

## Decision

`native-application` renders the General, Models, Agent presets and Plugins pages with the legacy row and card structure inside the shared [SettingsPanel](../architecture/2026-10-11-shared-settings-panel.md). It imports no Cordis or legacy plugin runtime. Settings edits go through the Host's revision-fenced `settingsMutate`; the Web search key uses Host credential actions. The pages keep no local settings store.

**General.** The page shows rows for permission mode, language, appearance, font size, conversation display, busy-send behaviour (queue or steer) and desktop pet. Each row writes one field of its namespace: `permission`, `locale`, `ui-theme`, `ui-chat`, `ui-conversation.busyEnter` or `ui-pet`. Language, appearance and font size also apply to the open window at once. The busy-send row uses the legacy wording and writes only `ui-conversation.busyEnter`; a successful write notifies mounted composers, which map `queue`/`steer` to their `queued`/`steering` default. When the Host does not publish `ui-conversation`, the row is disabled and shows a notice instead of writing locally. Permission, conversation display and desktop pet rows appear only when the Host publishes their namespace. Namespace JSON editors and credential fields move into a collapsed Advanced section.

**Models.** In the Subscription models section, the authorization rows, account cards and authorization errors use the legacy compact card, identity line, quota track and secondary button styles. `account-card.module.css` keeps only account-specific rules. The API models section already used the shared provider editors from the [Models page decision](../architecture/2026-10-11-native-models-settings-page.md) and is unchanged.

**Agent presets.** The [preset roster](2026-10-11-native-web-agent-preset-roster.md) renders as legacy cards in built-in and custom groups. The card for the current default is highlighted. A preset that is broken or needs migration gets a red border and badge, plus the Host's `problem` text when the Host provides one. The mode-selection switch writes `agent-presets.modeSelectionEnabled`. Clicking a ready card writes `agent-presets.default`, which is allowed only while mode selection is enabled. When the Host has not published `agent-presets`, both controls are disabled and the cards say the Host has not opened this setting yet. A refresh keeps the last received settings on screen and replaces them only with an equal or newer revision, so a late write response cannot overwrite a newer value. While a settings event has announced a revision the page has not yet read, both controls stay disabled. Every preset keeps its View button, whatever its source or status. The preset viewer rebinds the themed scrollbar on its elevated surface.

**Plugins.** The page shows four fixed configuration cards for the `shell`, `agent-loop`, `subagent-model-selection` and `web-search-deepseek` namespaces. Each draft keeps the descriptor revision where editing began, and `settingsMutate` writes against that revision; a conflict leaves the draft and asks the user to discard and retry. Refreshes retain the last received descriptor and replace it only with an equal or newer revision. A newer announced revision disables saving until a describe reads it; a missing card shows a refresh-pending notice while a describe runs and says the Host has not registered the namespace only after a completed describe omits it. The Web search key is write-only: `credentialsDescribe` reports whether it is configured and writable, and `credentialsSet` stores a non-empty replacement outside the settings document. A key draft records the credential reference and descriptor revision current when typing began. If either has changed, or a newer announced revision is unread, saving reports a conflict, keeps the draft and writes no credential. The provider prefers a non-empty literal `apiKey` in the settings file over the stored credential. Settings redaction reports only whether that field is present, not whether it is empty, so the card says that a non-empty literal would override the named credential and that a saved credential would then not take effect. The Plugin list tab lazily reads the Host installation inventory on first display. Scopes and ids are opaque, so the scope of the first entry in dependency order is shown as global plugins and every other scope as nested scope plugins with a short scope id. Cards show the short package name and full package name, filter by name or id, and expand to show identity, scope, lifecycle state and failure step. Failed reads can be retried without clearing a received inventory. Subagent routes follow [user-authorized subagent model routes](2026-08-24-user-authorized-subagent-model-routes.md).

## Alternatives considered

**Import the legacy settings plugins.** Rejected because they depend on Cordis services and legacy slots that native-application must not load.

**Fall back to browser storage when a Host namespace is missing.** Rejected because it would split the authority for one preference between the browser and the Host, and the two values could disagree.

**Keep the JSON editors as the primary General view.** Rejected because common preferences would still require hand-edited JSON. The editors remain available under Advanced.

## Consequences

The native pages look like the legacy pages while the Host stays the only persistence owner. Controls whose namespace the Host does not register are hidden or disabled. Current gaps:

- The native Host does not yet register `permission`, `locale`, `ui-theme`, `ui-chat`, `ui-conversation` or `ui-pet`. Busy-send therefore stays disabled, and language, appearance and font size last only for the open window.
- The native Host does not yet register `agent-presets`, so the mode-selection switch and default selection stay disabled in native-web.
- The native-web Host registers `web-search-deepseek` but not `shell`, `agent-loop` or `subagent-model-selection`. Native inventory reports installation ids, names, scopes, lifecycle states and failure steps; it does not expose the legacy Agent-preset switcher or grouping, plugin toggles and configuration, or Fiber details. The tab shows a single note for the missing per-preset grouping and toggles.
- The native-web profile installs no authorization service, so `authorizationList` is empty and the Subscription models section shows only its heading.
- `NativeAgentPresetList` does not report `authorable` or `modeSelectionEnabled`, and the legacy create-mode draft button is not ported.

## Verification

`settings-page.spec.tsx` in native-application covers the General rows and Host-only busy-send writes, the placement of subscription account cards, and the preset grouping, default highlight, broken state, View on every preset, settings writes and revision ordering, including a late write response that arrives after a newer revision has been read. It also covers the Plugins cards: starting-revision writes, the conflict notice, pending refresh versus the Host gap, a namespace event during the initial describe, the write-only Web search key flow including completed saves and no-op settings writes, a key draft whose credential reference changed from A to B, clearing and retyping after that change, and the literal `apiKey` notice. `plugin-inventory-tab.spec.tsx` covers first-display loading, scope grouping and lifecycle tags, case-insensitive name/id search, and retry after a failed inventory read.
