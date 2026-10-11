---
description: "Native Web conversation with shared chat presentation over the selected Session authority."
kind: "package-reference"
---

# Native Web conversation

English | [中文](README.zh.md)

## Summary

The `native-web` profile uses this Client page to create or resume Sessions, inspect durable history and send messages through the Host. Legacy and Native views share Cordis-free transcript, composer, Markdown, welcome and mascot presentation from `ui-primitives`; the Native page keeps its own Session data layer and renders root Tool results and failures from Session records. Nested dispatch remains available in raw history. Model and reasoning choices come from the Host model directory, while stale selections and transport or history failures remain visible. Published declarations require the listed package dependencies, and the profile must select the runtime contributions, renderer and `client-native-session` Host operations.

## Table of Contents

- [Reference](#reference)
- [Invariants](#invariants)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Reference

The page lists stored Sessions, creates blank Sessions, selects durable history and sends human text with explicit resume. Cancellation keeps the page busy until the Host reply confirms settlement and history has refreshed. Installation disposal cancels outstanding calls and awaits their settlement before releasing the view controller. The controller holds presentation state, not a second Session writer, Agent registry or connection loop.

Consumers that need only the view-state controller can import `NativeConversationController` from `@deepseek-ai/dsh-client-native-application/controller`; this ESM entry does not load the React page installer. Its declaration uses the `client-native-session` Consumer required by the native profile.

Model and reasoning choices come from the Host model directory, including provider failures; the catalog is advisory, not an allow-list. The current recorded route remains visible when absent from discovery. Mutations carry the displayed durable revision, refresh history after settlement and expose stale-selection failures. Installed presets use the existing blank-root lock and epoch transition; a locked Session cannot change composition.

The transcript uses the shared Session append-origin and message projection rules. Replacement copies remain model-only; raw Session records remain available in a disclosure, including tool results, permissions, interruptions and opaque ignorable facts. Durable user text renders in the shared right-aligned bubble; non-user context uses a collapsed source row, except context from `native-time-context`, which the Native transcript omits. Assistant text uses the shared Markdown renderer, and temporary assistant text uses its streaming mode. While the reader is at the end, the view follows new events and live text; scrolling up pauses that follow until the reader returns to the end. Existing Native root Tool and image renderers remain in place. Transport and history failures remain visible; failed submission retains its draft.

The composer uses the shared card, toolbar, send/stop action and model/reasoning/preset selectors. Its blank-session context row shows the selected Session's workspace label or a disabled placeholder, and the unavailable Mode selector stays disabled. Workspace switching remains in the sidebar. The Native page does not add command completion, plan controls, queue/steer actions or turn navigation.

Configuration requires positive integers maxLiveTextChars and maxLiveEvents and optionally accepts `locale: "en" | "zh"`; omission follows the browser's Chinese language preference, otherwise English. Product copy comes from the page's complete typed dictionary pair. The Settings page reads schemas and validated request budgets published by the selected Host, edits user overrides as JSON with revision checks, and derives write-only credential controls from `credential-ref` fields. Credential references are read in bounded batches and aggregated; edits above the advertised operation budget are refused before sending, keeping each revision-checked mutation atomic. Non-secret object entries can be added, removed, or replaced; visible edits below hidden secrets stay leaf-based, and unsafe secret-bearing structure changes are rejected. Array edits use existing indices and unsupported array-structure changes report an error. Credential values are sent only to the Host for storage and are never read back. The page adds no durable language preference or default-profile switch.

Under Subscription models, each Host authorization entry has its own row with a connection status and sign-in action; a matching account card appears inside that row. Account cards without a matching authorization entry remain in the same section. Cards show Host-projected ChatGPT plan, quota windows and credits, plus DeepSeek identity and wallet balances; a failed refresh keeps ready data with a stale hint only while the account key and non-null provider identity still match (email for ChatGPT, contact or name for DeepSeek). A successful read without an identity appears for that read only, and unavailable balances never appear as zero. Sign-out and completed authorization reload account and flow data. The page does not handle grants directly. Leaving or refreshing the page unsubscribes from frames, while only explicit Cancel stops an attempt.

The Settings button opens a centered modal with General, Task Center, Models, Plugins and Agent presets navigation. General contains the registered Settings and credential editor. Models joins the Host provider directory, settings and credential status for API model editors, and keeps authorization and account cards under Subscription models. Task Center and Plugins show localized migration placeholders. Agent presets shows each entry's source and status, reads its metadata and native composition file, copies ready folders into the Host user directory, and deletes user folders only. The Host opens a user folder when it has a desktop opener or returns the path for display; copy and delete publish invalidations that refresh the roster.

React, Session, native model selection, agent preset selection, todo Client values and the native Session error class use the application's shared peer instances. Session data types remain type-only; the selected runtime capability supplies the Session Consumer. `native-runtime` remains a production dependency because published declarations reference it. `client-native-session` is a peer and development dependency because the page imports `NativeSessionRpcError` at runtime and must share its constructor with the selected Consumer.

The native-web first-use roster selects this application, renderer, Connection, Session Consumer and six optional shell installers: locale, theme, Session presentation, layout, left sidebar and right details sidebar. Its Host profile also selects the Session-title projection and first-prompt provider; legacy defaults remain unchanged.

The optional Native shell composes the shared frame, left Session navigation, right Session details, locale and theme through their declared Client capabilities. Session rows read the selected Host's durable title projection; fallback/provider generation, rename and refresh append title facts through that Host's existing Session and RootExecution authority. The Client reuses its current Native Session controller and layout stores, with no second Session store. The controller follows Host Session-list baselines and increments; the sidebar uses their activity, run, completion, subagent, and pending-interaction fields with the Host Workspace registry. Session search, archive, Workspace selection/creation/rename/deletion, and directory picking call the corresponding Native Host clients. Settings stays pinned in the sidebar foot beside compact locale and theme controls.

Pending tool approvals offer allow-once and reject actions. Question cards preserve headings, detail, choices, multiple selection and custom text. Submission failures retain the request; cancellation disables input and keeps execution busy until Host settlement. Reload restores durable decision and tool-result facts, not obsolete pending presentations.

Image uploads use the advertised attachment limits and the selected Session's next model. The renderer displays only durable image references and owns each fetch, Blob URL and unmount cleanup. Reload fetches images again from the recorded Session. Upload errors retain the input for correction.

The task-list panel reads canonical todo/write snapshots, including accepted live and restored history. It replaces the entire list and clears it only on turn/start; turn/end retains the last plan. Status copy is locale-owned and the panel offers no task mutation.

## Invariants

No invariant companion is published because the view reads the selected Host Consumer and owns no independent execution observations.

## Dev Note

Lifecycle ownership is described in the [conversation decision](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-web-conversation.md); shared presentation ownership is described in the [chat presentation decision](../../../../../.agents/notes/implemented/architecture/2026-10-12-shared-chat-presentation.md); realtime delivery and settlement are described in the [following decision](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-web-session-follow.md); Settings and Credentials presentation is described in the [native Settings decision](../../../../../.agents/notes/implemented/architecture/2026-10-06-native-web-settings-credentials.md); provider editing and subscription rows are described in the [native Models decision](../../../../../.agents/notes/implemented/architecture/2026-10-11-native-models-settings-page.md); Agent preset details and folder operations are described in the [native Web Agent preset management decision](../../../../../.agents/notes/implemented/feature/2026-10-11-native-web-agent-preset-roster.md).

## Model Experience

### Human conversation

#### What the model sees

Submitted human text and admitted image references are recorded as `user/message`. Model intent changes are durable `model/selection` facts; installed composition changes use `agent-preset/selected`. Discovery and viewing history contribute no model input.

#### Token effect

Submitted text adds ordinary user-message tokens. This application contributes no tools or prompt sections.

#### KV Cache effect

The Host owns resumed context and its existing prefix. Model and composition changes follow their owning Providers' recorded resolution and context rules.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Durable events update the transcript during execution. Temporary assistant output is shown in the shared streaming Markdown frame until a durable assistant record or settlement replaces it. maxLiveTextChars retains only the visible tail with an explicit truncation notice; maxLiveEvents rejects excessive presentation history and cancels the turn. Reload restores durable history without temporary chunks.

- The shipped native-web template has model selection but no standing preset compositions; custom profiles may install them. The welcome page uses the built-in mascot atlas and current turn state; it does not yet read pet preferences or custom variants.
- Nested Tool-call hierarchies and additional model chunk presentations remain separate work.
- The sidebar does not expose Workspace reorder or Session-move gestures, additional Session search pages, or the Native Schedule task center. The current prompt path supports image attachments; broader attachment/resource management, opaque credential grant editing, plugin Settings pages beyond API Models and the Models onboarding dialogs remain separate native Client work.
- A Settings owner must explicitly publish its schema metadata; this page does not edit hidden `role('secret')` values or create authorization grants.
