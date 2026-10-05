# Agent Note: Native ACP Session MCP ownership

Status: implemented

English | [中文](2026-10-05-native-acp-session-mcp.zh.md)

## Problem

ACP controllers supply Session-specific stdio and HTTP servers. Installing their tools in a shared Program scope exposes them to unrelated Sessions and prevents independent server namespaces.

## Decision

The MCP Module owns one Cordis-free ACP descriptor converter used by both carriers. The converter preserves name normalization and environment/header validation; each carrier resolves its existing transport configuration and timeout explicitly.

Each native ACP Session owns a descendant scope and resource owner. The selected executor inherits that scope, while the maintained MCP connection supervisor registers tools and owns transport generations there. Validation covers the complete list before installation. Initial discovery precedes durable creation and publication; failed installation drains its connections and registrations without creating a Session. Resume verifies stored ownership before mounting the supplied declarations.

Session close and Program EOF close admission and cancel the selected executor and connections. MCP withdrawal begins during cancellation; resource release awaits cooperative drain. Cleanup failure retains the closing record, refusing resume, prompts and configuration changes. Only successful cleanup removes it; EOF reports aggregated failures. MCP diagnostics use the carrier-selected stderr logger. The executor remains the sole Session writer and records every model-visible tool schema and result.

## Alternatives considered

A second RPC client would duplicate the maintained MCP transport supervisor. Shared Program registrations would expose foreign tools and make same-name servers conflict. Connecting after publication would report a usable Session before its required tools are available.

## Consequences

The explicit native ACP profile installs the existing tools Provider. Sibling Sessions can reuse server names and release their connections independently. Compatibility defaults and historical Session generations remain unchanged. MCP resources, prompts and unsupported transports are not added.
