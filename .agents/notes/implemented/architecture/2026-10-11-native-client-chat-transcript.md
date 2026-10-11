# Agent Note: Native Client Chat transcript views stay Cordis-free

Status: implemented

English | [中文](2026-10-11-native-client-chat-transcript.zh.md)

## Problem

The native Web application presented Session events as formatted records, while the legacy Chat views were coupled to Cordis-shaped snapshot and service props.

## Decision

`ui-chat` publishes a Cordis-free `./native` entry for typed, props-only Chat presentation. `AssistantMarkdown`, `ReasoningRow`, `UserMessageView`, `StatsPillsView`, `TurnNavigator`, and the native `ChatView` share Chat-owned styles and typed English and Chinese dictionaries. Legacy `MessageItem` and `StatsPills` keep their Client adapters and reuse the extracted User message and statistics views.

`ui-conversation` publishes a Cordis-free `./native` entry for its theme-backed scroll shell. The native application projects the selected Session event window to the Chat view types, uses the existing root Tool presenter, and shows live Assistant text alongside durable messages. Its statistics come from loaded event timings, recorded token usage, and the shared stream first-token helper.

## Alternatives considered

**Load the legacy Chat assembly.** Its snapshot selectors, Conversation hooks, and extension registries belong to Cordis Client composition and would make the native graph depend on legacy plugin packages.

**Copy the transcript components into the native application.** This would duplicate Chat markup, styling, locale keys, and view behavior in the package that only owns Session-to-view projection.

## Consequences

The native application declares `ui-chat`, `ui-conversation`, and `dsh-llm` runtime dependencies and reaches presentation code only through the native entries. The legacy renderers remain available through their existing Client entry and reuse the extracted views.

The native turn rail covers loaded events; Host turn-outline paging, queue presentation, nested Tool dispatch, and additional event-specific legacy rows remain outside this transcript. Focused native transcript and legacy Chat tests cover the shared rendering path, and the native dependency gate checks that its imports stay Cordis-free.
