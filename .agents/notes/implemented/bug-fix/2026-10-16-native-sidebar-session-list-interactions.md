# Agent Note: Native sidebar session-list interactions

Status: implemented

English | [中文](2026-10-16-native-sidebar-session-list-interactions.zh.md)

## Problem

The native-web sidebar diverged from the legacy Cordis sidebar in ways that lost user context or gave no feedback. Clicking a Workspace folder row to collapse it also connected the Workspace and selected a blank Session. Clicking another Session while a reply was generating was silently ignored. The session menu had no Delete entry, the rename field neither took focus nor closed on Escape, manual ordering offered only arrow buttons, and archiving the open Session left the main area on a hidden Session with an unavailable title.

## Decision

`NativeSessionBrowser` in `rsh/Programs/Web/client/ui-sidebar/src/native-ui.tsx` keeps these rules:

- A Workspace row click, Enter or Space only toggles collapse. Starting a Session in a Workspace stays on the row's `+` action.
- Opening another Session while a reply is generating switches immediately. `NativeConversationController.select()` aborts the current turn's detach signal, which stops following and awaiting without cancelling the Host turn, stays `loading` while the in-flight operation settles, and then selects. Returning to the running Session re-attaches through the existing `session/attach` restore path. Only Stop cancels a turn. A click during the transient `loading` state is remembered and opened as soon as loading ends, even if the opened Session is attached to a running turn. Search results follow the same rules.
- The session menu shows Delete session next to Archive session, as in Cordis. The Host has no hard delete, so Delete confirms with the existing `delete.sessionNote` dialog and then archives.
- Rename inputs (Session and Workspace) take focus with the text selected; Escape cancels.
- After archiving or deleting the selected Session, the sidebar selects the next visible row in rendered order, else the previous one. When no row remains, it calls the new `NativeConversationService.deselect()`, which clears the selection so the application shows its empty state.
- In manual order, Sessions inside a Workspace and Workspace rows can be dragged to reorder through the existing Host `reorderSession` / `reorder` calls. The arrow buttons stay in the DOM as the keyboard fallback and appear only on row hover or focus.

## Alternatives considered

**Block switching while a turn runs and show a notice.** Rejected: since turns are Host-owned and re-attachable, blocking would only keep the old limitation; the Cordis client switches freely.

**Undo toast and an archived-Session list after archiving.** Deferred: the Host exposes no unarchive operation.

## Consequences

Users no longer lose the open conversation through a folder click or an archive, and can switch Sessions while a reply keeps generating in the background. Delete and Archive both hide the Session, matching Cordis wording but not offering true deletion. Drag reordering exists only in manual order and grouped view.

## Testing

`native-application/tests/native-shell.client.spec.tsx` covers folder-row toggling without `connectWorkspace`, switching away from a running turn without cancelling it and re-attaching on return, rename focus and Escape, Delete confirmation followed by selection of a neighbouring Session, and a session drag reorder. `native-controller-follow.spec.ts` covers `deselect()`.
