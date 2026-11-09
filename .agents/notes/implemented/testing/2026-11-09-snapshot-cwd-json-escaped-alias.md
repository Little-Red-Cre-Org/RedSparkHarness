# Agent Note: Normalize the JSON-escaped cwd spelling in session snapshots

Status: implemented

English | [中文](2026-11-09-snapshot-cwd-json-escaped-alias.zh.md)

## Problem

A recorded runtime-context snapshot embeds the sandbox workspace root as a JSON string, because the policy text states the path with `JSON.stringify`. On Windows every separator in that fragment is serialized as a doubled backslash, so the workspace appears in the log in a spelling that differs from the Session header `cwd`. The headless session suite tokenized only the header spelling, so `session-sandbox-root` and `web-fetch` compared a real Windows path against the recorded `{{cwd}}` token and failed on every platform that allocates its workspace above a backslash-bearing path.

## Decision

`contextOf` in `snapshots/session/headless.snapshot.ts` supplies the JSON-escaped spelling of the run cwd as a `NormalizeContext.cwdAliases` entry: `JSON.stringify(cwd).slice(1, -1)`. The existing longest-first alias replacement then tokenizes both spellings. The four headless profile e2e owners in `rsh/Programs/CLI/tests/profiles/headless/tests/` already pass this same alias for the same reason; the session snapshot owner now matches them.

The alias is spelling, not equivalence. On a POSIX cwd the escaped spelling equals the plain spelling, so the entry collapses to one token and changes nothing; on Windows it adds exactly the one representation the policy text produces.

## Alternatives considered

**Render the policy text without `JSON.stringify`.** That would change the model-visible runtime-context text on every platform to fix a comparison defect, and would invalidate committed fixtures that record the quoted form.

**Teach the normalizer to unescape backslashes globally.** A global rewrite would also corrupt regexes, shell commands, and model-authored text that legitimately contains doubled backslashes, and the normalizer already confines separator handling to recognized path positions.

**Record a platform-specific writer fixture.** The scenario observes a real policy snapshot, not a platform opinion, and the committed generation must stay replayable on macOS and Linux.

## Consequences

The session suite now tokenizes the workspace inside the sandbox-policy section, and `session-sandbox-root` passes on Windows without touching its fixture or its `/tmp` configuration. The change removes two of the suite's local Windows failures and leaves the remaining failures attributable to their own causes: a platform-selected shell tool, fixtures that trail source, a skill path deleted with the `cordis` preset, an unmatched replay placeholder, and a path join defect.

The alias list stays a per-owner input rather than a normalizer default. A producer that embeds a path in another serialization must name that spelling where it knows the run cwd; the normalizer cannot guess which segments are paths.
