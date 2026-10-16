---
description: "Native Web conversation with shared chat presentation over the selected Session authority."
kind: "package-reference"
---

# Native Web conversation

English | [中文](README.zh.md)

## Summary

The `native-web` profile uses this Client page to create or resume Sessions, inspect durable history and send messages through the Host. Legacy and Native views share Cordis-free transcript, composer, onboarding, Markdown, welcome and mascot presentation from `ui-primitives`; the Native page keeps its own Session data layer and renders Tool results, failures and nested calls from Session records. Model and reasoning choices come from the Host model directory; stale selections and transport/history failures remain visible. Published declarations require the listed package dependencies, and the profile must select the runtime contributions, renderer and `client-native-session` Host operations.

## Table of Contents

- [Reference](#reference)
- [Invariants](#invariants)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Reference

The page lists stored Sessions, creates blank Sessions, selects durable history and sends human text with explicit resume. Cancellation keeps the page busy until the Host reply confirms settlement and history has refreshed. Installation disposal cancels outstanding calls and awaits their settlement before releasing the view controller. The controller holds presentation state, not a second Session writer, Agent registry or connection loop.

Consumers that need only the view-state controller can import `NativeConversationController` from `@deepseek-ai/dsh-client-native-application/controller`; this ESM entry does not load the React page installer. Its declaration uses the `client-native-session` Consumer required by the native profile.

Model and reasoning choices come from the Host model directory, including provider failures; the catalog is advisory, not an allow-list. The current recorded route remains visible when absent from discovery. If the initial model-controls request fails before a catalog is available, the picker remains openable and shows the error with its retry action, even before a Session is selected. Mutations carry the displayed durable revision, refresh history after settlement and expose stale-selection failures. Installed presets use the existing blank-root lock and epoch transition; a locked Session cannot change composition.

The transcript uses the shared Session append-origin and message projection rules. Replacement copies remain model-only; raw Session records remain available in a disclosure, including tool results, permissions, interruptions and opaque ignorable facts. Durable user text renders in the shared right-aligned bubble; non-user context uses a collapsed source row, except context from `native-time-context`, which the Native transcript omits. Assistant text uses the shared Markdown renderer, and temporary assistant text uses its streaming mode. The Native view groups visible messages and Tool-call cards by turn, including nested calls, collapses assistant reasoning, and shows copy plus available token usage, duration and event time for each assistant message. Its header reads the selected roster title, marks the fixed Chat view, and keeps the existing details action. While the reader is at the end, the view follows new events and live text; scrolling up pauses that follow until the reader returns to the end. Tool cards reuse the shared Native tool, approval and question presentations; image rendering remains Native-owned. Transport and history failures remain visible; failed submission retains its draft.

Each selected Session has a Trajectory action in the conversation header. It opens the shared ledger and timeline from the controller's current event history, including durable turns and messages. It uses no new Host operation and does not request earlier history pages.

The composer uses the shared card, toolbar, send/stop action, a model and reasoning picker, a mode selector backed by the Host's installed Agent presets, a permission selector, and an optional Plan toggle. The model picker reads the Host catalog and the selected Session's durable intent, then uses the existing selection action. The mode selector stays disabled when selection is unavailable or the first turn has locked the Session. The Plan toggle shows committed and pending state and remains usable during a turn; the permission selector appears when its Host Provider is available. Session selection and turn settlement read both control values before the final durable history snapshot; a control read may cold-open the Session and append `session/end-seed`, so the transcript is current before live follow begins. Failed mutations refresh their displayed values. The blank-session context row shows the selected Session's workspace label or a disabled placeholder. Workspace switching remains in the sidebar. The Native page does not add command completion or feedback actions.

Restoring a selected Session calls `session/attach` with the last loaded event sequence. If its Host turn is still active, the controller keeps the sending and Stop state, resumes live follow, and receives any pending approval or question. Afterwards it re-reads durable history, also when no turn is active, so a turn that settled before attach still shows its final events. Stop cancels the turn; disposing the page detaches its local feed and settlement waiter.

While this page owns a running turn, the composer accepts further text: Enter or Queue submits to the next-turn inbox, and Interject submits to the next model step. Shift+Enter inserts a newline. Pending messages come from the Host submissions snapshot and sit above the input as compact single-line previews. Right-side actions expand or collapse the full text, edit text, promote queued text to interjection, and delete the request. Drag reordering requires a Host contract and is not available. Mutations retain request identities, wait for Host acknowledgement, and refresh the inbox; failures keep the draft. Refreshes reject older event prefixes and obsolete selection responses. Turn settlement preserves text entered for a later submission. Queue and Interject currently accept text only; remove selected attachments before using them. Pending text editing is available through the row edit action; attachments disable editing; the sidebar retains its existing busy-selection restriction.

When the selected Session's loaded history contains a current goal, the composer stack shows its objective, durable phase, and admitted-round progress, including completed goals. This bar is read-only and does not display process-local activation.

Configuration requires positive integers maxLiveTextChars and maxLiveEvents and optionally accepts `locale: "en" | "zh"`; omission follows the browser's Chinese language preference, otherwise English. Product copy comes from the page's complete typed dictionary pair. General shows permission, language, appearance, content font size, transcript view, busy-send behavior and the pet toggle when their Host namespaces are available; language and theme changes apply live, and published preferences are persisted through `settingsMutate`. At shell startup, the Client reads the Host Settings description and applies published locale and `ui-theme` preferences before Settings opens; opening Settings or changing locale or theme in the sidebar while that read is pending makes its result stale, while missing namespaces or a failed read leave current service values unchanged. The composer reads `ui-conversation.busyEnter` and maps `queue`/`steer` to its `queued`/`steering` submission values. When that Host namespace is absent, one local cache uses the legacy `queue`/`steer` values. Transcript view is persisted but NativeTranscript does not consume it yet; the pet toggle is persisted but does not drive Native mascot presentation. General places JSON user overrides, schema details, credentials and refresh under collapsed Advanced settings. JSON edits retain revision checks, bounded credential reads, operation limits, redacted secrets and existing array restrictions. Credential values are sent only to the Host and are never read back. The header offers Open settings file when the Host reports a local document.

Under Subscription models, each Host authorization entry has its own row with a connection status and sign-in action; a matching account card appears inside that row. Account cards without a matching authorization entry remain in the same section. Cards show Host-projected ChatGPT plan, quota windows and credits, plus DeepSeek identity and wallet balances; a failed refresh keeps ready data with a stale hint only while the account key and non-null provider identity still match (email for ChatGPT, contact or name for DeepSeek). A successful read without an identity appears for that read only, and unavailable balances never appear as zero. Sign-out and completed authorization reload account and flow data. The page does not handle grants directly. Leaving or refreshing the page unsubscribes from frames, while only explicit Cancel stops an attempt.

The Settings button opens a centered modal with General, Task Center, Models, Plugins and Agent presets navigation. General shows legacy-like preference rows and keeps the JSON editor, credentials and refresh action under collapsed Advanced settings. Models joins the Host provider directory, settings and credential status for API model editors, and keeps authorization and account cards under Subscription models. Plugins provides staged settings cards for Shell, Agent loop, Subagent model selection and DeepSeek web search; Settings fields use revision-checked path edits, and web-search keys use write-only Credentials actions. A card whose Settings namespace the Host has not registered stays visible and says the Host has not opened that setting yet. The Plugin list tab reads Host installations with their lifecycle state; Task Center shows a localized migration placeholder. Agent presets groups built-in and custom entries into cards, reads available preset details, copies ready file-backed presets, deletes user folders, and opens or reveals their paths. The mode-selection switch writes through the Host's `agent-presets` Settings namespace when registered; ready cards can set the default only while mode selection is enabled, and both controls are disabled when the namespace is absent. Copy and delete invalidations refresh the roster. The Host remains the source of preset metadata and file operations.

React, Session, native model selection, agent preset selection, todo Client values and the native Session error class use the application's shared peer instances. Session data types remain type-only; the selected runtime capability supplies the Session Consumer. `native-runtime` remains a production dependency because published declarations reference it. `client-native-session` is a peer and development dependency because the page imports `NativeSessionRpcError` at runtime and must share its constructor with the selected Consumer.

The native-web first-use roster selects this application, renderer, Connection, Session Consumer and six optional shell installers: locale, theme, Session presentation, layout, left sidebar and right details sidebar. Its Host profile also selects the Session-title projection and first-prompt provider; legacy defaults remain unchanged.

On first launch, the application shows a versioned welcome notice and stores acknowledgement in origin-local `localStorage`. It then reads the selected Host's active and configurable model providers, Settings namespaces and credential facts; when no active provider is usable, the shared provider editor writes through `settingsMutate` and `credentialsSet`. The welcome acknowledgement uses browser-local persistence, and the model setup returns after reload until a provider is usable or the user dismisses that pass. The onboarding header keeps the native locale and theme controls available while the application root is inert.

The optional Native shell composes the shared frame, left Session navigation, right Session details, locale and theme through their declared Client capabilities. Session rows read the selected Host's durable title projection; fallback/provider generation, rename and refresh append title facts through that Host's existing Session and RootExecution authority. The Client reuses its current Native Session controller and layout stores, with no second Session store. The controller follows Host Session-list baselines and increments; the sidebar uses their activity, run, completion, subagent, and pending-interaction fields with the Host Workspace registry. Session search, archive, Workspace selection/creation/rename/deletion, and directory picking call the corresponding Native Host clients. Archiving or deleting a selected Session hides it from the sidebar and selects the next visible row, falling back to the previous row; if none remains, the selection clears. Settings stays pinned in the sidebar foot beside compact locale and theme controls.

An approval with `canAllowSession: true` offers a Session action beside allow-once and reject; the Host owns its exact reusable scope. Generic dismissal and plan discussion cancel the whole pending question batch through `cancel-questions`, leaving the turn alive. Question cards retain headings, detail, choices, multiple selection and custom text. Submission failures retain the request and re-enable controls; only the captured Session and presentation receive answer errors or release their submission lock. The Host removal frame clears the prompt. Whole-turn cancellation remains separate and waits for Host settlement. Reload attaches to an active turn and replays its still-pending presentation; completed Sessions restore durable decisions and tool results.

Image uploads use the advertised attachment limits and the selected Session's next model. The renderer displays only durable image references and owns each fetch, Blob URL and unmount cleanup. Reload fetches images again from the recorded Session. Upload errors retain the input for correction.

The task-list panel reads canonical todo/write snapshots, including accepted live and restored history. It replaces the entire list and clears it only on turn/start; turn/end retains the last plan. Status copy is locale-owned and the panel offers no task mutation.

## Invariants

No invariant companion is published because the view reads the selected Host Consumer and owns no independent execution observations.

## Dev Note

Lifecycle ownership is described in the [conversation decision](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-web-conversation.md); shared presentation ownership is described in the [chat presentation decision](../../../../../.agents/notes/implemented/architecture/2026-10-12-shared-chat-presentation.md); realtime delivery and settlement are described in the [following decision](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-web-session-follow.md); Settings and Credentials presentation is described in the [native Settings decision](../../../../../.agents/notes/implemented/architecture/2026-10-06-native-web-settings-credentials.md); provider editing and subscription rows are described in the [native Models decision](../../../../../.agents/notes/implemented/architecture/2026-10-11-native-models-settings-page.md); Agent preset details and folder operations are described in the [native Web Agent preset management decision](../../../../../.agents/notes/implemented/feature/2026-10-11-native-web-agent-preset-roster.md).

Native approval and question limits are described in the [Native human interaction decision](../../../../../.agents/notes/implemented/feature/2026-10-12-native-human-interactions.md); event projection and durable turn timing are described in the [Native Trajectory decision](../../../../../.agents/notes/implemented/bug-fix/2026-10-12-native-trajectory-turns.md).

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

- The shipped native-web template installs the Standard and Minimal Agent presets, the plan-mode Provider and the permission-preset Provider, so the mode selector, Plan toggle and permission selector are available there. On other profiles, the mode selector stays disabled without selectable presets, while the Plan toggle and permission selector appear only when their Host Providers are available. The welcome page uses the built-in mascot atlas and current turn state; it does not yet read pet preferences or custom variants.
- Additional model chunk presentations remain separate work.
- The sidebar exposes persisted Workspace and group-member ordering through up/down controls in manual grouped view; it does not expose drag or cross-Workspace Session-move gestures, additional Session search pages, or the Native Schedule task center. The current prompt path supports image attachments; broader attachment/resource management, opaque credential grant editing and settings for other plugins remain separate native Client work.
- A Settings owner must explicitly publish its schema metadata; this page does not edit hidden `role('secret')` values or create authorization grants.
