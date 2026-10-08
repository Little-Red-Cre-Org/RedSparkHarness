# Agent Note: Native web search and fetch share the Cordis core

Status: implemented

English | [中文](2026-10-08-native-web-tools.zh.md)

## Problem

`web_search` and `web_fetch` were only reachable through Cordis profiles. The native headless, web and TUI profiles needed the same tools, provider selection, credential flow, settings and model-visible output without a second implementation that could drift from the Cordis path.

## Decision

This is a framework migration, not a reimplementation. Each of the six packages under `rsh/Modules/Official/web/` is a mixed package: its business logic lives in framework-free modules (`selection.ts`, `config.ts`, `provider.ts`, `search-core.ts`, `fetch-core.ts`), and both the Cordis entry (`index.ts`) and the native entry (`native.ts`) call that same code. Only the registration glue differs: Cordis services and `ctx.effect` on one side, `NativeContext.provide`/`require`/`effect` on the other.

- `@deepseek-ai/dsh-web/native` provides `web` with the shared execution-time selection, duplicate rejection, `maxResults` capping and `WebError` codes. Configured pins win over `DSH_WEB_SEARCH_PROVIDER` / `DSH_WEB_FETCH_PROVIDER` from the process layer of the launch environment. A provider's disposer closes admission, aborts its admitted operations and resolves after they settle.
- Native providers receive the consuming invocation's `signal` and `appendEvent`. The DeepSeek provider records `web/deepseek-search-llm-request` through `appendEvent` and awaits it before the auxiliary model request leaves the process, as the Cordis path records it through the initiating Session.
- The DeepSeek provider resolves its key through the same shared function on both paths: the credentials service when present, then the launch environment. Its settings section registers with the native settings service and updates live.
- `@deepseek-ai/dsh-tool-web/native` registers the same parameter schemas, render text, presentation meta and prompt guidance as the Cordis tools. Schema literals stay with each registration API (native tools take standard JSON Schema, Cordis takes the dsh-tools DSL), following the tool-fs-search precedent; tests pin their equality.
- The shipped `native-headless`, `native-web` and `native-tui` compositions install `web`, `web-search-deepseek`, `web-fetch-http` and `tool-web`.

## Alternatives considered

Re-implementing the tools natively would have forked validation, query merging, rendering and the DeepSeek request recording, so every future fix would need to land twice.

Enforcing `searchTimeoutMs` / `fetchTimeoutMs` inside the native tools would copy the tool-call timeout guard. Each native contribution declares its configured budget to that guard; it supplies the derived invocation signal, drains the provider operation, and records `TOOL_TIMEOUT` only after the operation settles.

## Consequences

The Cordis path is unchanged in behavior and output. The shipped native headless, Web, and TUI compositions install the timeout policy with the web tools; `native-sdk` and `native-acp` compositions do not install the web rows.
