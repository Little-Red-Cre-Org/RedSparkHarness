# Agent Note: Native sidebar session projection

Status: implemented

English | [中文](2026-10-11-native-sidebar-session-projection.zh.md)

## Problem

The native Session and Workspace clients expose a Host Workspace registry, ordered Session membership, activity timestamps, Session status, and directory browsing. The native sidebar uses those feeds while keeping host operations behind its injected UI owner.

## Decision

The native sidebar groups Sessions by the Host registry's `workspaceId` and uses each Workspace's ordered Session membership. It also supports a flat Session view, recent-activity or manual ordering, Session search and archive, Workspace rename and deletion, and directory-based Workspace creation. Shared Cordis-free rows provide the same status, activity time, hover path, and row menus used by the legacy sidebar.

Workspace expansion only changes the visible group. Its new-session action opens or creates the reusable blank Session through `connectWorkspace`. Scheduled tasks remain disabled because the native Schedule capability is unavailable; drag reordering, moving Sessions, and multi-page search are not presented.

## Alternatives considered

- **Treat each cwd as a Workspace identity:** rejected because the Host registry supplies Workspace ids, membership, and order.
- **Duplicate the legacy row and directory-browser UI in the Native composition:** rejected because shared Cordis-free presentation keeps both sidebars aligned while Host operations remain in their owners.
- **Wait for the Native Schedule capability before rendering Workspace navigation:** rejected because the available Host Workspace and Session feeds already support the sidebar's core navigation.

## Consequences

The native sidebar's Workspace and Session rows use Host registry and Session-summary data. The native task center, drag gestures, Session moves, and additional search pages remain unavailable in this composition.
