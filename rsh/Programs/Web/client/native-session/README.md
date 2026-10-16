---
description: "Native Web Session lifecycle over shared execution and browser transport."
kind: "package-reference"
---

# Native browser Sessions

English | [中文](README.zh.md)

## Summary

This Cordis-free Client Consumer exposes the native Web Session lifecycle through the selected Connection RPC Provider.

The native profile selects this package through its `dsh.native` row and `./native` export; the legacy `dsh.client` module table does not load it. Production dependencies include packages referenced by the published declarations, but installing those packages does not activate their NativePlugins. The profile must still select the required Connection Provider; the package-selection and declaration-dependency decision is recorded in the [installation note](../../../../../.agents/notes/implemented/architecture/2026-10-06-native-web-profile-installation.md).

## Table of Contents

- [Reference](#reference)
- [Invariants](#invariants)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)

<a id="reference"></a>
## Reference

Select after client-connection in the native profile and configure a positive integer maxFollowBufferChars, limiting the SSE parser buffer. The clientNativeSession service supports list, create, history, prompt, attach, cancel and status. A prompt requires an explicit resume boolean; attach resumes an active turn from the caller's last durable sequence and replays its pending human presentation. Both await Host settlement. The prompt or attach turn signal explicitly cancels execution; the detach signal stops local follow and settlement waiting without cancelling the Host turn. Host errors reject; decoded results validate their endpoint fields before reaching Consumers. The Consumer keeps no second Session cache or connection loop.

The `./list-types` export contains the neutral Host/Client wire row for stored Sessions. Its title projection stays beside the unchanged Session header and distinguishes resolved, absent and unavailable reads; the Host supplies it from durable title events.

`list()` returns these rows ordered by `updatedAt` descending, including blank, running, completed, pending-interaction, direct-child count, confirmed workspace and schedule fields. `follow(signal)` yields a complete baseline followed by coalesced upsert and removal frames over the authenticated Fetch carrier. Aborting `signal` ends the follow and releases `close()` even while the consumer is paused at a yielded frame. `search(query, cursor?, signal?)` returns bounded title or current-message matches with optional snippets and a continuation cursor; `archive(sessionId, signal?)` archives through the Host Workspace registry.

`executeCommand(sessionId, line, signal?)` sends one complete slash-command line through the authenticated `session/command` RPC and returns its `CommandExecution`. The Host owns command lookup, idle-Session checks and dispatch on the exact root owner; cancellation waits for Host settlement. The Client adds no second command registry or execution path.

`commands(sessionId, signal?)` reads the selected Session's command descriptors through `session/commands`, including each command's optional input hint and attachment support. The Client validates the Host response and keeps no command catalog cache.

Model controls decode the selected Host catalog and installed preset metadata. Model and preset mutations require the displayed durable revision and resolve after Host maintenance settles. A catalog does not restrict explicit model routes; the model Provider validates resolution. These methods own no selection cache.

`modeControls(sessionId, signal?)` reads the current agent preset, installed choices, durable revision and blank-session lock. Mode changes use `selectPreset` with that revision. The same reply includes plan-mode availability and current or pending state; `selectPlanMode(sessionId, active, signal?)` returns the Host state machine's `committed`, `queued`, `cancelled` or `noop` outcome.

`permissionControls(sessionId, signal?)` returns the effective standing policy and configured choices. `selectPermissionPreset(sessionId, preset, signal?)` persists that choice through the Host's exact Session owner; it does not answer pending one-shot approval requests. Without a permission Provider, the read returns `available: false`, `currentValue: null` and no choices.

`agentPresetsList(signal?)` calls `agent-presets/list` and validates the Host's `{ default, presets }` response. It includes profile-only standing compositions and scanned native folders; `source` is `system` or `user` when a folder supplies trust and `profile` otherwise. Without a Registry, the Host returns `default: null` and an empty list.

`agentPresetRead(id, signal?)` returns the preset source, status, metadata and raw native composition text; profile-only rows have no file content. `agentPresetCopy(from, id, name?, signal?)` copies a file-backed preset into the Host user directory, and `agentPresetDelete(id, signal?)` removes only user presets. `agentPresetsCanOpenDirectory(signal?)` reports Host opener availability; `agentPresetOpenDirectory(id, signal?)` opens a user folder or returns the Host-local path. All five methods preserve the Host's refusal code through `NativeSessionRpcError`.

The optional prompt observer follows accepted durable events and transient assistant text through the selected Connection Fetch response. The maintained eventsource-parser handles SSE framing. Event decoding uses the shared Session parser; missing terminal settlement, malformed frames or observer failure cancel the exact admission and await Host drain before rejection. Caller cancellation detaches following and still awaits durable settlement. A custom RPC carrier without response support rejects observed prompts before admission.

`answerHuman(sessionId, id, { kind: 'cancel-questions' })` cancels only that pending question through the existing `session/answer-human` RPC. The Host checks the authenticated Session, current admission, root owner and presentation before rejecting its Provider wait with `ASK_CANCELLED`. The tool error reaches the next model step without cancelling the turn; other pending questions remain answerable. Duplicate or late answers reject.

The same Consumer exposes `settingsDescribe`, revision-checked `settingsMutate`, `credentialsDescribe`, `credentialsSet` and `credentialsUnset` on the selected `/api` carrier. `settingsOpenDocument` opens the Host's local settings document when `settingsDescribe` reports `hasDocument`. `pluginInventoryList` reads the Host's installations for the Plugins page, and `modelCatalog` returns the Host model catalog (or null) from `session/model-controls`. `settingsDescribe` returns the published namespace descriptors with request budgets supplied by the selected Host. The Settings page uses `maxCredentialRefsPerRead` for bounded credential batches and aggregates the results; it refuses edits above `maxSettingsOperations` before sending a mutation, because one revision-checked write stays atomic. The Host defaults these validated limits to 64 refs and 512 operations. Credential reads contain only presence, source and writability facts, and credential writes return acknowledgements without echoing their values. `NativeSessionRpcError` retains the Host code and conflict details for stale-write handling.

`modelsListProviders`, `modelsListConfigurableProviders` and `modelsDiscover` expose the Host's live routes, configurable-provider diagnostics and draft discovery. `NativeModelDiscoveryRequest.apiKey` is sent for one discovery request; Host failures reject with `NativeSessionRpcError`. `settingsEvents(signal)` streams `settings/document-updated`, `credentials/reference-updated`, `llm/adapters-updated`, `agent-presets/updated` and `accounts/changed` notifications without values, and abort ends iteration cleanly.

```ts type-equiv
/** Native preset metadata and optional raw composition file returned by the Host. */
interface NativeAgentPresetDocument {
  /** Preset id. */
  readonly id: string
  /** Profile-only, shipped or user-authored source. */
  readonly source: 'profile' | 'system' | 'user'
  /** Composition file status. */
  readonly status: 'ready' | 'needs-migration' | 'invalid'
  /** Display name. */
  readonly name: string
  /** Optional display description. */
  readonly description?: string
  /** Raw `agent.native.json` text when the folder has a composition file. */
  readonly content?: string
  /** Short reason when the folder cannot be installed. */
  readonly problem?: string
}
```

```ts type-equiv
/** Notification-only event that tells Settings pages which view to reread. */
type NativeSettingsEvent =
  | { readonly type: 'settings/document-updated'; readonly namespace: string; readonly revision: number }
  | { readonly type: 'credentials/reference-updated'; readonly ref: string }
  | { readonly type: 'llm/adapters-updated' }
  | { readonly type: 'agent-presets/updated' }
  | { readonly type: 'accounts/changed'; readonly key: string }
```

Authorization methods list safe flow metadata, begin an attempt, stream replayable secret-free frames from the authorization Fetch route, and answer, decline or cancel by the current attempt identity.

Account methods list safe Host-projected identities, read provider usage and sign out by account key. Identity email, name and avatar URL are nullable; usage distinguishes ready, signed-out, failed and unsupported results. OpenAI Codex returns `USAGE_PENDING` until a model call reports limits, then returns the grant email, nullable plan, quota windows and optional credits; these snapshots exist only in Host memory and are isolated by the saved grant issuer and subject. Account responses contain no credential values.

The same Cordis-free installation provides `clientNativeWorkspace` and `clientNativeDirectoryPicker`. Workspace methods expose `list()` as `{ workspaces, archivedSessionIds }`, `follow(signal)` as a baseline followed by upsert/remove/order/archive frames, and create, rename, registration-only delete, reorder, session reorder, archive, case-insensitive title/path search and `connectWorkspace`. Create and connect accept an optional `trust` flag; Host RPC errors retain their code and details for the trust confirmation flow. Delete releases the Workspace's idle runtime route while retaining its directory and Session logs. Connection reuses an unarchived member Session with a matching Workspace `cwd` that has not started a turn (or recorded a scheduler notice), otherwise it creates and attaches a blank Session. Directory methods expose the Host OS chooser, one-level `{ path, entries, crumbs }` browsing and single-child directory creation. Host integrations import these serializable Workspace and directory types from the `workspaces` entry.

The `clientNativeSchedule` service exposes `list()` and `follow(signal)` for active, paused, and failed task rows. Its complete baseline and later upsert/remove frames contain schedule metadata without prompts or execution configuration; Host failures retain the `native/schedules` code.

The `clientNativeWorkspaceFiles` service exposes `list(sessionId, path, signal?)`, `stat(sessionId, path, signal?)`, `follow(sessionId, signal)`, `read(sessionId, path, range, signal?)`, `readAll(sessionId, path, signal?)` and `readRelated(sessionId, path, relativePath, signal?)`. Paths are relative to that Session's workspace; `relativePath` starts from the base file's directory. Listings return `{ path, entries, truncated }`; stat returns `{ absolutePath, version, bytes? }`; text pages add `{ offset, text, lines, eof }`; complete reads add `{ offset: 0, data, eof: true }` with base64 bytes. `follow` yields a `ready` frame followed by `change` frames from the Host's instrumented filesystem observations; aborting its signal ends the stream. These methods use the shared `@deepseek-ai/dsh-api-workspace-files/native-types` response types.

```ts type-equiv
/** Settings views and the Host-validated request budgets used by the Client. */
interface NativeSettingsDescription {
  /** Whether the Host has a local settings document `settingsOpenDocument` can open. */
  readonly hasDocument: boolean
  /** Registered, redacted Settings namespaces. */
  readonly namespaces: readonly NativeSettingsDescriptor[]
  /** Per-request limits enforced by the selected Host. */
  readonly limits: {
    /** Maximum credential refs accepted by one read request. */
    readonly maxCredentialRefsPerRead: number
    /** Maximum operations accepted by one atomic Settings mutation. */
    readonly maxSettingsOperations: number
  }
}
```

`uploadFile(sessionId, file, signal?)` streams bytes to the Host and returns a process-local receipt. Initial prompts and `queueContent`/`steerContent` can place those receipts among ordered text and encoded images; the Host admits images under its root owner and retires file receipts after durable admission. Advertised image limits come from the selected attachment Provider. Image reads send only a Session identity and recorded attachment identity, then validate response media type and byte length before returning a Blob.

`close()` detaches the Client's owned prompts and follows, aborts its uploads, and waits for those calls to settle; native installation teardown awaits this operation.

The published declarations reference native-runtime, client-connection, native-model-selection, agent-presets, workspace-files and brand, so those packages are production dependencies for type resolution. The shared Session package remains a peer because event validation and format interpretation use the application's same Session implementation.

A prompt first receives its exact admission identity and then awaits settlement. Caller cancellation before sending refuses admission; its turn signal later requests Host drain for that identity. A detach signal stops the local waiter while Host execution continues. After a disconnected turn settles, its abandoned result is retired and the next prompt can be admitted. Pending turns and settlement readers are separately bounded by maxPendingRequests. Installation shutdown detaches Client waiters; Host turns continue until normal settlement or explicit cancellation.

`queue(sessionId, prompt, requestId, signal?)` and `steer(...)` submit text to `next-turn` and `next-step` only while this Client's root turn is active. `queueContent(sessionId, content, requestId, signal?)` and `steerContent(...)` accept ordered text, encoded image and staged-file receipt parts for those same inboxes. `dequeue(sessionId, requestId)` removes a still-pending request from either inbox. `submissions(sessionId, signal?)` returns `{ throughSeq, submissions }` with full durable pending messages. `editSubmission(sessionId, requestId, text, signal?)` replaces the message's complete content with text while retaining its identity and position through the exact root owner, including idle maintenance. `promoteSubmission(sessionId, requestId, signal?)` moves queued input to `next-step` and requires an active browser turn. Their results distinguish `updated`/`stale` and `promoted`/`stale`/`not-promotable`. `nativeSubmissionRequestId(value)` brands a caller-generated id, which becomes the durable user-message id. Queue and steer resolve after durable admission; refusal rejects with `NativeSessionRpcError` details containing `requestId`. When `prompt` uses an observer, its follow callback receives accepted, rejected and settled `submission-update` frames keyed by the same id.

<a id="invariants"></a>

Following also carries transient approvals and question batches. answerHuman uses only this Consumer’s outstanding admission identity; the Host validates the pending root owner and input. Approval verdicts are one-shot allow or reject. Question answers preserve selected labels and custom text. These presentations do not become a second durable log.

## Invariants

No runtime invariant companion is published because the Client's per-session admission map and pending Promises correlate transport calls, cancellation and human answers with the exact Host admission; durable Session events and writer identity remain Host-owned, so the Client holds no second Session projection.

<a id="dev-note"></a>
## Dev Note

The native Session executor owns persistence and Agents; this package owns transport operations only.

<a id="model-experience"></a>
## Model Experience

### Human input

#### What the model sees

Submitted human text, admitted durable image references and staged file blocks reach the Host executor; its attachment-aware `read_file` tools expose uploaded bytes to the model.

#### Token effect

The `prompt` text submitted to `session/prompt` contributes ordinary user-message tokens to current and later resumed requests.

#### KV Cache effect

This package does not alter the history prefix; a new user message extends the request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Full product UI and audio uploads are not provided by this package; file uploads are available through typed Client operations.
- The Host can report active schedules only for an attached root owner; cold Session rows report `hasActiveSchedule: false` because the scheduler list is owner-scoped.
