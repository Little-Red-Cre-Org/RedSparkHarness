# Agent Note: RedSpark product identity

Status: implemented

English | [中文](2026-09-13-redspark-brand.zh.md)

## Problem

The fork needs its own product identity while retaining useful upstream integration paths and attribution.

## Decision

RedSpark names the organization and future model; RedSpark Harness (SPH) names the platform. Shared Client theme aliases and brand marks cover Web and Desktop. The welcome hero uses a transparent four-frame Kitsune sprite atlas derived from the supplied reference. CSS animates breathing, blinking and waving; local React state handles greeting and pause controls without model requests. Reduced-motion preferences disable animation unless the user explicitly enables motion for the current welcome screen. Provider names continue to identify the actual API service. The README labels retained upstream resources explicitly.

## Alternatives considered

**Global identifier replacement:** renaming packages, credential references and profile paths would break existing configuration and does not improve visual identity. Those identifiers retain upstream spelling.

**Character art throughout conversations:** persistent decoration competes with code and messages. Artwork is confined to the empty welcome screen and hidden on short or narrow windows.

## Consequences

RedSpark owns product presentation while the fork preserves upstream license notices and runtime compatibility. A small flame-and-star silhouette replaces the whale; the supplied full-resolution artwork remains available as the design reference. This does not add a RedSpark model provider or change model requests.
