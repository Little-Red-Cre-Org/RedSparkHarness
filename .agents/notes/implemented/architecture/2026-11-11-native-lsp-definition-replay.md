# Agent Note: Native replays the LSP definition lookup

Status: implemented

English | [中文](2026-11-11-native-lsp-definition-replay.zh.md)

## Problem

The lsp-definition recording asks the `lsp` tool for a definition in `subject.ts` and stores `subject.ts:1:7` plus an omission marker. The twelve-row native test profile has no language server, subprocess, or prompt sections, so the recording could not replay.

## Decision

The native scenario installs `subprocess-local`, `native-prompt`, `lsp`, `lsp-stdio`, and `tool-lsp`. The stdio server is the scenario's `lsp-server.mjs`, started with the current Node executable and a workspace-relative argument. `maxLocations` stays 1, matching the recorded omission. The persisted result contains `subject.ts:1:7` and `1 more location omitted`.

## Alternatives considered

**Stub the LSP service inside the test.** That would skip the stdio server the recording actually runs. The native replay would not exercise provider startup or the location cap.

**Raise maxLocations.** The tool would return every location and the omission line would disappear. The recorded result would not match.

## Consequences

A native profile that does not install these rows is unchanged. The scenario depends on a workspace language-server script and on Node being able to spawn it.
