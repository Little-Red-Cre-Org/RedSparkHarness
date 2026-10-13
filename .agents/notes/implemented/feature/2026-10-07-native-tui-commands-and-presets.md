# Agent Note: Native terminal commands and standing presets

Status: implemented

English | [中文](2026-10-07-native-tui-commands-and-presets.zh.md)

## Problem

The native terminal presents Session and model controls, but it does not expose the shared command registry or selectable native profile compositions. Users cannot invoke a Goal command from the terminal or choose a real scope composition before a Session starts.

## Decision

The `native-tui` profile installs the shared `commands` Provider, the Goal command, the `agent-presets` Registry and two standing compositions. The `standard` and `minimal` compositions use separate child scopes; Goal tools are installed only in `standard`, while Todo tools are installed in both. The profile template remains explicit and does not change other Programs' preset defaults.

The terminal keeps its local control names reserved. `/help` lists visible contributed commands except reserved names; invalid command arguments and slash input that matches neither a command nor a Skill remain local. After installed-command dispatch returns no match, the terminal checks Native Skills in the exact selected root Session's Agent scope and Session cwd. It queues the unchanged slash line only when the matching Skill is user-invocable; an unfinished lookup does not queue after cancellation, a human request, owner change, or close. Other command lines dispatch through the exact selected root Session owner and the existing native executor. This lets `/goal pause` interrupt an active Goal model request without placing the pause command behind that request. The shared command Provider records command execution facts in the Session; the terminal adds no writer.

## Alternatives considered

**Treat every slash command as ordinary model input:** Rejected because a Goal pause would wait behind the model turn it must interrupt, and command handlers would become model-visible user input. Only a command miss that resolves a user-invocable Native Skill enters the user-message queue.

**Register two preset names on the same scope:** Rejected because both choices would expose the same tools and prompt contributions.

**Replace the compatibility profile presets globally:** Rejected because the native TUI needs only an explicit opt-in composition and other Programs retain their existing preset behavior.

## Consequences

Native TUI users can select distinct profile-installed scopes before the first turn and invoke shared command handlers without a second Session writer. A slash line that misses command dispatch can invoke a user-invocable Native Skill from the selected Session's exact scope and cwd; unknown names retain the local unavailable-command notice. Custom native TUI profiles must install the Registry and each standing composition they expose. Local command names cannot be overridden by contributions.

## Verification

The `native-tui` PTY snapshot launches through `dsh --profile native-tui`, selects the shipped Minimal scope, checks its actual tool schema, rejects local-name collisions and unknown commands, pauses an in-flight Goal request, and cold-restores the same Session. The Native Skill-routing PTY case preserves the `/missing` notice, reaches Archify only after installed-command dispatch misses, and checks that the unchanged slash line and Skill instructions reach the model while the installed absolute path stays out of the request and Session log. Controller proofs verify that cancellation, a human request, and close prevent an unfinished Skill lookup from queueing input. The prior pinned preset-control Session remains an independent legacy Registry fixture.
