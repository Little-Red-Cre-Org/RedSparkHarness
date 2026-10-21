# Agent Note: Native Session details use observed facts and optional workspace files

Status: implemented

English | [中文](2026-10-12-native-session-details.zh.md)

## Problem

Native Session details live beside the legacy Cordis Sidebar but use a separate composition. Session roster and history expose conversation facts, while workspace access comes from the optional `clientNativeWorkspaceFiles` service; Native must not import Cordis tabs or imply file access when that service is absent.

## Decision

The Native entry in `ui-sidebar-right` presents Overview from the selected Session header and roster, and Activity from `NativeSessionClient.history()`: durable turns, user and assistant messages, tool calls, recorded token usage, latest request route, and context window. Counts cover only the history returned by the Host.

When `clientNativeWorkspaceFiles` is registered, the same panel adds Files and Preview. Files lists workspace-relative directories on demand; clicking a file selects it for Preview. Text pages use `read`; complete HTML, image, and PDF content uses `readAll`; directly declared relative HTML scripts and stylesheets use `readRelated` and run in an opaque `sandbox="allow-scripts"` iframe. `follow` refreshes expanded directories. Preview reads own their pagination and the identities of the main file and successfully loaded HTML dependencies. Changed versions or removals invalidate that read; unrelated paths and matching versions retain the displayed pages. Observations that arrive before a read response are compared with its actual absolute path and version before publication, so an older response cannot hide a newer observation. A failed read has no returned identity, so a subsequent present-file observation outside the known identities retries the failed preview. Absence observations and matching known versions do not cause that recovery retry. The failure path checks observations received before rejection using the same recovery condition as the live follow handler, before clearing the pending observations. A successful preview continues to filter by the known paths and versions. Reopening a directory refreshes its listing, and text pagination uses line counts to preserve empty pages. `ui-primitives` owns the props-only tree rows and code, Markdown, HTML, image, and loading presentations shared by Native and the legacy adapters.

## Alternatives considered

- **Require workspace files for the whole panel:** rejected because Session overview and activity remain useful in compositions without the optional file service.
- **Import the legacy Cordis tree and preview plugins:** rejected because those entries depend on Cordis registration, Remote slots, and resource providers that Native does not install.
- **Use the model catalog as the current Session route:** rejected because it advertises available choices; durable `request/header` events record the route used by the Session.

- **Refresh the preview for every workspace observation:** rejected because unrelated files discard pagination and observations from reads of the same version can trigger repeated reloads. The panel tracks identities returned by its active reads, including the admitted HTML dependencies.

## Consequences

Native Session details expose workspace files only when the Host composition provides the optional service. The views remain read-only and do not change the Session event format. Text is paged; complete files are limited by the Host's file-size cap. HTML receives only its bounded, directly declared static assets; no file-reading callback enters the iframe.

## Verification

The file panel owner tests cover empty pages, directory reopening, unrelated and same-version observations, obsolete pagination success and failure, a newer observation arriving before the first read response, a changed HTML dependency after packing, and an initially missing dependency created after the failed pack. The initial-read and loaded-dependency review probes fail on the initial P2 repair and pass with response-time observation checks and dependency tracking. A separate fixture parameter fails on the later cloud checkpoint when its first dependency read rejects, then passes with observation-triggered failed-read recovery. Its delayed-rejection parameter also places the creation observation before the failure response; it fails on the earlier recovery checkpoint and passes when the failure path checks buffered observations. These tests use the existing component fixture and do not claim a real-browser replay.
