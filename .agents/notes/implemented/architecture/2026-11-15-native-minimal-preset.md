# Agent Note: Native Minimal is one persistent shell

Status: implemented

English | [中文](2026-11-15-native-minimal-preset.zh.md)

## Problem

The shipped Cordis `minimal` preset gives the model one fixed prompt, `You are a helpful software engineer assistant.`, and one platform persistent shell. It suppresses runtime-context snapshots and does not compact history. The Native `minimal` scope only registered a roster row described as task tracking without Goal tools, so a selected Minimal session still saw root tools, the application prompt, and automatic compaction.

## Decision

`native-web` and `native-tui` install Minimal as its own scope. The persona row sets `complete: true` and `includeRuntimeContext: false`. The Native prompt registry renders that one section and records the suppressor. `native-headless` uses a complete section as the whole system prompt and skips the system-prompt runtime-context snapshot when the suppressor is visible.

The standing row sets `allowedTools` to `bash` or `pwsh` and `compaction: false`. When an Agent is created in that scope, the row restricts inherited tools to that name. The persistent shell is registered in the Minimal scope, so it shadows the root one-shot shell of the same name. Compaction skips automatic pressure, overflow recovery, and manual compaction for that scope and its descendants.

Root, Standard, PTC, and Creation compositions are unchanged. The Cordis `agent.cordis.yml` for Minimal stays for legacy profiles. This note does not move `profile: web` snapshot directories.

## Alternatives considered

**Hide root tools by an empty allowlist on the preset scope.** Rejected. A descendant Agent reapplies that allowlist to tools the preset itself registered, which removes the persistent shell.

**Change Minimal to match the old roster description and keep `todo_write`.** Rejected. The shipped Cordis preset is a persistent shell, not a task tracker. The TUI row that installed `todo_write` on Minimal is removed.

## Consequences

Selecting Minimal on a new Native Web or TUI profile shows one persistent shell and the fixed prompt, and that session does not replace history through compaction. An existing legacy profile is not rewritten.
