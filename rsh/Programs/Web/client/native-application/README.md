---
description: "Native Web conversation over the selected Session authority."
kind: "package-reference"
---

# Native Web conversation

English | [中文](README.zh.md)

## Summary

This Cordis-free Client application supplies the conversation page for the explicit native-web profile. The selected renderer mounts React; client-native-session supplies authenticated Host operations.

Root Tool calls pair with their durable result, failure identity and presentation metadata and render through the shared Tool card models. Cold history uses the same projection; unavailable file-opening and trajectory actions are omitted. Nested dispatch records remain available in the raw Session disclosure rather than a separate nested card hierarchy.

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

The transcript uses the shared Session append-origin and message projection rules. Replacement copies remain model-only; raw Session records remain available in a disclosure, including tool results, permissions, interruptions and opaque ignorable facts. Transport and history failures remain visible; failed submission retains its draft.

Configuration requires positive integers maxLiveTextChars and maxLiveEvents and optionally accepts `locale: "en" | "zh"`; omission follows the browser's Chinese language preference, otherwise English. Product copy comes from the page's complete typed dictionary pair. The Settings page reads schemas published by active Settings registrations, edits user overrides as JSON with revision checks, and derives write-only credential controls from `credential-ref` fields. It edits existing array entries by index and reports unsupported array-structure changes instead of claiming success. Credential values are sent only to the Host for storage and are never read back. The page adds no durable language preference or default-profile switch.

React and Session message projection use shared application peer instances; the Session Consumer is a type-only dependency supplied by the selected runtime capability.

The native-web first-use roster selects only this application, renderer, Connection and Session Consumer; legacy defaults remain unchanged.

Pending tool approvals offer allow-once and reject actions. Question cards preserve headings, detail, choices, multiple selection and custom text. Submission failures retain the request; cancellation disables input and keeps execution busy until Host settlement. Reload restores durable decision and tool-result facts, not obsolete pending presentations.

Image uploads use the advertised attachment limits and the selected Session's next model. The renderer displays only durable image references and owns each fetch, Blob URL and unmount cleanup. Reload fetches images again from the recorded Session. Upload errors retain the input for correction.

The task-list panel reads canonical todo/write snapshots, including accepted live and restored history. It replaces the entire list and clears it only on turn/start; turn/end retains the last plan. Status copy is locale-owned and the panel offers no task mutation.

## Invariants

No invariant companion is published because the view reads the selected Host Consumer and owns no independent execution observations.

## Dev Note

Lifecycle ownership is described in the [conversation decision](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-web-conversation.md); realtime delivery and settlement are described in the [following decision](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-web-session-follow.md); Settings and Credentials presentation is described in the [native Settings decision](../../../../../.agents/notes/implemented/architecture/2026-10-06-native-web-settings-credentials.md).

## Model Experience

### Human conversation

#### What the model sees

Submitted human text and admitted image references are recorded as `user/message`. Model intent changes are durable `model/selection` facts; installed composition changes use `agent-preset/selected`. Discovery and viewing history contribute no model input.

#### Token effect

Submitted text adds ordinary user-message tokens. This application contributes no tools or prompt sections.

#### KV Cache effect

The Host owns resumed context and its existing prefix. Model and composition changes follow their owning Providers' recorded resolution and context rules.

## Known Limitations and Deferred Work

Durable events update the transcript during execution. Temporary assistant output is shown separately until a durable assistant record or settlement replaces it. maxLiveTextChars retains only the visible tail with an explicit truncation notice; maxLiveEvents rejects excessive presentation history and cancels the turn. Reload restores durable history without temporary chunks.

- The shipped native-web template has model selection but no standing preset compositions; custom profiles may install them.
- Nested Tool-call hierarchies and additional model chunk presentations remain separate work.
- File uploads, full Sidebar, layout, browser authorization flows, opaque credential grant editing and the complete legacy plugin Settings page remain separate native Client migrations.
- A Settings owner must explicitly publish its schema metadata; this page does not edit hidden `role('secret')` values or create authorization grants.
