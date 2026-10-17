# Agent Note: Native Web DSH Session UI parity

Status: implemented

English | [中文](2026-10-17-native-web-dsh-session-ui.zh.md)

## Problem

The Native Web Session page differed from the original DSH GUI in its header navigation, mode and child-Session controls, composer attachments and permission choices, usage summary, and narrow-window sidebar behavior.

## Decision

Show Conversation and Trajectory tabs below the selected Session title, with the Trajectory ledger inline and the composer visible on both tabs. Put the selectable mode chip and direct child-Session menu beside the title. Keep the Plan toggle in the composer, use a compact localized permission menu, and replace the text image picker with a round "+" button (`NativeComposerImagePicker`) in the toolbar. That button opens the file input rendered by `NativeComposerAttachments` through a shared `inputRef`; `NativeComposerAttachments` stays above the editor and owns the attachment rail, drop target, and clipboard-image paste on the composer form. Derive a muted usage line from loaded Session events and show values only when their inputs are available. On narrow frames, let an expanded sidebar overlay the main column and close it from a backdrop or `collapseNarrow()`.

The current model catalog does not publish context-window sizes, so the usage line omits context percentage. This change does not add file or `@` reference actions, which have no backend support.

## Alternatives considered

- **Keep Trajectory as a full-screen dialog:** rejected because it separates the ledger from the conversation's main content and hides the shared composer.
- **Keep mode selection in the composer:** rejected because the title area should identify and control the selected Session's mode.
- **Keep an expanded sidebar in the narrow grid:** rejected because it leaves too little space for the main column at 400px.

## Consequences

Session navigation remains controller-owned, while the title menu selects a listed direct child Session through the existing controller. The status line summarizes only the loaded event window. A narrow sidebar keeps the main grid at rail width while its drawer is open, and selecting a Session collapses that drawer.
