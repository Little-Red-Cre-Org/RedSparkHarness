# Agent Note: Optional compatibility peers in native publication

Status: implemented

English | [中文](2026-10-05-native-publication-compatibility-peers.zh.md)

## Problem

A mixed package can publish a pure native entry alongside compatibility entries. Required compatibility peers make native installations pull unrelated runtime packages even when the selected entry never imports them.

## Decision

[Fs](../../../../rsh/Modules/Official/fs/fs/README.md) declares invariants and plugin-host as optional compatibility peer dependencies. [Session](../../../../rsh/Engine/core/session/README.md) declares scope as an optional Cordis peer dependency. [LLM](../../../../rsh/Engine/llm/llm/README.md) declares typert-protocol as an optional peer and development dependency. The [subagent tool](../../../../rsh/Engine/subagent/tool-subagent/README.md) and [terminal tool](../../../../rsh/Modules/Official/terminal/tool-terminal/README.md) keep their Cordis root APIs but load their compatibility implementations only from `apply`; their native entries and facade imports do not load optional compatibility peer dependencies. [Filesystem search](../../../../rsh/Modules/Official/fs/tool-fs-search/README.md) declares output retention and timeout as runtime dependencies and the canonical errors package as a required peer dependency. [Local spill](../../../../rsh/Modules/Official/spill/spill-local/README.md) keeps the spill Definition and NativeRuntime as required peer dependencies while Cordis remains optional. Native entries do not statically load compatibility runtimes; selected compatibility entries still require their actual peers.

## Alternatives considered

Removing the peers entirely loses compatibility dependency declarations. Keeping them required installs unrelated compatibility runtimes for native consumers. Marking a real native dependency optional would hide an incomplete installation; runtime libraries and provider Definitions remain required wherever published code imports or implements them.

## Consequences

Native consumers can install the four mixed packages without Cordis through ordinary peer installation, as verified from their packed tarballs. Every statically imported native runtime package and every implemented provider Definition still needs its actual published dependency declaration. Compatibility deployments supply the optional peers required by the entries they select; the subagent and terminal facades report missing compatibility imports with the original load error as their cause.
