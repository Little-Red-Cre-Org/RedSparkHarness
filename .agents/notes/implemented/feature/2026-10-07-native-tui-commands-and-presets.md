# Agent Note: Native terminal commands and standing presets

Status: implemented

English | [中文](2026-10-07-native-tui-commands-and-presets.zh.md)

## Problem

The native terminal presents Session and model controls, but it does not expose the shared command registry or selectable native profile compositions. Users cannot invoke a Goal command from the terminal or choose a real scope composition before a Session starts.

## Decision

The `native-tui` profile installs the shared `commands` Provider, the Goal command, the `agent-presets` Registry and two standing compositions. The `standard` and `minimal` compositions use separate child scopes; Goal tools are installed only in `standard`, while Todo tools are installed in both. The profile template remains explicit and does not change other Programs' preset defaults.

The terminal keeps its local control names reserved. `/help` lists visible contributed commands except reserved names; unknown slash input and invalid arguments remain local and never enter the model conversation. Other command lines dispatch through the exact selected root Session owner and the existing native executor. This lets `/goal pause` interrupt an active Goal model request without placing the pause command behind that request. The shared command Provider records command execution facts in the Session; the terminal adds no writer.

## Alternatives considered

**Put slash commands on the model input queue:** Rejected because a Goal pause would wait behind the model turn it must interrupt, and command text would become model-visible user input.

**Register two preset names on the same scope:** Rejected because both choices would expose the same tools and prompt contributions.

**Replace the compatibility profile presets globally:** Rejected because the native TUI needs only an explicit opt-in composition and other Programs retain their existing preset behavior.

## Consequences

Native TUI users can select distinct profile-installed scopes before the first turn and invoke shared command handlers without a second Session writer. Custom native TUI profiles must install the Registry and each standing composition they expose. Local command names cannot be overridden by contributions.

## Verification

The `native-tui` PTY snapshot launches through `dsh --profile native-tui`, selects the shipped Minimal scope, checks its actual tool schema, rejects local-name collisions and unknown commands, pauses an in-flight Goal request, and cold-restores the same Session. The prior pinned preset-control Session remains an independent legacy Registry fixture.
