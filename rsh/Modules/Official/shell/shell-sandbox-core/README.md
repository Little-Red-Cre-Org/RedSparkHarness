---
description: "Shared native confinement and result classification for shell Providers."
kind: "package-reference"
---

# @deepseek-ai/dsh-shell-sandbox-core

English | [中文](README.zh.md)

## Summary

This Cordis-free library applies a selected sandbox policy to shell command argv and reports enforcement, denial, and runner failure facts. Bash and PowerShell Providers supply their own command argv and managed local executor. A restricted call never falls back to an unconfined command.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Configuration

`SandboxShellController` requires a managed local shell, a process sandbox, a policy provider, and a dialect argv builder. Foreground calls classify runner failures before denial matches; background calls retain the selected runner facts until the process settles. Full-access calls bypass the confinement runner only when the resolved policy explicitly selects `danger-full-access`.

No invariant companion is published because each process's sandbox facts are retained inside its owning controller and stamped before its completion promise settles.

## Model Experience

Indirectly, through the Bash and PowerShell tools that render these confinement results.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The library requires a dialect Provider and cannot choose a runner or command executable by itself.

### Dev Note

None.
