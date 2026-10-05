# Agent Note: Native workspace instructions

Status: implemented

English | [中文](2026-10-05-native-workspace-instructions.zh.md)

## Problem

Native Programs need workspace instructions with the same discovery, precedence and durable reconciliation as the Cordis plugin. Filesystem proxy identity and entrypoint-specific message-source declarations cannot define instruction authority.

## Decision

The native instruction Provider and Cordis plugin share one composer for discovery, precedence, digest deduplication, rendering and durable reconciliation. Session user messages retain instruction text and source facts; metadata caches never become instruction authority.

The Program owns instruction reads during admitted request preparation and appends returned context before model dispatch. Persisted native tool-result observers retain paths without starting asynchronous projection work. Nested program calls propagate successful file touches to the enclosing accepted invocation; the next request performs discovery after the enclosing step settles. Installation cancellation aborts discovery through the request signal, and releasing the result observer closes touch admission.

The composer is installation-owned even when Cordis returns new filesystem proxy identities. Its selected provider remains explicit for each request. Message source contributors augment the declaring `dsh-llm/message` export, which both native and compatibility entrypoints re-export.

## Consequences

Native instruction preparation uses the sole Session writer and the selected filesystem Provider. Stored instruction sources govern cold resume, while accepted file results enable nested discovery. The native entry installs no Cordis service and owns no independent history.

## Alternatives considered

Duplicating discovery and reconciliation in the native installer would create two precedence and budget implementations. Background instruction reads would require additional cancellation and settlement owners, so the native Provider performs reads during request preparation.
