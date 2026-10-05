# Agent Note: Native terminal model controls

Status: implemented

English | [中文](2026-10-05-native-terminal-model-controls.zh.md)

## Problem

The native terminal needs model and reasoning selection without a separate catalog registry or Session writer.

## Decision

Menus consume the actual `modelDirectory` and `modelSelection` Providers. The existing root executor supplies the sole Session owner; menus reserve its Agent through exclusive idle maintenance or reuse the cold-open maintenance already admitted; each complete choice compares its observed intent revision and flushes the existing writer. The controller rejects selection while input drains, and menu cancellation drains accepted maintenance before terminal disposal.

## Alternatives considered

Embedding a model catalog would drift from configured Providers. Writing directly from Ink would bypass Session maintenance and conflict with turn execution.

## Consequences

The next turn consumes durable intent through the shared executor and logs its model-change notice. Cold restore projects the same selection. Model metadata remains advisory and Provider-owned; missing controls and catalog failures are visible. Presets, approval and policy menus remain separate Consumers.
