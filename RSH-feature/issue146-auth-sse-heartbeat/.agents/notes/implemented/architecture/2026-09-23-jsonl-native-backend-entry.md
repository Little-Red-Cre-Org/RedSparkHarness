# Agent Note: Shared JSONL backend entry

Status: implemented

English | [中文](2026-09-23-jsonl-native-backend-entry.zh.md)

## Problem

The JSONL native Provider imported the package's Cordis plugin entry to reach `JsonlSessionBackend`. Loading that entry also loaded the legacy service adapter, and the backend's tracker owned Cordis listener registration even though native storage needs only handles and file operations.

## Decision

`backend.ts` owns the shared JSONL storage implementation and has no direct Cordis import. `native.ts` imports it directly. `index.ts` remains the legacy plugin entry and registers the three legacy Session event routes and its teardown effect; it delegates event handling to backend methods, so both entries use the same writer tracker and on-disk format. The package root continues to re-export the backend for existing consumers. Session, persistence contracts, and provider-neutral LLM helpers expose separate native entries; current-format and historical-format validation use those entries.

The Session format catalog generator imports the current event vocabulary from `dsh-session/native`. JSONL builds its legacy and native entries separately, preventing their common chunk from pulling the legacy Session service into the native entry.

The Session object accepts a store-owned publication hook. The legacy store resolves its scoped listener snapshot before a Session append commits, then publishes to those listeners after the log grows; reentrant append and detach remain deferred across that publication interval. Detached native Sessions have no hook. This keeps the existing publication timing while removing Cordis from the Session object's module.

## Alternatives considered

**Duplicate a native storage backend:** Two implementations would make released-generation migration, durability and single-writer behavior drift between profiles.

**Keep listener registration inside the tracker:** That forces the native entry's source closure to include Cordis types and places legacy application wiring inside storage bookkeeping.

## Consequences

The built JSONL native entry loads without Cordis through its current transitive JavaScript dependency graph. The mixed persistence packages retain Cordis as an optional peer for their legacy root entries; the native subpath declaration and source closure are checked separately. This package-level evidence does not replace the P5 installed-closure and independent-consumer checks.

## Verification

The JSONL package typechecks and bundles both entries. A Node module-resolution hook rejects `@deepseek-ai/cordis` while importing the built native entry successfully. The native and legacy JSONL specs pass, covering their shared storage behavior and legacy live-event routing.
