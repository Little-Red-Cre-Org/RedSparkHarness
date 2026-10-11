# Agent Note: Native Web reads the Agent preset roster

Status: implemented

English | [中文](2026-10-11-native-web-agent-preset-roster.zh.md)

## Problem

The native Host can return the Agent preset roster, but the native Web Settings page did not expose it.

## Decision

`native-application` passes `agentPresetsList` from the selected `client-native-session` Consumer and renders a local read-only list. It shows each preset's name and optional description, marks the Host default, and labels `needs-migration` and `invalid` entries. Invalid rows also show the Host's `problem`. The view writes no preset or Session state and imports no legacy preset runtime.

## Alternatives considered

**Keep the placeholder.** That would leave the existing Host roster inaccessible through Native Web.

**Import the legacy `ui-agent-preset` runtime.** Its Settings controls use legacy registrations and management actions, which the native read-only view does not own.

## Consequences

Native Web can inspect the Host's preset names, descriptions, default and status. The Client renders the Host response without changing preset or Session state. The Host remains the roster authority, and the native view remains a read-only projection.

## Verification

One Native Application render test covers the default marker, descriptions, migration-needed and invalid badges, and the invalid reason.

## Related

The preset composition decision is recorded in [A session's agent is composed from a preset cordis.yml](../architecture/2026-08-03-per-session-agent-presets.md). The selected Client operation is documented in the [native Session package](../../../../rsh/Programs/Web/client/native-session/README.md).
