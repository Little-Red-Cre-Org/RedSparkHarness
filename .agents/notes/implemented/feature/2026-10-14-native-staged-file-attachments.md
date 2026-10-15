# Agent Note: Native staged file attachments

Status: implemented

English | [中文](2026-10-14-native-staged-file-attachments.zh.md)

## Problem

Native Web and SDK callers need to upload file bytes before a model turn and include those files in ordered initial, queued, and steered messages. The selected immutable attachment Provider already owns file bytes and `FileAttachmentRef`; client-supplied references cannot replace that Provider or bypass the durable Session message.

## Decision

The selected Program's `rootExecution.stagedFiles` stages streams through its existing attachment Provider and returns process-local receipts bound to the root route, Session id, and captured Session generation. The generation is captured before asynchronous storage reads and rechecked after each read and before publishing a receipt. Successful Session deletion, restoration, or fork-destination replacement retires receipts; detaching an idle owner does not.

Native Web transports file bytes in an authenticated streaming Fetch request. Web, TypeScript SDK, and Python SDK inputs carry ordered text, image, and staged-file parts. The exact attached root owner replaces receipts with the existing durable FileBlocks in the user message; this does not add a Session event or format version.

A reservation is released for a preparation failure or a proven refusal before `owner.enqueue` receives the message. A successful enqueue or the exact durable inbox event accepts the message and retires its receipts. A rejection after handoff without observed acceptance is uncertain and quarantines the receipts with an explicit reupload error. Durable acceptance cannot be reversed by later wake or cleanup failures.

Headless projects logged file references into model input using the selected Provider path converted by the selected filesystem to an execution-world path. Its root and captured-external built-in `read_file` Consumers and Native `tool-fs` `read` stream bytes only for references still present in the current Session's derived messages and only when the requested and projected paths resolve to the same filesystem target. Other paths outside the workspace and all writes retain the existing filesystem policy.

## Alternatives considered

**Add a receipt vault or a second Session writer.** Rejected because the selected root executor already owns route, Session-generation, and inbox admission, while the attachment Provider already owns immutable bytes and cleanup.

**Use only base64 JSON upload transport.** Rejected because the authenticated Fetch carrier can stream the request body to `stageStream` without aggregating another encoded copy.

**Allow reads from the attachment storage directory.** Rejected because directory access would grant unrelated files; current FileBlock references and resolved filesystem target identity provide the required read authority.

## Consequences

Receipts are process-local, are cleared when the Program closes, and require reupload after process restart. Receipt settlement and Program close never delete shared immutable bytes; the existing attachment Provider retains storage and garbage-collection ownership. A caller must not retry an uncertain handoff with the same receipt.

## Testing


The installed Python wheel smoke replays the canonical staged-files input through public upload, prompt, steer, builtin read, write denial, and cold runtime recovery. It compares exact returned UTF-8 contents and the model-visible handle; its deterministic keyless fixture does not establish provider-backed behavior.

The Native Headless lifecycle regression exercises receipt retention across idle detach and three controlled Session-generation races: initial stat, attachment save, and final stat while delete and same-header restoration occur. The file-read regression exercises root `tool-fs` and captured-external `read_file`, verifies the complete streamed text, and rejects unrelated outside reads and writes.
