# Agent Note: Native ACP one-shot permissions

Status: implemented

English | [中文](2026-10-05-native-acp-permissions.zh.md)

## Problem

ACP automation clients need the compatibility carrier's one-shot permission channel without replacing native approval policy or Session audit ownership.

## Decision

The native carrier answers the selected approval Provider only for its executor's exact root Agent and Session references. Committed tool updates precede the standard permission request. Only the advertised allow-once value permits execution; the executor remains the sole audit writer.

The protocol library cancels outgoing requests cooperatively. Pending permission requests belong to the connection, remain bounded across Session close and resume, and drain after a peer response or connection shutdown. Captured ownership and cancellation are rechecked before interpreting a response.

## Alternatives considered

Creating another permission registry or Session writer would duplicate native authority. Closing the whole connection for one cancelled permission would interrupt unrelated Sessions. Dropping unresolved wire requests would hide outstanding work and permit accumulation.

## Consequences

The explicitly selected native ACP profile supplies the existing approval Provider and preserves compatibility defaults. MCP connections, question elicitation and permission presets remain separate capabilities.
