# Agent Note: Core ownership of JSON-RPC line transport

Status: implemented

English | [中文](2026-09-23-json-rpc-line-transport-ownership.zh.md)

## Problem

The Codex app-server adapter in Engine consumed the Program-owned SDK protocol package only for newline-delimited JSON-RPC transport. That dependency made a generic byte-stream mechanism depend on an unrelated SDK method vocabulary and required a runtime-layer policy exception.

## Decision

`@deepseek-ai/dsh-json-rpc-line` in Core owns the existing transport implementation and its behavior tests. The SDK protocol re-exports the same class and error identity through its established public entry; its own source retains the SDK-specific method and payload types. The Codex adapter imports the Core transport directly, and the exact Engine-to-Program dependency exception is removed.

The transport continues to own line framing, request correlation, error responses, abort settlement, and listener release. Callers own their streams and child-process termination. No SDK method name or Codex app-server field enters the Core package.

## Alternatives considered

**Copy the transport into the Codex adapter:** Two implementations could diverge in cancellation, UTF-8 framing, and pending-request cleanup.

**Move the whole SDK protocol into Core:** Its named methods, Session events, and SDK client notifications are Program protocol concerns, not generic transport mechanics.

**Keep the layer exception:** That would preserve an avoidable Engine dependency on a Program package while the same transport is needed by both owners.

## Consequences

The SDK client and server keep their public import and one shared transport class. The Codex adapter no longer depends on the SDK protocol package. The Core `dsh-json-rpc-line` package now omits Cordis peer metadata under the P5 native package policy. This P4 move resolves a layering edge, but the package-level change alone does not prove a complete installed product closure.

## Verification

The relocated transport tests cover framing, malformed input, cancellation, errors, and closure. SDK client and server tests check the re-exported class through their normal paths; the Codex app-server tests check its direct Core import. Workspace constraints reject a renewed Engine-to-Program dependency without an exception.
