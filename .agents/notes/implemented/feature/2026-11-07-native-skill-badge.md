# Agent Note: Porting a bundled skill provider to Native

Status: implemented

English | [中文](2026-11-07-native-skill-badge.zh.md)

## Problem

Diffing the Cordis web bundle's rows against the shipped Native composition left `@redspark/rsh-skill-badge` in the gap: the Cordis bundle composes it, and no Native profile did. A Native session therefore had no `dsh-badge` skill while a Cordis session did — a capability difference with no visible failure, because a catalog that lacks a skill simply lists fewer skills.

The package had no Native half at all, so this is a port rather than a composition fix.

## Decision

`src/native.ts` registers the same provider object. The provider needs no Host service beyond the registry: its candidates and body read from files that ship beside it, so the whole row is one `skills.registerProvider` call.

Two things a port of this shape has to get right, both enforced by gates rather than by review:

- A Native source may not import the Cordis package root, so the shared vocabulary comes from `@redspark/rsh-skill/shared` and `@redspark/rsh-skill/types` — the subpaths `nativeSafeSourceSubpaths` already publishes for that package. The root would have pulled the Cordis entry into the Native graph.
- `native-package-policy` classifies each package before `verify-native-dependencies` will accept its entry. A package with both halves belongs in `mixedNativeEntryDirectories` with the sentence naming what the halves share, and its Cordis peer must be `optional`, because a Native-only installation must not require the Cordis kernel.

The provider registration takes the scope the Native registry requires; the Cordis half registers without one because its `Context` already carries it.

## Alternatives considered

**Register the skill through `skills.register` with an in-memory definition.** Rejected: the body is a file that ships in `assets/`, and inlining it would either duplicate the file or lose the `resourceBase` a skill uses to resolve its own assets.

**Leave the badge Cordis-only and delete the row.** Rejected: the skill is a product capability, not a Cordis mechanism. Deleting the row would remove it from Native sessions permanently rather than porting it.

## Consequences

- A Native session lists `dsh-badge` in its skill catalog, with the same description and body the Cordis session reads.
- `tsdown.config.ts` and the `files` list now publish `lib/native.js`; without the build config the package shipped an entry the manifest advertised and the loader could not resolve.
- Coverage: the composition spec asserts the row by id, so removing it fails the Native profile test rather than silently dropping the skill.
