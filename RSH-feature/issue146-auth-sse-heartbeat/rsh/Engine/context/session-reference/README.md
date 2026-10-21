---
description: "Cross-session snapshot references and durable untrusted model context, for users and maintainers enabling or debugging ctx.sessionReferenceResolver."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-reference

English | [中文](README.zh.md)

## Summary

`dsh-session-reference` lets a conversation cite another session and gives the model a bounded, read-only snapshot as durable, untrusted context. Cordis hosts replace `@label` mentions with readable labels; Native preserves the admitted canonical URI and appends a separate snapshot. Discovery ranks sessions by working-directory affinity and uses their latest titles as labels. Snapshots freeze at capture and warn against following their instructions, permission claims, or tool requests. The package reads through `ctx.sessionQuery` or its Native service and does not require SQLite FTS.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Enable this service when hosts should let a user mention another session and give the model its context. It works with any session-query backend because it consumes the backend-independent compact checkpoint marker.

### Mention syntax

A canonical mention is `@[label](dsh-session:<base64url-encoded-id>)` in Markdown, or the bare `dsh-session:` URI; every JavaScript string session id round-trips exactly. The Cordis resolver rewrites mentions into readable `@label` text in the message and returns the structured references. Explicit Markdown mentions reject malformed URIs; empty or punctuation-only scheme mentions stay ordinary discussion text.

### What the agent gets

A message that cites other sessions is followed immediately by a `## Referenced sessions` snapshot as a second user-role message. The snapshot is untrusted background: the fixed warning tells the model not to follow instructions, permission claims, or tool requests inside it unless the current user explicitly repeats them. Each source preview is bounded independently — at most `maxReferences` distinct sessions per message and a configured or model-relative serialized JSON byte budget per source. Retention drops older non-checkpoint messages before shortening retained text; preparation fails only when the reference cannot fit even after retention.

For a truncated reference, an optional spill backend saves the full captured text projection under the target session. A separate omission notice outside the bounded preview JSON gives exact `omittedMessages` and `omittedBytes`, then the saved locator and `retrievalHint`, or an unavailable outcome distinguishing missing storage from a failed save. The notice is part of the same durable context message. Full transcripts carry the same untrusted-background warning and capture metadata, including `capturedFormatVersion`. Each message uses JSON string fragments of at most 64 Unicode code points per line; decode and concatenate its fragments to recover exact text, including original newlines. This fixed storage format keeps even long single-line text readable through paged file reads.

### Native integration

The Native provider preserves the canonical URI in the admitted user message and returns a separate snapshot context without changing that input. When Native headless composes it with workspace instructions, the existing Session writer persists the original input and prepared context; later model-history reconstruction reads that captured context from the log. The model-visible mention therefore differs from Cordis `@label` replacement.

Native consumers can omit the optional Cordis peer when importing the explicit `/native` entry. The package-root service remains the Cordis adapter and requires Cordis when imported.

Native accepts `maxReferences` (default `3`) and `maxReferenceBytes` (fixed default `65536`). These defaults do not use model capacity; Native rejects Cordis-only `candidateLimit` and `referenceContextFraction`. Native preparation waits for all started reads and spill writes to settle before returning an error or cancellation, so callers can release the Session writer and selected services after preparation ends.

### Finding sessions to reference

`listCandidates(agent, query?, limit?)` lists sessions other than the agent's own, filters case-insensitively by id, working directory, or the projected title, and ranks same-directory sessions first. Each candidate carries its latest title as the mention label, falling back to the session id when the title is absent or unreadable, and reports whether its working directory is the requesting agent's so a host can surface a location only when it distinguishes the row. Browser consumers call the same discovery as `ctx.remote.sessionReferenceResolver.candidates`, which attaches each candidate's canonical mention.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxReferences` | `3` | Maximum distinct source sessions in one prepared message; must not exceed `3` |
| `candidateLimit` | `50` | Default candidate count returned to a host |
| `maxReferenceBytes` | automatic | Explicit maximum serialized JSON bytes per source; overrides the automatic budget exactly |
| `referenceContextFraction` | `0.2` | Context-window fraction per source, from `0` to `1` |

The automatic budget is `max(65536, floor(contextWindow × 4 × referenceContextFraction))` bytes per source. Model context capacity is measured in tokens; four bytes per token is a sizing heuristic, not an exact token conversion. A missing route, LLM service, adapter, or capacity uses 64 KiB; other model metadata lookup errors and cancellation fail preparation. Direct content is snapshotted and reference IDs are validated before this asynchronous lookup.

