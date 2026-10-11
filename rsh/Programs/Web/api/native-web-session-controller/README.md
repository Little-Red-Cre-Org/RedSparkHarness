---
description: "Native Web Session lifecycle over shared execution and browser transport."
kind: "package-reference"
---

# Native Web Session controller

English | [中文](README.zh.md)

## Summary

This Host Program contributes authenticated Session operations to the shared Connection and uses the selected native Agent and Session executor. The Web Host remains the application.

## Table of Contents

- [Reference](#reference)
- [Invariants](#invariants)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)

<a id="reference"></a>
## Reference

Configuration includes the native headless workspace, model, prompt and budgets plus required positive integer limits: maxPendingRequests, maxHistoryEvents, maxPromptChars, maxFollowBufferBytes, maxFollowers and maxPendingHumanRequests. `maxFollowers` bounds concurrent followers on each of the Session and Workspace streams. `maxCredentialRefsPerRead` and `maxSettingsOperations` default to validated positive safe-integer limits of 64 and 512. `settings/describe` advertises both values with its namespace descriptors; the Host rejects an oversized Settings mutation before invoking the provider, preserving one revision-checked atomic write. Credential reads enforce the advertised per-request bound. History rejects overflow instead of truncating it. Ordinary requests and cancellation/status requests have separate bounded admission so a full prompt queue does not prevent cancellation.

The Client Consumer owns list, blank creation, history, explicit fresh/resumed prompts, cancellation and status. Prompt success follows durable settlement; exact execution cancellation returns exitCode 130 after draining. A Session accepts one pending browser turn. Busy submissions reject instead of silently entering another queue. Live history uses the exact active writer; cold history closes its read handle before responding. Installation teardown withdraws routes, cancels requests and drains the executor.

`session/queue` and `session/steer` accept identified text while this Program has an active browser turn. Queue appends to `next-turn`; steer appends to `next-step`; `session/dequeue` removes either identified message while it is still pending. `requestId` is reused as the durable user-message id, and `session/submissions` returns both pending inboxes. A follow stream from an observed prompt sends `submission-update` frames for accepted, rejected and settled requests. Admission errors include the request id in their details. Plain prompts still admit one pending turn.

`session/list` projects durable history and exact active owners, adds confirmed workspace membership and sorts by latest event time. A row whose history cannot be read remains visible with an unavailable title; `updatedAt` falls back to `header.createdAt`, `blank` and `completed` are false, and live running and Host-owned fields remain projected. Authenticated POST `/api/native-session/list-follow` sends `{}` then streams a baseline and coalesced upsert/remove frames. `maxFollowBufferBytes` limits nonempty baseline and upsert frame bytes: an oversized baseline is sent empty and followed by per-Session upserts, while individually oversized upserts are skipped. `session/search` accepts `{ query, cursor? }`, scans at most 100 headers and returns at most 20 title or current message matches per page. `session/archive` delegates to `workspaceRegistry.archiveSession` and returns `{ archived: true }`; without that registry it fails with `native/sessions`.

The authenticated `session/command` endpoint accepts `{ sessionId, line }` for one complete registered slash command. It requires the selected Session to be idle, revalidates the command against its exact Program root owner, and returns the shared `CommandExecution` after maintenance settles. Request cancellation is passed into the command and the Host drains it before settlement.

The controller requires `workspaceRegistry` and exposes `workspaces/list`, `workspaces/create`, `workspaces/rename`, `workspaces/delete`, `workspaces/reorder`, `workspaces/reorder-session`, `workspaces/archive-session`, `workspaces/search` and `workspaces/connect`. The authenticated POST `/api/workspaces/follow` sends a full baseline followed by Workspace upsert/remove/order and archive-set frames. Before removing a Workspace registration, `workspaces/delete` retires its idle Session owners and releases its selected runtime route; directories and Session logs remain. The native-web profile installs the Workspace registry on the shared JSON domain store and configures `workspaceRoutes`; `connect` selects only a directory admitted by that route policy and the selected sandbox policy.

The controller also exposes `directories/pick`, `directories/list` and `directories/create-directory`. The picker opens the existing Host OS folder chooser; list returns `{ path, entries, crumbs }`, and create-directory creates one child folder. Workspace failures use `native/workspaces`; directory failures use `native/directories` with generic messages.

Optional modelDirectory advertises model metadata and provider failures; modelSelection validates and records intent through the sole Session maintenance owner. Selection requests carry an exact durable revision and reject pending turns. Retained writers reserve idle Agent maintenance before directory resolution and durable selection; cold operations retain their existing maintenance admission. Optional agentPresets advertises installed compositions; rootExecution applies blank-root selection and awaits epoch cleanup. `agent-presets/list` accepts only `{}` and returns the default, ready standing compositions and scanned folder summaries; matching compositions inherit folder trust, while profile-only compositions use `profile`. Unregistered folders retain their scan status, and no Registry returns `{ default: null, presets: [] }`. Errors use `native/agent-presets`. Missing selection Providers fail explicit mutation requests rather than substituting defaults.

`agent-presets/read` returns one folder's source, status, metadata and raw `agent.native.json` text; profile-only compositions have no file content. `agent-presets/copy` copies a ready folder into `<DSH_HOME>/.agent-presets`, and `agent-presets/delete` removes user folders only. `agent-presets/can-open-directory` reports the Host opener, while `agent-presets/open-directory` opens a user folder or returns its Host-local path. Preset not-found, invalid and read-only refusals retain their `agent-preset/*` codes; other management failures use `native/agent-presets`, and opener failures use `native/agent-presets-directory`. Successful copies and deletions publish `agent-presets/updated` on the Settings event stream after the filesystem operation completes.

Deleting a folder removes its startup-loaded preset from fresh roster reads and fresh preset resolution. Sessions already using that mounted generation continue; its plugin scope remains installed until the Host reloads the profile.

Optional modelDirectory and modelSettings serve `models/providers`, `models/configurable-providers` and `models/discover`. Missing list Providers return empty lists; directory failures use `native/models-directory`, and discovery failures use `native/models-discovery` with a generic message. Discovery accepts a Settings namespace and draft request; a supplied `apiKey` is used for that request only, and upstream response bodies are not returned. POST `/api/native-session/settings-events` streams Settings document, credential-reference, model-adapter and Agent preset invalidations without values; abort closes the stream.

With Settings and modelSettings installed, this Host owns `agent-default-model`. After an account authorization settles as `authorized`, it saves the first signed-in account model only when no saved default exists and no non-account provider API key is configured through a profile reference, provider-native auth, or a stored provider key. With modelSelection selected, root Sessions use the saved provider/model only when Session history has no recorded model route; durable selections and historical request routes take precedence. The settings write publishes `settings/document-updated`, while pi-ai publishes `llm/adapters-updated` after account routes change.

Optional attachments and modelDirectory admit ordered raster uploads after resolving the effective next model inside root execution. The shared attachment Provider validates canonical encoding and batch limits; only durable references enter the user message. Authentication and complete Session history govern image reads, including inherited references. The endpoint rejects another workspace, absent references and oversized images, and returns verified raster bytes with exact media type and no-store headers. Directory policies, title and fork controls remain separate Consumers.

Optional following delivers accepted durable events and transient assistant text through authenticated POST `/api/native-session/follow`. Each admission permits one follower with its exact Session and admission identity. Turn and list followers share the `maxFollowers` limit. The unread SSE queue is byte-bounded; overflow cancels execution and fails settlement without masking an execution or cleanup failure. Disconnect releases the follower and its queue; turn ownership remains with the executor until settlement. Controller removal closes routes and accepted requests, disposes its Session executor to abort retained title-provider work, then drains follow tasks; the drain still waits for provider cleanup when that provider remains installed.

A prompt first receives its exact admission identity and then awaits settlement. Caller cancellation before sending refuses admission; later cancellation requests Host drain for that identity and the Promise finishes only after durable settlement. Pending turns and settlement readers are separately bounded by maxPendingRequests; unclaimed results continue occupying slots. Installation shutdown cancels and drains all turns.

<a id="invariants"></a>

Optional approval and userQuestions Providers receive Web answerers only for exact active root turns owned by this Program. The executor captures that exact application owner before presentation or answer; matching Session ids alone never admit another Program's request. Human presentations are transient FIFO requests per turn with a global maxPendingHumanRequests limit. Answers require the authenticated Session, admission and presentation identities; stale or cancelled answers refuse. Existing Providers and tool consumers retain decision audit and result persistence. Teardown withdraws pending input before draining execution.

Optional Settings and Credentials Providers use the same authenticated `/api` Connection carrier. `plugins/inventory` returns `{ entries }` (installation id, name, scope, state, failure step) from the optional `pluginInventory` service and fails as `native/plugin-inventory`. `settings/describe` returns `{ hasDocument, namespaces, limits }`; `settings/open-document` opens the provider's local settings document in the Host text editor and fails with `native/settings` when there is none. Namespaces are active namespaces whose owners published presentation metadata, with secret values removed and all schema defaults omitted, plus the validated request budgets. Registration rejects secret fields hidden behind unsupported schema nodes. `settings/mutate` applies visible path edits against the displayed revision, rejects secret paths, edits above maxSettingsOperations and stale writes as `native/settings-conflict`; an oversized edit is refused before any provider write. Provider exception text is replaced with generic Settings or Credentials failures; revision conflicts retain only the namespace and expected/current revisions. Credential references come from those registered schemas; `credentials/describe` returns only configured/source/writable facts and enforces maxCredentialRefsPerRead, while set and unset return acknowledgements without reading a value back.

Set `authorizationKeys` to the credential keys the page may authorize; the allowlist defaults to empty. The Host exposes `authorization/list`, `authorization/begin`, `authorization/answer`, `authorization/decline` and `authorization/cancel` over `/api`, plus POST `/api/native-session/authorization` for replayable frames. Answer, decline and cancel requests must include the current `attemptId`; frames carry no secrets, and disconnect only unsubscribes while Cancel explicitly ends an attempt.

## Invariants

No runtime invariant companion is published because this Program's turn table, admission IDs and pending human presentations coordinate HTTP requests for exact executor-owned turns; they do not copy Agent identity or durable Session state.

Runtime entry chunks use the shared-* prefix declared by the publication manifest.

The CLI carries the native Web Host, Session controller and frontend static artifact package directly. The shipped native-web Host runtime directory resolves the frontend through that exact CLI installation. The frontend package publishes static dist files without runtime dependencies; its development Cordis graph is not installed as a runtime dependency.

<a id="dev-note"></a>
## Dev Note

The native Session executor owns persistence and Agents; this package owns transport operations only. Its optional modelSelection service preserves the selected Session model when installed.

<a id="model-experience"></a>
## Model Experience

### Human input

#### What the model sees

Human text and admitted image references enter the native executor's durable inbox and normal Session model history. The selected model Provider projects those references into image inputs. This Program adds no tools or hidden prompt sections.

#### Token effect

The `prompt` text submitted to `session/prompt` contributes ordinary user-message tokens to current and later resumed requests.

#### KV Cache effect

This package does not alter the history prefix; a new user message extends the request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Full product UI, file and audio uploads are not provided by this package.
- The controller reports `hasActiveSchedule: false` for every Session row. It provides `rootExecution`, which `taskScheduler` requires, so the controller cannot depend on the scheduler without creating a load cycle.
