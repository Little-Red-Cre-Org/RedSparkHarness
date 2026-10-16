# Agent Note: Desktop Updater Error Redaction

Status: implemented

English | [中文](2026-10-16-desktop-updater-error-redaction.zh.md)

## Problem

Updater errors can contain proxy URLs with credentials. Desktop sends update state to its shell window, so forwarding an error message can expose those credentials. Startup and backend errors also claim a local log path when the log write fails.

## Decision

An error `DesktopUpdateState` carries a fixed error type from `desktopErrorState`, an optional release version, and a log path only when the corresponding log write succeeds. It never carries an error message. `DesktopUpdateCoordinator` records the original updater error before publishing the state. When `afterFailedRestart` fails, the logged aggregate contains both the updater and recovery errors.

`logDesktopError` returns whether it wrote to `app.getPath('logs')/desktop.log`. Backend and startup state, normal and emergency error pages, and updater dialogs include the log path only after a successful write. Otherwise, the UI uses the generic local-log advice. Update dialogs localize the fixed error type. [Desktop startup error redaction](2026-10-16-desktop-startup-error-redaction.md) owns the structured startup diagnostics.

## Alternatives considered

**Remove credentials from updater messages and keep displaying the message.** Rejected because updater messages are not a controlled format and may expose secrets in other forms.

**Always show the expected log path.** Rejected because a failed write would make the UI claim that details were saved when they were not.

## Consequences

Renderer update state contains no updater or recovery message. Users see a localized error type and a log path only when the log was written; a write failure uses generic advice. When logging succeeds, `desktop.log` retains the raw updater and recovery errors for diagnosis.

## Verification

The update coordinator regression checks that proxy credentials and recovery details are absent from published state and present in the logger input. The startup regression simulates `EACCES` and checks the backend state, normal page, emergency page, and localized update dialog. Focused Desktop specs and oxlint pass. Temporary message-leak and unconditional-path mutations fail their corresponding regression assertions.
