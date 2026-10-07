---
description: "Explicit Cordis adapters for selected native runtimes and compatibility-profile consumers during the staged migration."
kind: "package-group"
---

# DSH compatibility bridges

English | [中文](README.zh.md)

## Summary

Compatibility bridges let native profiles select narrowly supported Cordis contributions without loading a legacy application bundle, and keep profile-specific Cordis wiring outside Engine owners. Runtime bridges preserve native Agent, Session, and tool-result ownership and release mounted plugins with the native installation. The group also owns declaration packages and explicit Settings adapters for legacy Cordis profiles.

The optional [`compat-dsh-runtime`](compat-dsh-runtime/README.md) owns one shared Cordis Context for the selected bridges. Leave it out of a native installation plan to keep Cordis unloaded.

The [filesystem subsystem](../../../Docs/subsystems/filesystem.md) defines the shared operations and policy events these bridges adapt.

## Packages

| Package | Purpose |
|---|---|
| [`compat-dsh-runtime/`](compat-dsh-runtime/README.md) | Optional shared Cordis Context and allowlisted DSH plugin mounts |
| [`compat-settings-definition/`](compat-settings-definition/README.md) | Cordis Settings Context and event declarations |
| [`compat-settings-adapters/`](compat-settings-adapters/README.md) | Owner-scoped Cordis Settings adapters for selected Engine services |
| [`compat-fs-local/`](compat-fs-local/README.md) | Local filesystem Provider for native consumers |
| [`compat-fs-policy/`](compat-fs-policy/README.md) | Filesystem observation policy for native events |
| [`compat-fs-sandbox/`](compat-fs-sandbox/README.md) | Policy-required sandbox filesystem Provider |
| [`compat-tool-fs/`](compat-tool-fs/README.md) | Legacy filesystem tool and prompt contributions |
