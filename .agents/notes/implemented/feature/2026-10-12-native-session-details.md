# Agent Note: Native Session details use observed facts and optional workspace files

Status: implemented

English | [中文](2026-10-12-native-session-details.zh.md)

## Problem

Native Session details live beside the legacy Cordis Sidebar but use a separate composition. Session roster and history expose conversation facts, while workspace access comes from the optional `clientNativeWorkspaceFiles` service; Native must not import Cordis tabs or imply file access when that service is absent.

## Decision

The Native entry in `ui-sidebar-right` presents Overview from the selected Session header and roster, and Activity from `NativeSessionClient.history()`: durable turns, user and assistant messages, tool calls, recorded token usage, latest request route, and context window. Counts cover only the history returned by the Host.

When `clientNativeWorkspaceFiles` is registered, the same panel adds Files and Preview. Files lists workspace-relative directories on demand; clicking a file selects it for Preview. Text pages use `read`; complete HTML, image, and PDF content uses `readAll`; directly declared relative HTML scripts and stylesheets use `readRelated` and run in an opaque `sandbox="allow-scripts"` iframe. `follow` refreshes expanded directories and the selected preview after changes. `ui-primitives` owns the props-only tree rows and code, Markdown, HTML, image, and loading presentations shared by Native and the legacy adapters.

## Alternatives considered

- **Require workspace files for the whole panel:** rejected because Session overview and activity remain useful in compositions without the optional file service.
- **Import the legacy Cordis tree and preview plugins:** rejected because those entries depend on Cordis registration, Remote slots, and resource providers that Native does not install.
- **Use the model catalog as the current Session route:** rejected because it advertises available choices; durable `request/header` events record the route used by the Session.

## Consequences

Native Session details expose workspace files only when the Host composition provides the optional service. The views remain read-only and do not change the Session event format. Text is paged; complete files are limited by the Host's file-size cap. HTML receives only its bounded, directly declared static assets; no file-reading callback enters the iframe.
