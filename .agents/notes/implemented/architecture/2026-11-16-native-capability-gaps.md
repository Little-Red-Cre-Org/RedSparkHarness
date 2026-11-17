# Agent Note: Native installers share the remaining capability owners

Status: implemented

English | [中文](2026-11-16-native-capability-gaps.zh.md)

## Problem

A Native profile could select most host capabilities, but SQLite storage, the invariant registry, the string-replace editor, directory picking, and the E2B sandbox still loaded only through Cordis services. Several Native Web entries also imported Cordis modules for helpers that do not use the Cordis runtime. Deleting Cordis before those owners have a Native installer would drop selectable behavior. The Cordis inspector and the Agent Team tools are separate: one reads the Cordis context graph, and the other calls a team service that Native does not provide.

## Decision

Cordis and Native installers in the same package share one owner. Native `resolve` validates the profile row and does not open resources. The Cordis class stays the compatibility adapter.

`@redspark/rsh-storage-sqlite` registers the same SQLite backend and provides `storageBackendsReady`. `@redspark/rsh-invariants` provides `invariants` from the shared package-name admission rules. `@redspark/rsh-tool-str-replace-editor` uses the same replacement, creation, and stale-version checks. Directory browse, the OS chooser, and the adaptive chooser share listing, the platform dialog, and the boot-time native-or-browse choice. The adaptive chooser reads the Native launch snapshot and does not mount a Cordis loader entry.

`@redspark/rsh-e2b` provides `e2b` through `E2BSandboxOwner` on `./owner`. `@redspark/rsh-fs-e2b` requires `e2b` and provides `fs`. `@redspark/rsh-subprocess-e2b` requires `e2b` and provides only `subprocess`. It does not provide `childConnection`. Defaults stay cwd `/home/user/workspace`, timeout `300000` ms, and subprocess `pollMs` 20. An empty `apiKey` does not read `E2B_API_KEY`.

Native Web entries for pet, general settings, message feedback, brand, input trigger, conversation trigger currency, schedule, client resources, and open-in-app import the shared helpers instead of Cordis modules.

`@redspark/rsh-experimental-inspector` stays a Cordis debugger and has no Native installer. `@redspark/rsh-tool-agent-team` stays on Cordis until a Native team runtime exists. [Agent Teams packages](2026-08-18-experimental-agent-teams-packages.md) still own that feature. [Cordis cleanup](../../proposed/architecture/2026-11-15-cordis-cleanup-keeps-legacy-writers.md) still does not delete Cordis, the vendor tree, or these packages.

## Alternatives considered

**Give the inspector a Native entry that reports plugin metadata.** Rejected. The inspector reads the Cordis context graph. A Native diagnostic would be a different tool.

**Move the Agent Team tools onto the Native filesystem and subprocess services.** Rejected. Those tools call the team service. Native has no team runtime for them to require.

**Delete the Cordis packages in this change.** Rejected. Legacy profiles and the remaining Cordis entries still load them. [Cordis cleanup keeps the legacy writers](../../proposed/architecture/2026-11-15-cordis-cleanup-keeps-legacy-writers.md) still sequences that deletion.

## Consequences

A Native profile can select SQLite, invariants, the string-replace editor, directory picking, and an E2B sandbox without those entries importing Cordis. Cordis plugins keep the same service names, defaults, and errors. Cordis packages remain installed. Inspector and Agent Team behavior is unchanged.
