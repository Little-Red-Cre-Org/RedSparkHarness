# Agent Note: Native profile runtime and legacy settings

Status: implemented

English | [中文](2026-10-17-native-profile-runtime-and-legacy-settings.zh.md)

## Problem

An existing profile manifest without a runtime marker could be mistaken for a legacy profile even when it had no Cordis bundle declaration. Native settings also preserve unregistered sections, so legacy values could remain present without affecting their former behavior or reaching a native installation.

## Decision

`dsh.profile.runtime` explicitly selects `native` or `legacy`. An existing unmarked manifest is legacy only when it declares a `bundles` array; a missing manifest remains eligible for the existing initializer, and the runtime reader never writes profile data. Native templates and the legacy app-boot initializer persist their own runtime marker.

The CLI Native launcher checks active installed profile plugins and the Client installations selected through an active Native Web Host `config.projectDir`. It reads the selected settings-file path and values from the effective profile after JSON patches, then locks and re-reads the original persistent JSON files before applying migration intents. It copies supported values only when the native target is unset, skips a target equal to the legacy value, and rejects every other persisted value as a conflict that names both values and the file and key to change; `locale.preference: system` requires an unset native locale. It validates an `agent-presets.default` id against native preset discovery before writing. It retains `settings.yaml`; launch variables are checked only from the inherited process layer, while `.env` continues to reject `DSH_*` bootstrap variables. The preflight and Cordis patch refusal run on the CLI native launch path, outside the shared profile loader used by DesktopHost.

The CLI Native launcher installs the existing HTTP proxy dispatcher from the launch environment before plugin activation and disposes it after Host shutdown.

## Alternatives considered

**Infer legacy from every missing runtime marker.** Rejected because an incomplete manifest would silently enter the Cordis runtime even when it declared neither bundles nor native composition.

**Map process variables into profile configuration.** Rejected because a transient process override would become durable profile state. The launcher instead rejects unsupported process values and keeps the settings-file migration explicit.

**Run migration from the shared profile reader.** Rejected because DesktopHost also uses that reader, while this migration and native CLI environment checks belong only to CLI launch.

## Consequences

An existing Native CLI profile can write supported legacy settings to its profile files on startup, while preserving the source document. A conflicting native value stops before either profile file is written. Other launchers keep their existing runtime and configuration behavior.
