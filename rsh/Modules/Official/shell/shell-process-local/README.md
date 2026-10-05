---
description: "Shared native process lifecycle for Bash and PowerShell shell Providers."
kind: "package-reference"
---

# @deepseek-ai/dsh-shell-process-local

English | [中文](README.zh.md)

## Summary

This Cordis-free library owns request budget resolution, managed subprocess launch, foreground timeout classification, and consuming background output reads for local shell Providers. Bash and PowerShell select their own executable argv, timeout reason, and environment defaults. The library does not register a shell or expose a model tool.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Configuration

`resolveConfig(input, label, extraFields)` validates positive finite execution budgets and rejects unknown fields. A Provider supplies a `ShellDialect` and a managed `subprocess` service to `LocalShellController`. The controller sends caller environment after dialect defaults and trusted `dshEnv` last. Foreground runs return timeout and cancellation facts independently; background handles settle after managed process completion.

No invariant companion is published because subprocess ownership and completion are enforced by the provider service, and request budgets are validated before constructing a controller.

## Model Experience

Indirectly, through the Bash and PowerShell tools that render these process results.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The library requires a dialect Provider to choose an executable; it cannot run a command alone.

### Dev Note

None.
