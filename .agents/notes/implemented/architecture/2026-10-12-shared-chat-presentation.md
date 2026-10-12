# Agent Note: Share chat presentation between Client compositions

Status: implemented

English | [中文](2026-10-12-shared-chat-presentation.zh.md)

## Problem

The legacy Cordis chat and Native conversation page need the same message, composer, streaming and empty-state presentation, but the Native Client cannot depend on legacy feature packages.

## Decision

`ui-primitives` owns Cordis-free chat presentation components and their token-based CSS. Legacy chat and Native conversation use the same transcript rhythm, user bubble, assistant Markdown frame, collapsed reasoning disclosure, message copy control, running-turn label, composer card and toolbar controls, welcome hero and mascot stage. `ui-chat` adapts its legacy ReasoningRow and MessageIconActions to the shared disclosure and action row. Native groups durable messages and root Tool cards by turn, and projects per-message usage, duration and time from Session events. Each composition keeps its own data projection and localized copy. Native root Tool cards and durable image renderers remain caller-owned. The conversation header reads the Native roster title and labels the fixed Chat view; the existing right-details action remains slot-owned. Native currently shows the built-in mascot atlas without pet preferences or custom variants.

The Native composer exposes only data and actions already published by its selected Host Consumer. Mode selection remains disabled until Native conversation state publishes it; the header's Chat pill identifies the fixed view and does not switch modes. This change adds no Host API.

## Alternatives considered

**Import legacy `ui-chat` or `ui-conversation` into Native.** Those feature packages carry Cordis and slot dependencies, and their data owners do not match the Native Host Consumer.

**Copy the legacy markup and CSS into Native.** This duplicates the presentation contract and lets the two Client compositions drift after the port.

**Leave Native presentation separate.** That preserves package boundaries but does not meet the shared visual behavior required by both compositions.

## Consequences

The shared package owns presentation and clipboard copy behavior without owning Session facts or Host actions. Native keeps its existing append-origin projection, model controls, approval flow, Tool cards and image loading. Features whose state or actions are not exposed by the current Native consumer remain unavailable, including mode and plan selection, trajectory navigation, message feedback, command completion and queue/steer controls.
