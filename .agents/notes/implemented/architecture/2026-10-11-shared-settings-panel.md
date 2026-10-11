# Agent Note: Share the Settings panel as a UI primitive

Status: implemented

English | [中文](2026-10-11-shared-settings-panel.zh.md)

## Problem

The legacy Settings shell and the Cordis-free native application both need the same modal navigation. This applies the existing [shared client primitive rule](2026-09-05-shared-client-control-primitives.md) to Settings chrome: native code cannot runtime-import `ui-settings-general`, and copying the panel would split its visual owner.

## Decision

`ui-primitives` owns the props-only `SettingsPanel` and its CSS. The component accepts localized title and close label, navigation rows and selection callbacks, header actions, and page content; it owns the centered mask, panel, navigation icons, close button, and Escape handling. `ui-settings-general` and native-application supply their own data and locale through props.

## Alternatives considered

**Import `SettingsRoot` from native-application.** The component reads legacy slot renderers, locale hooks, connection state, and onboarding/session state, and a runtime edge from native-application to a feature package violates the Client package rules.

**Copy the panel markup and CSS into native-application.** That gives two owners for identical Settings chrome and makes later visual changes require synchronized edits.

**Keep separate legacy and native panels.** That avoids a package change but leaves the two settings windows visually divergent and duplicates modal behavior.

## Consequences

The shared component adds one public `ui-primitives` export and keeps both callers independent of Cordis. Navigation state, localized labels, selected page content, and header actions remain owned by each caller. Feature-specific pages still cross the package boundary only as props or are migrated into the native application; this primitive does not provide a feature-page bridge.
