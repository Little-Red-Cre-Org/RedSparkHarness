# Agent Note: Native sidebar session-list interactions

Status: implemented

English | [中文](2026-10-16-native-sidebar-session-list-interactions.zh.md)

## Problem

The native-web sidebar diverged from the legacy Cordis sidebar in ways that lost user context or gave no feedback. Clicking a Workspace folder row to collapse it also connected the Workspace and selected a blank Session. Clicking another Session while a reply was generating did nothing. The session menu had no Delete entry, the rename field neither took focus nor closed on Escape, manual ordering offered only arrow buttons, and archiving the open Session left the main area on a hidden Session with an unavailable title.

## Decision

`NativeSessionBrowser` in `rsh/Programs/Web/client/ui-sidebar/src/native-ui.tsx` keeps these rules:

- A Workspace row click, Enter or Space only toggles collapse. Starting a Session in a Workspace stays on the row's `+` action.
- Opening a Session while the controller is `sending` or `cancelling` shows a `role="status"` notice (`session.switchPending`) and does not switch; the notice disappears once the controller is ready. A click during the transient `loading` state is remembered and opened when the controller becomes ready. Search results follow the same rules.
- The session menu shows Delete session next to Archive session, as in Cordis. The Host has no hard delete, so Delete confirms with the existing `delete.sessionNote` dialog and then archives.
- Rename inputs (Session and Workspace) take focus with the text selected; Escape cancels.
- After archiving or deleting the selected Session, the sidebar selects the next visible row in rendered order, else the previous one. When no row remains, it calls the new `NativeConversationService.deselect()`, which clears the selection so the application shows its empty state.
- In manual order, Sessions inside a Workspace and Workspace rows can be dragged to reorder through the existing Host `reorderSession` / `reorder` calls. The arrow buttons stay in the DOM as the keyboard fallback and appear only on row hover or focus.

## Alternatives considered

**Switch Sessions while a turn runs.** Rejected for this change: the controller binds the running turn and its `sending` state to the current selection, so switching needs the turn-lifecycle work that moves turn ownership to the Host. The notice makes the limitation visible until then.

**Undo toast and an archived-Session list after archiving.** Deferred: the Host exposes no unarchive operation.

## Consequences

Users no longer lose the open conversation through a folder click or an archive, and blocked switches explain themselves. Delete and Archive both hide the Session, matching Cordis wording but not offering true deletion. Drag reordering exists only in manual order and grouped view.

## Testing

`native-application/tests/native-shell.client.spec.tsx` covers folder-row toggling without `connectWorkspace`, the blocked-switch notice, rename focus and Escape, Delete confirmation followed by selection of a neighbouring Session, and a session drag reorder. `native-controller-follow.spec.ts` covers `deselect()`.
