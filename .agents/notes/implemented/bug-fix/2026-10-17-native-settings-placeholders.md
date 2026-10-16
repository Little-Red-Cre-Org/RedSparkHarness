# Agent Note: Native Settings placeholders

Status: implemented

English | [中文](2026-10-17-native-settings-placeholders.zh.md)

## Problem

The 2026-10-16 UX audit (N25–N28) found several native-web Settings pages that showed placeholders or walls of disabled controls instead of telling the user what they can do. Task Center showed only "Coming soon" and duplicated the sidebar Scheduled tasks entry, whose empty state did not say how to create a task. Agent presets showed a disabled mode switch with an orange warning, dimmed cards, and red "Needs migration" cards when the Host does not register the `agent-presets` namespace. General showed "Could not read the busy-send preference" next to a disabled select, and its Advanced settings exposed raw JSON overrides. Plugins showed expand chevrons on cards that only said the Host had not opened the setting, and listed about 70 Host runtime plugins as "Enabled" with no toggles.

## Decision

- **N25:** `native-sidebar-settings.tsx` no longer lists the Task Center row; the native Host has no task-center API, so the page cannot show real data. The sidebar Scheduled tasks empty state (`ui-sidebar` `NativeScheduledTasksPanel`) adds a hint to ask the Agent in a conversation, with an example. The native Agent has the `schedule_create` tool, so the hint describes a working path.
- **N26:** When `agent-presets` is absent, `AgentPresetsSection` replaces the switch block with one neutral note: new Sessions use the preset marked default, and presets can still be viewed and copied. Ready cards are no longer dimmed in that state. Presets with `needs-migration` or `invalid` status move into a collapsed "Unavailable presets (N)" `<details>` group with a short explanation, neutral or warning badges, and no red border.
- **N27:** When a successful Settings read has no `ui-conversation`, the busy-send row shows the effective value as text instead of a disabled select, and the note says the Host does not save this preference; while loading or after a failed read it keeps the disabled select and the read-failure note. Advanced settings is renamed Developer options and its collapsed summary explains that it holds raw JSON overrides, schemas and credential references.
- **N28:** A plugin card whose namespace is confirmed absent (loaded, not refreshing, last read succeeded) renders as a static card with an inline "Not configurable on this Host yet." note and no chevron. The Plugin list folds `native-*` and `storage-*` entries (by short package name) behind a Show/Hide link with their count; a search shows all matches. The read-only note now says the Host cannot turn plugins on or off yet.

## Alternatives considered

**Keep Task Center and route it to the Scheduled tasks panel.** Rejected: the panel is owned by the sidebar plugin, and wiring a Settings row to it adds cross-plugin plumbing for a duplicate entry.

**Put Developer options behind a switch that unmounts the content.** Rejected: a collapsed `<details>` already hides it by default; renaming and explaining it meets the audit without changing how the editor, credentials and refresh stay mounted.

**Hide unavailable plugin cards entirely.** Rejected: on a Host with none of the four namespaces the page would be empty; a static card still names the plugin.

**Plugin toggles.** Not done: the Host exposes no API to enable or disable an installed plugin; the list stays read-only.

## Consequences

Settings shows four sections. Pages no longer use error colors for Host capability gaps. The infrastructure filter is a name heuristic; plugins outside those prefixes stay visible. Developer options does not persist an open state.

## Testing

`native-application/tests/settings-page.spec.tsx` covers the absent `agent-presets` note without a switch, the unavailable presets group, the read-only busy-send fallback, and static Host-gap plugin cards. `plugin-inventory-tab.spec.tsx` covers folding, search and Show for infrastructure plugins. `native-shell.client.spec.tsx` checks the four-item Settings navigation, and `ui-sidebar/tests/native-scheduled-tasks.client.spec.tsx` checks the empty-state hint.
