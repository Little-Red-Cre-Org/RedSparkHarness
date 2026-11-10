# Agent Note: Native hook bridges

Status: implemented

English | [中文](2026-11-10-native-hook-bridges.zh.md)

## Problem

The Claude Code and Codex bridges run external command hooks on the compatibility extension points: `agent/session-start`, `agent/pre-step`, `tools/pre-execute`, `tools/post-execute` and `agent/turn-stopping`. A Native profile exposes none of them. Until [Native tool interception points](2026-11-10-native-tool-interception-points.md) landed there was no per-call decision point at all, and even afterwards four of the seven Claude Code points had no Native counterpart: a Native bridge could not observe a Session starting, could not answer a submitted prompt, and could not ask for another step at the stopping boundary.

The gap is not cosmetic. `snapshots/session/` records fourteen scenarios that really run hooks, and the migration target is to replay every recorded Session on a Native profile. A migrated scenario whose hooks silently stop firing would still "pass" because the recorded events match, while the product lost the capability the scenario exercises.

## Decision

Both bridges publish a `./native` entry beside their Cordis entry. They share the config parser, the dialect payload vocabulary, the matcher, the command runner, the outcome merge and the durable `hook/invoked`/`hook/result` pair; only the extension-point wiring differs. `@redspark/rsh-hook-protocol/native` re-exports the framework-free half so a Native bridge never imports the Cordis package root.

The Native runtime gained the two seams the bridges need, and each seam is the smallest one that expresses the compatibility point:

- **`session/starting`** — a parallel Native event `native-headless` emits once per Session, after the opening inputs are durable and before the first request is built. A bridge answers it by registering a request-context provider, so the opening request awaits the hook's context instead of racing it. The compatibility point runs detached and can miss the first request; the Native one is awaited by the request that caused it.
- **`turn/stopping`** — a serial Native event emitted when a turn produces its last step and no recorded tool call continues it. A awaited listener may admit a `next-step` inbox message; the application re-reads that batch and opens another step only if one appeared. A listener that adds nothing lets the turn end. This replaces `steer()`, which the Native Agent has no equivalent of.

The two tool points come from the interception service; `UserPromptSubmit` maps onto the active owner's `beforeStep` admission hook, which is the Native Program's pre-step decision and the only place a prompt can be refused before a step opens.

Three compatibility capabilities have no Native counterpart and are recorded as gaps rather than emulated: `SubagentStart`/`SubagentStop` (the Native subagent seam announces no child lifecycle edge), a run-level halt for `{"continue": false}`, and `updatedInput` rewriting. Each is named in both package READMEs.

## Consequences

A Native profile that installs `@redspark/rsh-hooks-claude-code` or `@redspark/rsh-hooks-codex` runs the same hooks.json against the same payload shape, writes the same durable event pair and produces the same model-visible decisions, so a scenario can move between runtimes without its recording changing.

The lifecycle events are a Native application capability, not a hook capability: any Native plugin may answer them. `native-headless` gained them without changing its recorded output, which the native-headless suite shows by replaying unchanged.

`session/starting` being parallel is deliberate: one slow hook must not delay the opening request. The consequence is that an answered hook's context arrives through the request-context provider rather than through the announcement, and a hook slower than request preparation still misses that request — the same behaviour the compatibility bridge has, now stated rather than accidental.

`turn/stopping` being serial is equally deliberate: the application must know whether the batch grew before it closes the turn, so listeners run in registration order and the application awaits all of them.

The three packages are now mixed entries in `rsh/Scripts/native-package-policy.ts`, and the two bridge packages publish `./native` as a safe source subpath so their Cordis-free half stays usable during the retirement.

`rsh/Modules/Official/hooks/*/tests/native.spec.ts` covers both entries using real hook command scripts and a stub shell service; the hooks suites run on Linux because the Windows lane excludes them for their POSIX hook commands, as it did before this change.

## Alternatives considered

- **Give the bridges their own decision path instead of adding Native seams.** Rejected: the interception service already owns tool decisions, and a second path would drift. The lifecycle events are needed regardless, because no plugin can invent a stopping boundary.
- **Make `session/starting` serial so a hook's context lands in the announcement.** Rejected: a hook that never exits would then delay every Session's first request, and the compatibility bridge never had that power.
- **Have `turn/stopping` return a boolean instead of observing the inbox.** Rejected: the admission must be durable before the turn decides, and the durable inbox is where a forced continuation belongs — duplicating it as a return value would let the two disagree.
- **Emulate `SubagentStart`/`SubagentStop` from `agent/created`/`agent/disposed`.** Rejected: those announce every Agent, root included, with no parent attribution, so a bridge could not tell a subagent from the root Session and would fire a SubagentStop hook for the main Session. The gap stays stated until the subagent seam announces a child edge.
