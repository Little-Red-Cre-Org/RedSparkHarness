# Agent Note: Codex protocol and hook inventory

Status: implemented

English | [中文](2026-09-27-codex-protocol-and-hook-inventory.zh.md)

## Problem

The Codex subprocess and hook bridge consume independently evolving Codex interfaces. A pinned app-server binary needs matching request fields and real-product evidence. A hook file can also contain valid Codex events without a matching harness interception point; silently dropping those entries makes a partially active configuration appear complete.

## Decision

The Codex Provider pins the stable `@openai/codex@0.157.1` package and sends only the selected model and non-interactive permission fields to v2 `thread/start`. A keyless test starts that exact product, generates its installed protocol schema, checks the optional permission fields, and exercises the existing permission modes through the real app-server.

The hook bridge recognizes the twelve event names in Codex 0.157.1 and executes its five mapped command-hook points. It reports configured unmapped or unknown events as skipped instead of inventing a harness event. On Windows it selects `commandWindows`, then the `command_windows` alias, ahead of `command`; other platforms use `command`. Hook type, asynchronous execution, and matcher limits remain as documented by the bridge.

## Alternatives considered

**Treat every recognized event as runnable:** several Codex events have no equivalent harness lifecycle point or payload. Running them at a nearby point would change when a command executes and what it can observe.

**Drop unsupported events without diagnostics:** this leaves users unable to distinguish an inactive entry from a working hook.

**Track a prerelease or unpinned Codex build:** its app-server schema can change without a corresponding package review and real-product test.

## Consequences

The subprocess integration and hook parser use a reproducible Codex version. The bridge still runs only five events and does not claim complete Codex hook behavior. Keyless product tests verify protocol fields and selected modes; a credentialed model request remains an independent real-API check.
