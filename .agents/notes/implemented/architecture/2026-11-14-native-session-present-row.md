# Agent Note: Native Session declared-file row

Status: implemented

English | [中文](2026-11-14-native-session-present-row.zh.md)

## Problem

The Cordis `present` turn tail renders `[data-presented-files-row]` from `deliverables/presented`. The Native transcript had no such row: it rendered messages and Tool cards only. The `web-ptc` replay asserts two declared files and their open and reveal actions, so the composition could not leave the Cordis inventory.

Separately, the Native browser bundler compiled workspace `.tsx` through the repository's tsconfig paths with esbuild's default classic JSX transform. A source-plane component rendered without an imported React binding crashed with `ReferenceError: React is not defined`; packages resolved from built `lib/` masked the problem because tsdown emits `react/jsx-runtime`.

## Decision

`ui-deliverables` folds each Session's successful mutation calls and `deliverables/presented` records into one entry per Turn (`foldDeliverables`). The fold lives in `src/fold-deliverables.ts`, outside the Cordis `/client` entry, so the Native dependency graph admits the Session fold without admitting the chat, conversation or Tool slot contracts. The Native transcript imports `./native`, creates one `PresentedOpenController` per transcript, and ends a Turn with the shared delivery cards.

`native-web-session-controller` registers `/api/present.host` and `/api/present.open`. Coordinates come only from the viewed Session, event sequence and original file index. The open route reads the cold Session handle without activating an Agent, re-reads the named event, requires the declared path to resolve inside the Session `cwd` (or the configured root when absent) to a regular file, maps it to a Host process path, and only then calls the Native open or reveal command. It returns 400 for malformed coordinates, 409 without a desktop, 404 for an unknown declaration or file, 422 outside the root or without a Host path, and 204 after the opener accepts.

The Native client bundle sets `jsx: 'automatic'` and `jsxImportSource: 'react'`, matching `tsconfig.base.client.json` for source-plane workspace packages.

## Alternatives considered

**Mount the Cordis deliverables plugin in `native-web`.** It is the implementation being retired and depends on Cordis chat slots; the Native transcript has no row slot.

**Open the file path sent by the browser.** That would make the browser the authority for a Host filesystem action. Re-reading the durable declaration keeps the Session log authoritative and prevents an unrecorded path from being opened.

**Activate the Agent to read the declaration.** Opening a file must not wake a cold Session or create a model request; the read handle exposes the same header and events.

**Keep classic JSX and import React in every source-plane component.** That leaves the bundle dependent on each file's import discipline and only fixes the first component that happens to render.

## Consequences

A Native Turn that declared files now shows the same names, descriptions and Open/reveal actions as the Cordis row, and the actions use durable coordinates without a live Agent. The row is deliberately narrower than the Cordis card: it has no Sidebar preview because the Native transcript has no file-preview tab. Opening remains a Host-side action and still requires the serving desktop.

The bundler now compiles every source-plane TSX input with the automatic runtime. A workspace Client package that intentionally used the classic runtime would need an explicit per-file change, but the repository's Client face already requires `react-jsx`.
