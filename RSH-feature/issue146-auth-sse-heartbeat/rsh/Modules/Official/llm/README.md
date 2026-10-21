---
description: "First-party model-provider adapters and official DeepSeek request contributions."
kind: "package-group"
---

# llm/ — official model integrations

English | [中文](README.zh.md)

## Summary

This group owns first-party provider protocols and metadata added to official DeepSeek requests. Its adapters register model routes with the provider-neutral `ctx.llm` service defined by the [Engine LLM group](../../../Engine/llm/README.md). DeepSeek request contributions may read Engine-owned Session services and the shared Cordis Loader from `Core/vendor`, but do not own Session storage, format, or query APIs.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | Contribution |
|---|---|---|
| [`llm-deepseek/`](llm-deepseek/README.md) | Direct official DeepSeek chat-completions adapter | registers on `ctx.llm` |
| [`llm-pi-ai/`](llm-pi-ai/README.md) | Provider routes implemented through pi-ai catalogs and protocols | registers on `ctx.llm` |
| [`deepseek-llm-api-extensions/`](deepseek-llm-api-extensions/README.md) | Lifecycle-owned registry for top-level official DeepSeek request fields | `ctx.deepseekLlmApiExtensions` |
| [`plugin-package-inventory-deepseek/`](plugin-package-inventory-deepseek/README.md) | Active Loader package inventory for official DeepSeek requests | `dsh_plugin_packages` |
| [`session-log-deepseek/`](session-log-deepseek/README.md) | Incremental canonical Session-log suffix for official DeepSeek requests | `dsh_session_log` and its delivery-accepted event |

<a id="related-documentation"></a>
## Related documentation

- [Engine LLM capability group](../../../Engine/llm/README.md) — provider-neutral model-call and selection packages.
- [LLM streaming subsystem](../../../Docs/subsystems/llm-streaming.md) — shared model request and stream types.
- [Session subsystem](../../../Docs/subsystems/session.md) — canonical event log and persistence ownership.
- [DeepSeek API request extensions](../../../Docs/deepseek-llm-api-wire-extensions.md) — request fields outside model input.

<a id="dev-note"></a>
## Dev Note

None.
