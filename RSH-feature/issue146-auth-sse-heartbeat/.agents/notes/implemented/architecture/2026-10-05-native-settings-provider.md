# Agent Note: Native file-backed settings

Status: implemented

English | [中文](2026-10-05-native-settings-provider.zh.md)

## Problem

Native profiles selected `settings-file` but the package had no native installer. They could boot only if that row was removed, and model route changes in `settings.yaml` could not reach native execution.

## Decision

`dsh-settings/native` defines namespace ownership, layered resolution, ordered revisioned writes and live reads without importing Cordis. The native `settings-file` Provider uses the existing home path, YAML/JSON document, cross-process file lock and atomic replacement. It retains unregistered sections and applies valid external edits through the same service. The native pi-ai Consumer registers `llm-pi-ai`, overlays its profile base with the stored user section, and uses the committed profile map for the next request. Credential values remain in the existing native credentials Provider; settings hold references only.

## Consequences

A malformed document blocks boot or a service write; a malformed external edit leaves the last valid model configuration active and reports the reload failure without logging document text. Native settings exposes owner scopes rather than the legacy schema descriptor and redaction API, so no generic wire editor is implied. Native Hosts without a settings Provider retain their composed pi-ai routes.

## Alternatives considered

Running the Cordis settings service inside native Host would make it a second lifecycle authority. Copying the full compatibility management API would expand the public native surface before a native Client has an owner for it.

## Verification

Two focused native Host checks cover document preservation, revision rejection and a model route loaded from settings. Host typecheck, native dependency verification, package build and built-entry import verify the package path. A full shipped profile boot still depends on the separate `agent-instructions` native installer.