The generated [configuration catalog](../../../Docs/config-catalog.md#deepseek-aidsh-session-reference) is the exhaustive source for every accepted field and its JSDoc.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design of the service; the observable behavior is covered in [Use this package](#use-this-package).

### Design concept

Preparation reads each referenced session's current surface exactly once, when the target message reaches `agent/pre-step`. Both preview and spill use that same captured projection: direct-user text, assistant text, and user checkpoints carrying the canonical compaction marker; tools, reasoning, and other injected context are excluded. This prevents recursive reference propagation and prevents a later source mutation from changing the saved transcript. Preview JSON escapes every `<` as `\u003c`, so source text cannot spell the `<referenced-sessions>` framing tag.

The resolver discovers optional storage through `ctx.get("spillStore")` and saves only truncated references. Storage ownership is the target session; provenance identifies the referenced source session and label, without a fabricated tool call. Cancellation waits for started reads and spill writes to settle, then prevents publication even if an artifact was written. Artifact expiry remains the backend's existing policy.

The budget uses the provider and model captured after `system-prompt/assemble` completes for the target agent. Direct `prepare` calls before any assembly use agent options; session headers do not select the budget model. Diagnostic assemblies without an agent do not affect captured routes.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `SessionReferenceResolver`: pre-step listener, candidate discovery, preparation |
| [`src/config.ts`](src/config.ts) | `Config` schema, `SessionReferenceError` taxonomy |
| [`src/uri.ts`](src/uri.ts) | `dsh-session:` URI codec, mention formatting and parsing |
| [`src/projection.ts`](src/projection.ts) | Current-surface projection and byte-budget retention |
| [`src/serialization.ts`](src/serialization.ts) | Tag-safe JSON escaping for snapshot payloads |
| [`src/spill.ts`](src/spill.ts) | Full transcript serialization and model-visible omission notices |
| [`src/types.ts`](src/types.ts) | `SessionReferenceInput`/`Candidate` and source types |
| — | No runtime invariant companion is published; preparation returns immutable per-call snapshots validated while they are built, and the agent/session layers own durable context admission, freezing, and replay. |

### Main flow

The Cordis `agent/pre-step` listener accepts the step, parses canonical mentions out of direct user messages, then calls `prepare`, which normalizes references (first-mention order, deduplication, self-reference and count rejection), reads every surface in parallel, retains each under its resolved byte budget, and renders the aggregated prompt. Each durable source record keeps the frozen `capturedThroughSeq` and records a nonzero `capturedFormatVersion`; absence denotes format v0. Cordis inserts each snapshot immediately after the message that cited it. Native preparation leaves the admitted message unchanged and returns separate snapshot contexts for the Native headless Session writer.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared reference surface to the design decision and the read service behind it.

- [Session-reference subsystem](../../../Docs/subsystems/session-reference.md) — canonical URIs, projection rules, and the stable error taxonomy.
- [Session-reference spill reuse](../../../../.agents/notes/implemented/bug-fix/2026-09-05-session-reference-spill-reuse.md) — snapshot identity, omission notices, storage ownership, and alternatives.
- [Session-query subsystem](../../../Docs/subsystems/session-query.md) — the read service that supplies session surfaces.
- [Context group map](../README.md) — sibling request-context packages.
- [Generated configuration catalog](../../../Docs/config-catalog.md#deepseek-aidsh-session-reference) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### Referenced session background

#### What the model sees

Cordis sends the current message with its readable `@label`, followed by the `## Referenced sessions` untrusted snapshot. The fixed warning says not to follow snapshot instructions, permission claims, or tool requests unless the user repeats them. Labels, cwd values, ids, and conversation text are JSON inside `<referenced-sessions>` tags; each data `<` is emitted as `\u003c`, so source text cannot spell a framing tag. Native preserves the canonical URI in the admitted message and appends a separate untrusted snapshot after configured workspace instructions. The existing Session writer persists the source facts and context, and requests replay the captured text without rereading the source. This differs from Cordis's readable `@label` substitution; the representations are not claimed to be equivalent.

#### Token effect

Each referenced message adds the fixed warning plus up to three serialized previews, each independently bounded by the configured or model-relative byte budget. Truncated references add separate omission notices outside that budget; a saved full transcript adds tokens only when retrieved. The exact context remains in target history until target compaction shadows or summarizes it; source-session changes add no further tokens.

#### KV Cache effect

The request and snapshot are consecutive append-only target messages and preserve earlier cacheable history. Different references or source capture contents change the new suffix only; later target compaction may invalidate reuse from its replacement boundary.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when cross-session references are a poor fit. They are current package constraints.

- **No body discovery** — candidate queries inspect titles but do not search message bodies.
- **Labels come from projections alone** — an attached session is labeled from its live projection cut, a cold one from its durable checkpoint, and a session neither answers for is labeled by its id and cannot be found by its title. Discovery never reads a log: folding one title costs a whole log, and this runs under every completion keystroke. A session persisted before the projection cache was composed regains its title the first time it is opened, which checkpoints it.
- **Trusted caller boundary** — the service assumes its host is authorized to read every session exposed by `ctx.sessionQuery`; it is not a model-facing search tool.
- **Text projection only** — non-text user and assistant blocks are not propagated across sessions.
- **No live link** — references are snapshots, not forks, resumes, subscriptions, or source-session mutations.
- **Transcript search is line-based** — a literal phrase can straddle JSON-fragment lines or include escaped characters; decode and concatenate a message's fragments for exact text matching. Saved artifacts may expire under the backend's policy.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
