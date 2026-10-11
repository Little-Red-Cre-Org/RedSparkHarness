# Agent Note: Native sidebar session projection

Status: implemented

English | [中文](2026-10-11-native-sidebar-session-projection.zh.md)

## Problem

The native Session client exposes stored headers and title actions, but it has no Workspace registry, activity ordering, or cross-Session status feed. The native sidebar still needs useful navigation without claiming that path groups are Host Workspaces.

## Decision

The native sidebar groups listed Sessions by `SessionHeader.cwd` as a client-only display projection. A group has no `WorkspaceId`; its label comes from `workspaceLabel(cwd)`, and the ungrouped group uses the localized label. Group and Session rows sort by the newest available `header.createdAt`. The sidebar uses `NativeSessionPresentation.displayTitle` and the existing rename and refresh-title actions.

The projection does not display relative activity time or Session status because the native list does not provide `updatedAt`, pending interaction, running, or completion facts. Workspace creation, search, sort controls, and scheduled tasks stay disabled until their Host services exist. Workspace-only actions are omitted from path groups.

## Alternatives considered

- **Treat each cwd as a Workspace identity:** rejected because Workspace membership and order are Host-owned facts; a path does not supply a Workspace id or its ordered Session membership.
- **Derive activity or status from creation time, selected history, or placeholder values:** rejected because these values would misstate the Session's current state.
- **Wait for every Workspace and schedule API before rendering the sidebar:** rejected because the current Host already supports listing, selecting, creating, and renaming Sessions.

## Consequences

The native sidebar provides grouped Session navigation and title management now, while registered Workspace behavior remains unavailable. When native Workspace and Session summary feeds arrive, replace the cwd projection with their authoritative membership, manual order, activity timestamps, and status values; do not turn cwd into a persistent Workspace identity.
