---
description: "Native Web conversation over the selected Session authority."
kind: "package-reference"
---

# Native Web conversation

English | [中文](README.zh.md)

## Summary

This Cordis-free Client application supplies the conversation page for the explicit native-web profile. The selected renderer mounts React; client-native-session supplies authenticated Host operations.

## Table of Contents

- [Reference](#reference)
- [Invariants](#invariants)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Reference

The page lists stored Sessions, creates blank Sessions, selects durable history and sends human text with explicit resume. Cancellation keeps the page busy until the Host reply confirms settlement and history has refreshed. Installation disposal cancels outstanding calls and awaits their settlement before releasing the view controller. The controller holds presentation state, not a second Session writer, Agent registry or connection loop.

The transcript uses the shared Session append-origin and message projection rules. Replacement copies remain model-only; raw Session records remain available in a disclosure, including tool results, permissions, interruptions and opaque ignorable facts. Transport and history failures remain visible; failed submission retains its draft.

Configuration accepts only `locale: "en" | "zh"`; omission follows the browser's Chinese language preference, otherwise English. Product copy comes from the page's complete typed dictionary pair. The page contributes no durable language preference or Settings UI.

React and Session message projection use shared application peer instances; the Session Consumer is a type-only dependency supplied by the selected runtime capability.

The native-web first-use roster selects only this application, renderer, Connection and Session Consumer; legacy defaults remain unchanged.

## Invariants

The view reads the selected Host Consumer and owns no independent execution observations, so it publishes no invariant installer.

## Dev Note

Lifecycle ownership and the distinction between durable transcript refresh and streaming are described in the [Agent Note](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-web-conversation.md).

## Model Experience

### Human conversation

#### What the model sees

Only submitted human text, recorded as `user/message`, reaches the existing Host executor. Viewing history or raw records contributes no model input.

#### Token effect

Submitted text adds ordinary user-message tokens. This application contributes no tools or prompt sections.

#### KV Cache effect

The Host owns resumed context and its existing prefix; UI selection changes no Session events.

## Known Limitations and Deferred Work

- The transcript refreshes after execution settles; live model output remains separate P4 work.
- Attachment upload, approval and question responses, full Sidebar, layout and Settings remain separate native Client migrations.
