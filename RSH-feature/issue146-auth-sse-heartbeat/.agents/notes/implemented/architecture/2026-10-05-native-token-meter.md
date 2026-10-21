# Agent Note: Shared native token metering

Status: implemented

English | [中文](2026-10-05-native-token-meter.zh.md)

## Problem

Native Programs need the maintained Session replay measurement without loading the Cordis Service or creating another estimator. The native executor prepares provider-owned capacity but must record it before consumers can reconstruct context occupancy.

## Decision

Both installers delegate to one replay core, preserving usage anchoring, header comparison, signed surface differences, immutable snapshots and per-Session ownership. The Cordis Service retains its projection registrations and exact file-text callback. The native Provider reads the selected model's existing image pricing; absent pricing and native file projection remain explicitly estimated. Measurement metadata distinguishes usage, estimated and empty baselines.

The original executor writer records capacity from the same prepared model generation used by dispatch. Route or capacity changes append the existing request-context event; unknown capacity replaces the previous value. Released Session formats and committed generations remain unchanged.

## Alternatives considered

A second native estimator would diverge from existing surface replacement and provider anchoring semantics. Resolving another catalog for capacity could pair metadata from one generation with dispatch from another. Synthetic file projection or token counts would misrepresent unavailable capabilities.

## Consequences

The native installer is explicit and creates no writer or model request. Compatibility defaults remain unchanged. ACP context-usage delivery is a separate Consumer integration over this service and the actual root owner.
