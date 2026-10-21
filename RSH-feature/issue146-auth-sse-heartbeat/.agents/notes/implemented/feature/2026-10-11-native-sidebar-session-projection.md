# Agent Note: Native sidebar session projection

Status: implemented

English | [中文](2026-10-11-native-sidebar-session-projection.zh.md)

## Problem

The native Session and Workspace clients expose a Host Workspace registry, ordered Session membership, activity timestamps, Session status, and directory browsing. The native sidebar uses those feeds while keeping host operations behind its injected UI owner.

## Decision

The native sidebar groups Sessions by the Host registry's `workspaceId` and uses each Workspace's ordered Session membership. It also supports a flat Session view, recent-activity or manual ordering, Session search and archive, Workspace rename and deletion, and directory-based Workspace creation. Shared Cordis-free rows provide the same status, activity time, hover path, and row menus used by the legacy sidebar.

Workspace expansion only changes the visible group. Its new-session action opens or creates the reusable blank Session through `connectWorkspace`. The sidebar also opens the read-only scheduled-task panel described in the [Native scheduled-task list note](2026-10-12-native-scheduled-task-list.md); drag reordering, moving Sessions, and multi-page search are not presented.

Manual ordering in Workspace groups exposes up/down controls backed by the existing Workspace reorder and Session reorder commands. The Host follow feed supplies the resulting order; the sidebar holds only one pending-write flag, disables ordering controls until settlement, and displays failures without optimistically reordering rows. Hidden archived or blank members retain their registry positions; moves use the next visible anchor, and moving to the visible end appends in the Host membership. Ungrouped and flat rows have no ordering controls.

## Alternatives considered

- **Treat each cwd as a Workspace identity:** rejected because the Host registry supplies Workspace ids, membership, and order.
- **Duplicate the legacy row and directory-browser UI in the Native composition:** rejected because shared Cordis-free presentation keeps both sidebars aligned while Host operations remain in their owners.
- **Wait for the Schedule feed before rendering Workspace navigation:** rejected because Workspace and Session feeds support the sidebar's core navigation independently.

## Consequences

The native sidebar's Workspace and Session rows use Host registry and Session-summary data. The task list remains read-only; drag gestures, Session moves, and additional search pages are not presented in this composition.
