# Agent Note: Package group table completeness

Status: implemented

English | [中文](2026-09-13-package-group-table-check.zh.md)

## Problem

A package group can exist on disk without appearing in the bilingual package overview. Link validation cannot detect a missing link.

## Decision

The package-group check compares directory names with both overview tables and rejects missing, stale, duplicate and empty inventories. It runs in the full and quick documentation checks. The MCP group has a row in both overview tables. The [subsystem ownership check](2026-08-03-package-anchored-subsystem-pages.md) remains independent: it assigns documentation owners rather than checking overview coverage.

## Alternatives considered

**Rely on link validation:** existing links can all resolve while an entire group is absent from the overview.

**Check only one language:** one overview can omit a group while the other remains complete.

## Consequences

Group additions and removals require corresponding overview updates. Parser and comparison tests cover invalid inventories, and the gate graph test checks full documentation integration. This check validates group membership, not the accuracy of role descriptions.
