# Agent Note: Native Session details use observed facts

Status: implemented

English | [中文](2026-10-12-native-session-details.zh.md)

## Problem

The Native right panel showed only the selected Session id and working directory, while its legacy Cordis counterpart owns a tab dock with file browsing and document previews. Native Session history and roster APIs expose conversation facts, but they do not enumerate or read workspace files; the Native panel must not imply access it does not have.

## Decision

The Native entry in `ui-sidebar-right` presents Overview and Activity sections from existing Client values. Overview reads the selected Session header and roster row. Activity reads `NativeSessionClient.history()` while the panel is shown and counts durable turns, user and assistant messages, tool calls, and recorded token usage; it also displays the most recent request route and context window from history events. The request log is the source for executed model facts; the advisory model catalog does not replace it.

The panel shares `SidebarPathBar` with the legacy file tree and document preview. It omits file listings and document content because the Native composition has no Session-scoped workspace-file client; trajectory inspection is outside the panel. The Cordis dock and resource ownership remain defined by [Right Sidebar docking infrastructure](2026-09-04-right-sidebar-docking-infrastructure.md); Native left-sidebar projection remains defined by [Native sidebar Session projection](2026-10-11-native-sidebar-session-projection.md).

## Alternatives considered

- **Add workspace-file methods in this change:** rejected because the panel can show truthful Session and history facts using existing APIs, while Host file access needs its own authorization and data contract.
- **Import the Cordis dock and its file tabs into Native:** rejected because those views depend on Cordis services and resource providers that Native does not install.
- **Use the model catalog as the current Session route:** rejected because it advertises available choices; durable `request/header` events record the route used by the Session.

## Consequences

Native Session details include header metadata and an activity summary without changing Host protocols. Counts and token totals cover only the bounded history returned by the Host, and usage includes only assistant events that record it. File browsing and previews remain absent until a Native provider exposes Session-scoped file facts.
