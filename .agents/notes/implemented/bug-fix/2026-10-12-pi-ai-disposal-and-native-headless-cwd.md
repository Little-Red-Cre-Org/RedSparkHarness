# Agent Note: native profile defaults resolve and pi-ai drains close work

Status: implemented

English | [中文](2026-10-12-pi-ai-disposal-and-native-headless-cwd.zh.md)

## Problem

`PiAiAdapter.dispose()` could reject on a Native Responses close error while an accepted credential refresh remained pending. The ordinary `native-headless` template also omitted the application `cwd`. Native headless, query, TUI, and Web session-controller defaults named `deepseek-v4-flash`, which the installed pi-ai DeepSeek catalog did not resolve.

## Decision

The pi-ai adapter exposes `nativeResponses` on prepared Codex calls; the Engine/gateway consumer remains unconnected. Disposal aborts catalog refreshes, drains accepted credential resolutions and active Native Responses transport closes, and reports the first close failure after both work groups settle. The `native-headless`, `native-headless-query`, `native-tui`, and Web session-controller defaults now use the catalog-resolvable `deepseek/deepseek-flash`; the native ACP provider remains explicitly `deepseek-official`. The `native-headless` and query templates record `process.cwd()` as application `cwd`; TUI keeps its existing `cwd` behavior.

## Alternatives considered

**Report a transport close error as soon as that group settles.** This returns from disposal while accepted credential refreshes are still writing rotated credentials.

**Keep `deepseek-v4-flash` or add an implicit alias.** The installed catalog does not resolve that id, and an alias would hide the template's stale model choice.

**Leave `cwd` implicit or route ordinary headless users through the query profile.** The headless application needs the invoking directory in its config; the query profile adds a separate SQLite provider and tools.

## Consequences

Newly initialized shipped native profiles select a model present in their installed pi-ai catalog; existing profiles are not migrated and defaults are not changed by fallback. Native headless binds its application workspace root to the invoking directory without enabling query tools. Disposal retains its close failure signal while waiting for credential persistence.

## Validation

The CLI template test resolves the ordinary headless, query, and Web session-controller defaults through the public `PiAiAdapter.resolveModel` method and the installed catalog. Native headless snapshot drivers replace the shipped `app` route with a fixture route before invocation (`snapshots/native-headless/goal-continuation.snapshot.ts`, `snapshots/native-headless/native-headless.snapshot.ts`); Web and Desktop Session snapshot drivers likewise override the session-controller route (`snapshots/web/native-session-core.snapshot.ts`, `snapshots/desktop/native-session-core.snapshot.ts`). Their expected transcripts therefore do not pin the changed shipped model default. Disposal adds no Session field or model-visible content. The Native Responses regression holds a credential refresh while a stream close fails, drains every promise before asserting, and verifies disposal rejects only after refresh persistence. The CLI template test checks `cwd` on ordinary headless and query profiles.
