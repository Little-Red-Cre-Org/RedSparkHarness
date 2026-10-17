# Agent Note: Native composer errors, drafts, paste and keyboard focus

Status: implemented

English | [中文](2026-10-16-native-composer-errors-keyboard.zh.md)

## Problem

The 2026-10-16 native-web usability audit found that the Native page shows raw exception text without telling the user to configure a model (N12), drops unsent drafts and images on Session switch (N23), cannot paste images or send images without text (N24), lets Tab leave the Settings dialog (N29), and exposes a `role="tree"` sidebar with no arrow-key behaviour (N30). Esc does not stop a running turn (N11).

## Decision

- **N11.** Esc in the composer textarea calls `cancel()` while a turn is sending, except during IME composition or an in-flight cancel. A turn the user cancels (Esc or Stop) settles back to ready without publishing an error.
- **N12.** `ConversationError` (`native-application/src/conversation-error.tsx`) shows localized copy for a raw conversation error, a "Open model settings" action for credential failures, and the raw text in a disclosure that starts collapsed. The alert is a card at the end of the transcript, where the failed reply would appear. The authentication copy matches Cordis (`message.failure.auth`). The Host now forwards the `LlmError` code (see [the passthrough note](../bug-fix/2026-10-17-native-web-llm-error-code-passthrough.md)), but the conversation snapshot keeps only failure text, so the component still recognizes missing, blank and unusable keys and rejected credentials from the adapters' message wording, and treats a 401/403 status as an authentication failure only inside a `native-model-execution` model error, so Host and Connection HTTP failures stay generic. `requestNativeModelSettings` dispatches a window event that `NativeSidebarSettings` turns into opening Settings at Models, following the busy-send preference event pattern.
- **N23.** The controller keeps one unsent draft (text and image files) per Session through `keepDraft` and `takeDraft`; it is presentation state and never reaches the Host. The composer saves the outgoing Session's draft and restores the incoming one when the selected Session changes. A send the Host never accepted (`session/start` did not return, for example after a Session switch during image reading or start) reports failure; its text and images return to the composer when it is still empty on that Session, or to the originating Session's saved draft after a switch; archiving or removing a Session drops its draft.
- **N24.** `NativeComposerAttachments` adds clipboard files pasted into its composer form through the same limit filter as picking and dropping. `send` accepts empty text with images and uses `promptContent` with image parts; queue and steer stay text-only. The thumbnail rail sits on its own row above the textarea, so thumbnails do not push the model controls onto a second line; the '+' picker (`NativeComposerImagePicker`, which opens the rail's file input) stays in the toolbar with the model controls.
- **N29.** `SettingsPanel` wraps Tab and Shift+Tab at the edges of the topmost modal dialog (Settings itself or a confirmation opened over it), pulls outside focus back in, and restores focus to its opener on close.
- **N30.** The Native sidebar tree has one roving tab stop. Tab reaches the tree once, which forwards focus to the selected row or the first row; Arrow Up/Down, Home and End move between rows; Arrow Right expands and Arrow Left collapses a workspace row; Enter and Space keep the rows' existing activation.

## Alternatives considered

- **Classify errors in the controller snapshot.** The controller would carry a second error field derived from the same string; classifying at render keeps one error value.
- **Switch the component to error codes.** The conversation snapshot keeps only failure text, so this remains the follow-up to message matching.
- **Global Escape listener for N11.** Escape already closes dialogs, menus and the image lightbox; a page-wide listener would stop the turn while closing those.

## Consequences

- Credential failures from adapters whose messages do not use the recognized wording still show the generic failure copy with details.
- Drafts survive Session switches for the page lifetime only; reload discards them.
- `SettingsPanel` focus containment also applies to the Cordis Settings root that shares the primitive.
