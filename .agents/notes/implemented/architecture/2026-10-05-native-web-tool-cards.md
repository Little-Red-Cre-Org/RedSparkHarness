# Agent Note: Native Tool cards share persisted presentation and pure Client leaves

Status: implemented

English | [中文](2026-10-05-native-web-tool-cards.zh.md)

## Problem

Native conversations need readable Tool progress, errors and result cards after cold restore. The existing card models consume persisted result metadata, but their public type imports reach compatibility Conversation and Chat declarations. Browser-only build inputs also omit dependencies needed by independently installed ESM consumers.

## Decision

Tool record types have one pure Conversation export. Compatibility re-exports preserve every consumer. The native Tool renderer reuses GenericToolCard, ToolRow, models, atoms and typed dictionaries; optional unsupported actions disappear. Native conversations pair accepted root calls and results from Session events without a second execution registry or writer. Raw facts preserve nested dispatch records.

Mixed Client packages publish explicit pure subpaths alongside their dynamic compatibility entry. Their static leaf builds preserve bare imports and emit actual stylesheet assets without classifying the entire package as statically linked. The native policy follows the complete source and public declaration graph. It admits existing Client stylesheets and resolved declared DefinitelyTyped providers, while missing assets, Host stylesheet edges and Cordis references remain invalid. Production declarations and browser imports have explicit dependencies; React instances stay shared peers.

The `./controller` ESM subpath exposes `NativeConversationController` without loading the React page installer. Host tests reference a declaration-only project for that pure source leaf; the Host aggregate does not reference the Client application project, whose installer imports React UI and `ui-tool`. The package tsdown config runs only in the Client pass, after Client tsc emits its entries. The Client aggregate still builds the application and its complete consumer graph.

## Alternatives considered

A second card implementation would duplicate metadata parsing and UI behavior. Importing compatibility Client entries would retain Cordis declaration dependencies. Converting entire packages to static assembly would change compatibility composition. No-op file or inspection callbacks would advertise unavailable actions. Root-only cards preserve this batch's narrow scope without discarding the raw nested facts.

## Consequences

The explicit native Web renderer and future Desktop composition share Tool presentation without changing product defaults. The existing browser scenario records a real filesystem read, approval rejection and cold restored cards; a focused dependency case rejects missing and Host stylesheets. A nested call hierarchy and additional Tool-specific presenters remain separate product work.
