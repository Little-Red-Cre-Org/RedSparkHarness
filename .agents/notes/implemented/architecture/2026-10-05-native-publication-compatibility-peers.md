# Agent Note: Optional compatibility peers in native publication

Status: implemented

English | [中文](2026-10-05-native-publication-compatibility-peers.zh.md)

## Problem

A mixed package can publish a pure native entry alongside compatibility entries. Required compatibility peers make native installations pull unrelated runtime packages even when the selected entry never imports them.

## Decision

[Fs](../../../../rsh/Modules/Official/fs/fs/README.md) declares invariants and plugin-host as optional compatibility peers. [Session](../../../../rsh/Engine/core/session/README.md) declares scope as an optional Cordis peer. [LLM](../../../../rsh/Engine/llm/llm/README.md) declares typert-protocol as an optional peer and development dependency. Their pure native entries do not statically load these compatibility runtimes. Selected compatibility entries still require their actual peers.

## Alternatives considered

Removing the peers entirely loses compatibility dependency declarations. Keeping them required installs unrelated compatibility runtimes for native consumers. Marking a real native dependency optional would hide an incomplete installation; this decision applies only to the identified compatibility imports.

## Consequences

Native runtime dependencies remain unchanged. Every statically imported native runtime package still needs its actual published dependency declaration. Compatibility deployments supply the peers required by the entries they select.
