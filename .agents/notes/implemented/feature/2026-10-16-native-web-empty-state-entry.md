# Agent Note: Native Web empty-state entry points

Status: implemented

English | [中文](2026-10-16-native-web-empty-state-entry.zh.md)

## Problem

The Native conversation hero had no usable Workspace chooser, and starting a session from the sidebar could leave an unrelated blank Session behind. Its empty state also hid the context users need to start a task, while model selection and the header lacked useful distinctions.

## Decision

The empty-state hero opens the Host Workspace roster, offers directory picking when adding a Workspace or when none are registered, and asks for explicit confirmation when Host reports an untrusted path. Workspace connections select the blank Session returned by `connectWorkspace`; the sidebar's New Session action targets the selected Session's Workspace, or the most recently active registered Workspace, and clears the conversation when no target exists. `connectWorkspace` reuses an existing blank Session, so these entry points do not create additional orphan blanks.

The empty state shows an Agent preset picker whenever usable presets exist. The user can stage a choice; the next composer Workspace start captures it and applies it only to the Session that operation returns, once that Session is still selected and exposes the preset unlocked. Failure or a superseding navigation drops it. The conversation header shows the selected Session's mode and a Plan pill when active; session actions render only with a selected Session. The composer prompts for a Workspace while empty. ModelPicker opens directly to models when there are no effort choices, identifies providers for duplicate model names, and scrolls the selected model into view.

This extends the shared Native Session ownership and navigation policy in [Native Web shell modules](../architecture/2026-10-08-native-web-shell-and-title-ownership.md) and [Client Session and conversation ownership](../architecture/2026-08-20-client-session-conversation-ownership.md).

## Alternatives considered

- **Create a new Session for each New Session action:** rejected because `connectWorkspace` already supplies the Workspace's blank Session and creating another leaves an orphan.
- **Keep Workspace switching in the sidebar only:** rejected because the first task starts from the conversation hero, where an empty conversation must establish its Workspace.
- **Apply a staged preset before a Session exposes mode controls:** rejected because selection is Host-owned and can only be applied through an unlocked Session's available options.

## Consequences

The no-Session hero owns Workspace and preset entry; the sidebar resolves its target through the shared Workspace client and Session controller. Existing orphan blank Sessions are not migrated or removed. Workspace trust remains an explicit user decision, and staged presets apply only when the created or connected Session supports them. Sidebar New Session disables sending until its connection and selection finish, shows other connection failures in the conversation error, and returns to the empty state when Host reports the target Workspace as untrusted; the composer chooser then asks for trust, while the sidebar keeps its trust dialog for its own Workspace actions. Workspace navigations reserve a controller navigation token with `beginNavigation`/`isCurrentNavigation`, so a newer select, clear, or navigation supersedes a slower pending connection, like Cordis `beginNavigation`.
