# Agent Note: Provider-neutral native Session persistence

Status: implemented

English | [中文](2026-10-04-native-persistence-service-definition.zh.md)

## Problem

The native sessionPersistence service type belongs to JSONL's concrete backend. Replacement Providers and the supported native Headless application therefore depend on that Provider even though their operations already share the canonical handle API.

## Decision

Persistence owns NativeSessionPersistenceOperations and its NativeServices declaration. The create, open, flush, stat and list signatures retain the existing observable obligations. Its compatibility Service implements this interface. JSONL publishes its existing backend through that Definition and retains teardown ownership; Headless consumes the same Definition and owns only its selected Session handles. No Consumer receives service-wide close ownership.

Explicit @inheritdoc service methods use the implemented interface's complete documentation while retaining their authored signatures. Catalog checks still reject incomplete declaring documentation. SDK, SessionExecution and downstream domain Consumers are separate batches.

## Consequences

Replacement Providers can publish the same native service key without importing JSONL. Handle freshness, cancellation, format refusal and single-writer rules remain unchanged. JSONL paths, configuration, recovery and generations do not change. Native runtime is an ordinary Definition dependency; Cordis remains an optional compatibility peer. No deletion journal or Client compiler face is added.

## Alternatives considered

JSONL type anchors preserve accidental Provider coupling. A partial interface would omit execution operations. Duplicated method documentation separates observable obligations; exposing service close transfers Provider ownership to Consumers.

## Verification

Existing JSONL Host cases cover manifest agreement, durable write and cold restoration. Existing Headless cases cover model/tool logs, resume and admitted-stream shutdown drain. Inherited-documentation cases cover complete interfaces, missing documentation and generic signatures. Installed Cordis-deny consumption remains a separate gate.
