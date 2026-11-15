# Agent Note: Native Tool sub-call rows

Status: implemented

English | [中文](2026-11-14-native-tool-subcall-rows.zh.md)

## Problem

The `ptc-round` replay asserts a `run_code` parent, `[data-sample=bash]` inside `[data-subcalls]`, and a `[data-terminal]` that expands from that row. `NativeToolCard` rendered every root and nested call through `GenericToolCard`. That card has a Bash variant, but it does not own the compatibility toolview's `data-sample` row or its expandable inline terminal, so the seeded PTC round could not satisfy the Cordis selector.

## Decision

`BashRow` now splits into a pure `BashCard` that accepts the resolved `cwd`, plus the Cordis wrapper that reads the Session workspace through `useSessions`. `NativeToolCard` dispatches the wire name `bash` to `BashCard` and keeps `GenericToolCard` for every other tool. Nested sub-calls recurse through the same dispatcher, so a Bash child gets the terminal card at any depth.

## Alternatives considered

**Render the terminal only at the root.** The recorded Bash call is a PTC child, so a root-only card leaves the asserted row generic.

**Duplicate the Bash row inside `native-application`.** The expansion state, terminal model and copy already exist in `ui-tool`; a second copy would drift from the compatibility row and its terminal tests.

**Make `GenericToolCard` own `data-sample` and terminal expansion.** That would give every Bash variant two expansion paths and make the generic row responsible for a keyed toolview's interaction.

## Consequences

A Native `run_code` turn now shows the same nested Bash row and inline terminal as the compatibility transcript, and `web-ptc` replays on `native-web`. The pure card is shared, so terminal behavior changes land once. Tools without a Native dispatch still fall back to `GenericToolCard`, and the fallback remains the place to add the next port.
