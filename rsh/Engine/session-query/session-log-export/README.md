---
description: "Session-log ZIP export for Web downloads and Native Host consumers that need a canonical archive stream of a Session tree and its attachments."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-log-export

English | [中文](README.zh.md)

## Summary

`dsh-session-log-export` lets Web users download a Session tree and its attachments as a ZIP. Native Host consumers can request the same canonical archive as a byte stream and choose how to deliver it. The package does not select a Host path or transport. Setup and usage come first; implementation details follow.

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

Use this package when Web users need a session download or a Native Host consumer needs an archive stream. Mount the Web plugin for the Session Header action and `/export`; select the Native entry with Session query, persistence, attachments, and active-session providers for programmatic access.

### When to choose it

Choose it for a Web download or a Native Host caller that owns its stream destination. The Native API returns a filename and byte stream; the caller owns HTTP, file, or other transport. The archive reads canonical persistence handles, so each mounted persistence backend uses the same format.

### Composition

```yaml
- id: session-log-download
  name: '@deepseek-ai/dsh-session-log-export'
```

The Web bundle mounts the package with Connection, `dsh-commands`, `dsh-client-ui-commands`, and `dsh-client-ui-conversation`.

The Native Host entry provides `sessionLogExport`. Call `createArchive(sessionId, { includeDescendants, signal })`; it returns the archive filename and stream, or `undefined` when the root Session is absent.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `compressionLevel` | `6` | DEFLATE level from 0 through 9 for each ZIP entry. |

### Command contract

| Input | Result |
|---|---|
| `/export` | Records a human-command lifecycle; the submitting browser downloads `GET /api/session.export?sessionId=<id>&includeDescendants=true` |
| `/export <path>` | An error; browser downloads choose their destination through the browser's ordinary download behavior |

### What to expect

The Web dialog reports three phases: preparing, download started, or failed. Closing the dialog does not cancel an in-flight download, and the dialog does not reopen when that operation later settles. One session admits one active browser download at a time; repeated gestures share that operation. Both Host paths flush a live Session before reading canonical persistence; Native export checks that the exact active owner remains the same through the read. Each logical log uses the current generation's canonical filename (`session.jsonl` for v0, otherwise `session.vN.jsonl`), including beneath each sub-session directory. Images use `media/<attachmentId>.<ext>`, and generic files use `files/<digest-prefix>/<digest>/<name>`. Generic-file bytes are read and compressed as bounded chunks, so exporting a large upload does not buffer it in full.

### Failures

The dialog shows a preparation error when the preflight fails before ZIP streaming starts — for example an unreachable or misconfigured host endpoint. A descendant or attachment read failure after the browser accepts the GET is reported by the browser download manager, not by the dialog. Native callers receive root preparation errors from `createArchive`; descendant or attachment errors fail the returned stream, and provider disposal aborts and drains accepted archive work.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the package wires the export control and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design split

The package has three parts. The Cordis adapter ([`src/index.ts`](src/index.ts)) registers the `/export` command and contributes the exact `GET`/`HEAD /api/session.export` Fetch route to Connection. The Native Host provider ([`src/native.ts`](src/native.ts)) exposes `sessionLogExport` and drains accepted reads and ZIP producers during disposal. Both adapters use [`src/archive.ts`](src/archive.ts) for canonical reads and bounded ZIP production; the browser controls live in [`src/client/index.ts`](src/client/index.ts). The Web route remains the Cordis adapter, so its transport migration is outside this Native capability.

### Download flow

Both entry paths issue a `HEAD` preflight to `/api/session.export?...`, then hand the GET URL to the browser download manager without buffering the ZIP in JavaScript. One controller owns one in-flight download per session, collapses concurrent gestures into that operation, and cancels the preflight on plugin disposal. Modal state lives in a snapshot store keyed by session, so the button and the command share one dialog per session.

The Host route is a feature-owned exact Fetch contribution. Connection applies its Host/Origin and browser-session checks and bridges the streaming `Response`; this package owns query validation, live-session flushes, handle-based log reads and attachment reads, ZIP generation, and HTTP status semantics.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the Web control to the host endpoint and the surrounding command and session surfaces.

- [dsh-client-connection](../../../Programs/Web/client/connection/README.md) — the authenticated Fetch-route carrier used by the Host endpoint.
- [Commands subsystem reference](../../../Docs/subsystems/commands.md) — the human-command registry the `/export` command registers on.
- [dsh-client-ui-commands](../../../Programs/Web/client/ui-commands/README.md) — the browser command surface that renders and acknowledges `/export`.
- [Session Query package map](../README.md) — the retrieval family this package belongs to.
- [Native active-session protocol](../../core/native-session-execution/README.md) — the exact live owner flushed before a Native archive read.

-----

<a id="model-experience"></a>
## Model Experience

### Human `/export` control

#### What the model sees

Nothing. `/export` stays on the human-command plane, and the ZIP download does not enter model history.

#### Token effect

Zero. The command creates no model turn.

#### KV Cache effect

None. The log-only command lifecycle and browser download do not change the derived request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when this package is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **Stream, not a destination writer** — Native callers choose the transport or path, and the browser chooses its download destination.
- **Web route remains Cordis-owned** — the Native service does not register or replace `/api/session.export`; Web transport migration belongs to its carrier owner.
- **Preflight reports only pre-stream failures** — a descendant or attachment failure after the browser accepts the GET is reported by the browser download manager, not by the dialog.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open design questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked pages.

#### Future: export destinations beyond the browser

The download is deliberately browser-scoped; a Host-path or native folder export would need a new endpoint contract and a decision on where the ZIP lands.

</details>

**Runtime invariant:** No companion is published. Connection and the command registry own both registrations, while each export reads authoritative Session services.
