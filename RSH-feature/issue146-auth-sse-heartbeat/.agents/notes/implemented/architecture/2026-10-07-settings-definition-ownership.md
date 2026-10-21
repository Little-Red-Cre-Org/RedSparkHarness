# Agent Note: Settings Definitions stay outside Cordis, with Cordis declarations in Compatibility

Status: implemented

English | [中文](2026-10-07-settings-definition-ownership.zh.md)

## Problem

Native Settings providers and consumers need a shared service definition, while Cordis plugins need `Context.settings` and event augmentation. Keeping both contracts beside the Cordis provider makes Native packages depend on a provider-owned API and makes the Cordis framework appear in Core declarations.

## Decision

`@deepseek-ai/dsh-settings-definition` owns framework-neutral Settings types, wire types, and Native Settings interfaces. Its source imports no Cordis package. `@deepseek-ai/dsh-compat-settings-definition` owns Cordis `Context.settings`, event augmentation, and registration options. The concrete Cordis and Native implementations remain in `dsh-settings`; file storage remains in `dsh-settings-file`.

Cordis consumers import the compatibility declarations only where their Cordis entry needs them. Native declarations use the Core package. The `dsh-settings` root keeps re-exports so existing provider consumers retain their package entry point. Profile-specific Settings registration for Engine services lives in `dsh-compat-settings-adapters`; each adapter attaches from the service's original owner Context, while Engine keeps only typed source binding and its composition fallback.

## Alternatives considered

- **Keep every declaration in `dsh-settings`** — Native providers and consumers would keep depending on the package that also owns the Cordis implementation.
- **Put `Context` augmentation in Core** — Core would acquire Cordis as a source dependency and could no longer serve as the framework-neutral definition package.
- **Copy interfaces into each consumer** — providers, remotes, and clients could drift on namespace, redaction, and edit types.

## Consequences

The workspace has separate Core and Compatibility declaration packages, and source aliases, package references, dependency policy, and type-equivalence mappings name those owners. Cordis package peers stay on compatibility entries; Native definitions consume the Core Native export and do not load the Cordis declaration package.
