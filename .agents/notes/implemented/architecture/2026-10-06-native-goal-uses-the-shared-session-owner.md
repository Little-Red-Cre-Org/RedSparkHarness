# Agent Note: Native Goal uses the shared Session owner

Status: implemented

English | [中文](2026-10-06-native-goal-uses-the-shared-session-owner.zh.md)

## Problem

Native profiles need the same durable Goal state and bounded continuation policy as compatibility profiles, while the selected Program remains the sole owner of Session persistence and execution.

## Decision

The native `@deepseek-ai/dsh-goal` Provider requires the Program's `agents` and `activeSessions` services. It restores Goal facts from the active owner's durable Session events and appends mutations through that owner; it adds no writer or model loop.

The native Goal round driver uses that owner's admission and idle hooks, and `@deepseek-ai/dsh-tool-goal` authorizes mutations from the exact live root Agent and durable current-turn user messages. A fresh or restored Goal starts disarmed; an explicit human resume arms continuation.

The shipped `native-headless` and `native-tui` CLI profiles install the Goal Definition, round driver, and model tools at root while retaining one `session-execution` installation. Both profiles use the Program's existing Session and Agent authority.

The native Commands Provider and Goal command Consumer are available as packages, but the shipped CLI profiles do not mount them because native TUI has no command presentation adapter. Native model-facing Goal tools remain available; the profiles do not expose a `/goal` command UI.

## Alternatives considered

- **Add a second Goal store or execution loop.** Rejected because durable Goal changes already belong to the Session log, and a parallel owner would split replay, serialization, and turn authority.
- **Use the compatibility Goal entry in native profiles.** Rejected because native profiles load declared native entries and keep Cordis outside the native dependency graph.
- **Wait for a native command adapter before installing Goal tools.** Rejected because model-facing Goal controls provide a supported human interaction path and the native headless profile can verify durable continuation through the shipped `dsh` entry.

## Consequences

Native Goal state, model tools, and round admission share the selected Session owner without creating another writer or loop. Restored active Goals remain disarmed until an explicit human action resumes them.

Native headless users can create, continue, block, resume, and complete a Goal through model-facing tools. Native TUI profiles install the same components, but they do not provide slash-command discovery or rendering.

## Verification

The built keyless `dsh --profile native-headless` replay substitutes a deterministic model plugin, writes JSONL Session data, blocks after an admitted Goal round, restarts the process, requires explicit human resume, and completes the Goal. It checks durable Goal and message-source events, tool schemas, prompts, and model requests.

The CLI profile-template test checks Goal installation in `native-headless` and `native-tui` and confirms each composition retains one `session-execution` row; it does not claim an interactive native TUI command flow.
