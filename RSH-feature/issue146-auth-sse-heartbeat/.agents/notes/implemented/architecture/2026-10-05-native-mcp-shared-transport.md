# Agent Note: Shared native MCP transport and tool projection

Status: implemented

English | [中文](2026-10-05-native-mcp-shared-transport.zh.md)

## Problem

The native tool registry needs real MCP transports, discovery and result conversion. A separate bridge would duplicate reconnect ownership and risk different raw results or image admission from the compatibility entry.

## Decision

[Native MCP](../../../../rsh/Modules/Official/mcp/mcp-client/src/native.ts) supplies selected registry, scope, model and attachment ports to the shared connection supervisor and tool core. Cordis supplies its existing services to the same implementation. The official SDK owns stdio and Streamable HTTP protocol traffic; the subprocess seam supplies credential scrubbing. Registrations belong to the installation and each accepted call retains its cancellation signal.

Image projection resolves the actual Session provider/model through the selected Model Provider, then saves an ordered batch through Attachment operations. Canonical raw MCP results remain available to program callers. The selected Program alone records accepted results and model-visible content.

## Alternatives considered

A second native protocol implementation duplicates transport cleanup and schema handling. Content-only tools lose canonical value results. A fabricated model capability lookup cannot authorize image input. These approaches do not preserve the existing producer and Consumer relationships.

## Consequences

Both entries share names, schema acceptance, reconnect policy and image diagnostics. Disposal waits for connection attempts, synchronization and tool registration drainage and reports cleanup failures. Aborted calls cannot accept a later transport result or image projection; an already accepted image preparation remains owned until it settles. No extra Model loop, Session writer or result index is introduced.

## Verification

The owning compiler and three existing cases cover canonical mixed-image values, Streamable HTTP configuration and reconnect cancellation. The keyless [MCP image scenario](../../../../snapshots/native-headless/mcp-image-native.snapshot.ts) starts `dsh` with its opt-in profile, a real stdio MCP server and the actual Pi Model Provider against controlled HTTP. Recording and read-only replay verify durable attachment bytes in the next model request, complete result ordering, prompt/schema sidecars and a cold log fixed point. This scenario does not exercise a public HTTP MCP server or reconnect recovery.
