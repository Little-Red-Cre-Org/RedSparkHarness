# Agent Note: Moving recorded Sessions onto the Native profile

Status: implemented

English | [中文](2026-11-10-moving-sessions-to-the-native-profile.zh.md)

## Problem

Moving a recorded scenario from the Cordis `legacy-headless` profile to the Native profile is not a manifest edit. A scenario assembles a profile from module links and rows, and several facts about that assembly are invisible from any package manifest: which rows already exist disabled, that a Registry wins a tool name it publishes, that a child Session needs its own replay fixture, and that the fs Provider's own byte budgets decide what a recorded result looks like.

The migration also forces decisions about places where the two runtimes genuinely differ — how a truncated result is reported, whether a parent model sees a child's reasoning, what a cancelled child reports, and where a child's identity is recorded — plus gaps that only a scenario walking the path exposes, such as hook records that desynchronize the application's pending batch or a model failure that loses its classification.

Without a record, each of these is rediscovered by the next person, and a scenario whose composition is merely incomplete looks like a product defect. That confusion produced three separate false alarms in one migration.

## Decision

Migrate scenario by scenario, and let each scenario carry the composition facts and the runtime differences it depends on. Record the reusable findings here rather than in per-scenario progress notes.

**Composition facts a scenario must carry.** A child Session needs one committed fixture per child, forwarded in role order through `RSH_SNAPSHOT_CHILD_FILES`; a per-round tool needs one fixture per round. A tool the profile already declares must be enabled through `composeRow` rather than re-added, because a repeated id and a duplicate provider are both rejected. A profile that installs a code-runtime tool must also install its tool, or the builtin `run_code` claims the name and rejects the recorded argument. A shell-backed scenario names the provider that runs its recorded dialect, with the `subprocess` and `shellEnv` providers that provider requires. A scenario observing truncation or a write result carries the same fs Provider budgets the recording used.

**Runtime differences are stated, not hidden.** A truncated result keeps its diagnostic tail and a recoverable path in both runtimes but is formatted by a different layer. A child result is its text, so a parent model never receives the child's reasoning; a non-completed child carries the compatibility headline with its preserved partial answer in one block. A termination marker is host-shaped, so a scenario accepts the POSIX signal name or the Windows exit status while still requiring the timeout itself. A child records its identity in its own log rather than on the parent, so a scenario asserts the facts both share.

**Gaps found by a scenario are fixed at the seam that owns them.** Interception and admission facts carry the application's tracked appender, because an append that bypasses the single contiguous batch desynchronizes the next persist; the admission appender tracks without persisting, because persisting splits the batch its caller is still assembling. The turn boundary reads a classified failure code from any `HarnessError`. A hook-rejected prompt reports exit code 0 beside its blocked turn reason, because rejecting is a decision rather than a crash. A package that publishes `./native` needs its own build entry, because the root build's default entry list omits it.

## Consequences

A migrated scenario proves what it asserts: the composition it carries is the composition the recording ran under, so a difference in the durable log is a real difference rather than a missing row. Three false alarms — `ralph-loop`, `archify-auto-routing`, `both-mode-turn` — each turned out to be an incomplete composition, and each is now a documented fact instead of a repeated investigation.

Six defects that would otherwise have shipped silently are fixed: the classified failure code, hook and admission records through the tracked appender, the non-persisting admission appender, the blocked-prompt exit code, the missing `hook-protocol` build entry, and the hook bridge's module shape. The first two are invisible on a happy path and only appear when something fails, which is exactly when the durable log must explain it.

Five alternatives are recorded as ruled out, so they are not retried: a Native `rsh-agent-default-model`, `agent/created`/`agent/disposed` as SubagentStart/Stop, a serial `session/starting`, a boolean-returning `turn/stopping`, and enqueueing hook context from inside a step-admission hook (which deadlocks, because enqueue waits for the admission it is called from).

**Scenarios a profile alone cannot replay.** Four groups need a decision rather than a composition. Host-specific sandbox behaviour (`partial-landlock-*`, `missing-sandbox-runner`) declares `platform: posix` and exercises Linux Landlock, so it can only be recorded on the platform it describes. A live fixture server (`web-fetch`, `web-search-endpoint-guidance`) needs a Cordis plugin and a deterministic `web` Provider, for which the Native assembler has no seam. A driver that changes the session mid-turn (`system-prompt-in-history`, `model-switch-notice`) records a prompt or model change between steps; a plain replay produces one system message and one request, so the change never happens. A recording older than the schema it exercises (`persistent-pwsh-tool-turn`, which omits the `description` both shell tools require) needs re-recording, not a relaxed parameter.

## Alternatives considered

- **Write per-scenario guidance into each snapshot directory.** Rejected: the composition facts repeat across dozens of scenarios, and a note per scenario becomes noise that drifts from the runtime.
- **Treat every difference as a compatibility bug and change the runtime to match.** Rejected: several differences are deliberate — a parent model must not read a child's private reasoning, and the collector's truncation notice is the layer that actually knows the bound.
- **Keep the migration's findings as a progress document outside `.agents/notes`.** Rejected: this repository keeps durable engineering records in the notes tree with a bilingual pair, and a stray directory has no gate, no pairing, and no archive discipline.
- **Assert the compatibility event names so the sequences match exactly.** Rejected: a child's `subagent/descriptor` lives in the child's own log, and inventing a parent-owned event to satisfy a snapshot would record something the runtime does not do.
- **Skip the scenarios whose composition needs a bespoke driver.** Rejected for the driver-free ones: the composition facts are exactly what a migration must establish, and a skipped scenario leaves the profile unproven.
