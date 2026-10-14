# Agent Note: Native Desktop module page

Status: implemented

English | [中文](2026-10-14-native-desktop-module-page.zh.md)

## Problem

The Desktop plugin renderer needs package and Host or Client installation controls for Native profiles while preserving the compatibility-plugin workflow.

## Decision

When the plugin window receives `dshDesktop.plugins.native`, the [renderer](../../../../rsh/Programs/Desktop/renderer/plugin-manager.js) uses it to manage package versions and Host or Client installations. Package actions stay separate from per-installation controls, and Host scopes come from inventory. New installation configuration is entered as JSON; blank input omits `config`, while explicit JSON `null` remains a value.

Only a Native `list` result with `wrong-profile` selects compatibility-plugin actions. Other Native failures stay in Native mode. Mutations carry the displayed inventory revision, and the renderer does not optimistically change rows. It refreshes inventory after `applied`, `recovery-required`, or `stale-revision`; a stale action needs another user submission. If a fresh inventory cannot be read, Native writes remain unavailable.

The Native view uses the existing backend status and profile-recovery subscription. A newer subscription update supersedes an earlier status read; closing the page releases the subscription and ignores late replies. The Native view has no retry control.

The renderer cannot observe browser activation or Client mount. It presents the backend operation result; `applied` and the remaining GUI acceptance requirement are owned by the [Native Desktop module-management decision](../architecture/2026-10-14-native-desktop-module-management.md).

## Alternatives considered

**Optimistic inventory updates.** The backend can refuse stale requests or report partial package changes during recovery, so guessed rows could misstate persisted state.

**Fallback to compatibility actions on every Native error.** This could route a Native failure into the legacy write path; only `wrong-profile` identifies a compatibility profile.

**Dedicated operation-progress and Client-health IPC.** The renderer uses existing backend status and final operation results. It cannot report browser activation or mount without a Client-health channel.

## Consequences

The renderer tests cover package actions, installation intent, absent versus null configuration, revision refresh, failure routing, status ordering, and page teardown. They verify renderer behavior; packaged Electron GUI acceptance must still confirm Client activation and mount.
