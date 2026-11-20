---
description: "Explicit Cordis adapters for selected native runtimes and compatibility-profile consumers during the staged migration."
kind: "package-group"
---

# DSH compatibility bridges

English | [中文](README.zh.md)

## Summary

Compatibility bridges let native profiles select narrowly supported Cordis contributions without loading a legacy application bundle, and keep profile-specific Cordis wiring outside Engine owners. They preserve native Agent, Session, and tool-result ownership and release mounted plugins with the native installation. The group also owns declaration packages and explicit Settings adapters for legacy Cordis profiles.

Native profiles select the [filesystem subsystem](../../../Docs/subsystems/filesystem.md) providers and tools directly; the group no longer bridges legacy DSH filesystem plugins.

## Packages

| Package | Purpose |
|---|---|
| [`compat-settings-definition/`](compat-settings-definition/README.md) | Cordis Settings Context and event declarations |
| [`compat-settings-adapters/`](compat-settings-adapters/README.md) | Owner-scoped Cordis Settings adapters for selected Engine services |
| [`subagent-codex/`](subagent-codex/README.md) | Codex app-server subagent adapter for Cordis compatibility profiles |
