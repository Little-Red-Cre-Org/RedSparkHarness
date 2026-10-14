# Agent Note: Native Desktop module page

Status: proposed

English | [中文](2026-10-14-native-desktop-module-page.zh.md)

## Problem

The Desktop plugin renderer operates on legacy package rows. Native profiles need distinct package operations and Host/Client installation controls without another package writer or dependency planner.

## Proposal

Prepare the existing [renderer](../../../../rsh/Programs/Desktop/renderer/plugin-manager.js) against the independently reviewed Native facade. Keep its six operations under `dshDesktop.plugins.native`; do not copy the external interface into a second public protocol. The backend remains authoritative for scopes, revision, package ownership, row capabilities and retention reasons. Client config input distinguishes blank from JSON null without storing credentials.

Only a Native list wrong-profile refusal permits legacy operations. Applied mutations re-read inventory; stale refusal refreshes and requires another user submission. Busy, recovery and ambiguous IPC failures never resubmit mutations. Existing backend status and subscription supply starting/ready/error plus independent profileRecovery. Page teardown detaches the subscription, and late queries cannot replace newer subscribed status. Native retry startup remains hidden until the backend supplies its applicable conditions.

## Alternatives considered

**Optimistic inventory updates.** The manager may refuse a stale request or leave partial package changes during recovery. Renderer guesses would misrepresent persisted state.

**Legacy fallback on all Native errors.** This would route Native failures into the old write path. Only wrong-profile identifies the legacy profile.

**Operation progress and Client health IPC.** The agreed scope uses request processing, existing backend status and final outcomes. Browser activation remains with the existing application boot error presentation.

## Acceptance criteria

The owner-local JSDOM/VM tests cover the six operation consumers, duplicate ids across targets, empty scopes, absent versus null config, immutable package controls, revision refresh, failure routing and subscription teardown. They prove renderer preparation only. Integration requires the backend's formal type export, preload facade, shell entry, error message keys and retry conditions to be aligned. Packaged Electron must then exercise all six operations with real Host and Client modules and show post-change use and Client boot errors.

## Risks

The prepared renderer is dormant in the current shell. Backend changes to the reviewed fields must be reconciled before real service integration. Applied confirms the backend outcome, not browser mount; no rollback or window-close recovery is promised.
