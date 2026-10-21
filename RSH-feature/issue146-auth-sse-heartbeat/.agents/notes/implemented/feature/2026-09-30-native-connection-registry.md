# Agent Note: Native Connection registry

Status: implemented

English | [中文](2026-09-30-native-connection-registry.zh.md)

## Problem

Native Web and Desktop carriers needed the existing Connection authentication, RPC envelope validation, exact Fetch route selection, and route ownership without importing Cordis Host services.

## Decision

`@deepseek-ai/dsh-client-connection` now keeps route selection, RPC decoding, and browser trust in `HostConnectionRegistry`. The Cordis `HostConnectionService` supplies its existing WebServer adapter through that registry, while `./native-host` exposes a Cordis-free registry factory for a native carrier to mount with its own lifetime and transport.

## Alternatives considered

Keeping the registry inside the Cordis Service would force native carriers to recreate authentication and RPC validation. Copying the HTTP adapter into each native Host would create divergent route and cleanup behavior, so the shared registry owns only carrier-neutral dispatch and leaves physical mounting to the selected Host.

## Evidence

- Host and Client TypeScript faces compile with the shared registry and native-host factory.
- Existing Cordis Connection route and node bridge tests pass unchanged.
- Native registry tests cover configuration rejection, RPC mounting and disposal, endpoint dispatch, and the shared 403/401 trust fence.

## Consequences

Native carriers own physical route mounting and cleanup; the Connection package owns one authentication and RPC dispatch implementation. The native factory does not select a transport or silently create an HTTP server, so a Host must provide an explicit carrier before exposing routes.
