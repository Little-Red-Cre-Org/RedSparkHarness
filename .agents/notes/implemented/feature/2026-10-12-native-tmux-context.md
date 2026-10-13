# Agent Note: Durable native tmux location context

Status: implemented

English | [中文](2026-10-12-native-tmux-context.zh.md)

## Problem

Native Headless profiles need an opt-in way to include the agent process's current tmux location in model requests while preserving one Session writer and reconstructing the same conversation after restart.

## Decision

The Official `native-tmux-context` Provider queries the selected `shell` service on the first step of a turn. It requires `TMUX_PANE` and verifies that the agent process's controlling terminal matches that pane. The query returns location metadata only; it never reads pane text.

The Cordis-free `tmux-context-definition` package declares the request and service types. Native Headless seeds and records the Provider's comparison state from its loaded and committed Session events, waits for preparation, checks cancellation, and appends any returned user message through its existing writer before model dispatch. The durable message suppresses an unchanged location after cold restore without adding a Session event type.

The shipped Native Headless profile rows remain disabled. An explicitly selected profile overlay enables the Provider and installs a shell executor in the same composition.

## Alternatives considered

**Let the Provider append Session events.** This would give the Provider a second writer and make message ordering independent of Native Headless. The application keeps sole ownership of Session append order instead.

**Enable tmux context in every Native Headless profile.** The feature needs a shell executor and contributes location data to model requests. Profiles keep the Provider opt-in and disabled by default.

**Reuse the compatibility Agent pre-step Provider.** The compatibility Provider does not implement the Native service or participate in Native Headless Session reconstruction. The Native Provider uses the selected shell and the Native application's durable writer.

## Consequences

The selected shell policy controls the read-only query. Missing tmux state, unavailable commands, or a mismatched controlling terminal contributes no location message; a query rejection emits a warning. Cancellation waits for the query to settle and prevents a late append. A tmux change during a turn appears on the next turn because preparation runs only at step one.

The [Native tmux-context Provider README](../../../../rsh/Modules/Official/terminal/native-tmux-context/README.md), [service type reference](../../../../rsh/Docs/subsystems/tmux-context.md), and [Native Headless README](../../../../rsh/Engine/core/native-headless/README.md) describe the current package and consumer behavior.
