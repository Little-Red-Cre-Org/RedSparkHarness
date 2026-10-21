# Agent Note: Avoid repeated reference processing

Status: implemented

English | [中文](2026-10-13-reference-processing-cost.zh.md)

## Problem

Session-reference retention repeatedly serialized every remaining message while discarding old messages. File completion lowercased the same query for every candidate.

## Decision

[Session retention](../../../../rsh/Engine/context/session-reference/src/projection.ts) measures the full tag-safe JSON once and updates the byte count when removing or shortening a message. Deletion still protects checkpoints and the newest message; shortening and omission statistics retain their existing semantics. [File completion](../../../../rsh/Engine/context/file-reference-local/src/search.ts) normalizes the query once before scoring candidates.

## Alternatives considered

**Repeated full serialization** directly recomputes the size but re-encodes unchanged text for every discarded message. Per-message byte differences preserve the same budget without adding a persistent cache.

## Consequences

Unchanged message text is no longer repeatedly serialized during removal. Array traversal and splicing remain; this does not promise linear total runtime. Tag escaping, UTF-8 byte limits, full snapshots and deterministic search ordering remain unchanged. Existing reference tests and three escaped-byte boundary cases verify retained output and statistics.
