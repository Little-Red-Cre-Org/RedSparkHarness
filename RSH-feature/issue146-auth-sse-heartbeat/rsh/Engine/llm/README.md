---
description: "The provider-neutral LLM capability group: model selection and call contracts, request-retry execution, and replay-aware token measurement."
kind: "package-group"
---

# llm/ — LLM capability family

English | [中文](README.zh.md)

## Summary

The Engine LLM group owns provider-neutral model calls, per-Session model selection, retry execution, and token measurement. The `llm` package defines the message, content-block, and stream-chunk vocabulary shared by plugins and the Session log; `native-model-selection` persists a selected provider route; `llm-retry` retries failed requests at durable agent-step boundaries; and `token-meter` measures request and context pressure from the durable log. Official provider adapters and their request contributions are mapped in [Modules/Official/llm](../../Modules/Official/llm/README.md). Each package README owns its package-specific behavior.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`llm/`](llm/README.md) | Streams one model call through a registered provider adapter and shares the harness message, block, and chunk vocabulary | `ctx.llm` |
| [`native-model-selection/`](native-model-selection/README.md) | Persists a Session's selected model route and restores it for later requests | provides `modelSelection` |
| [`llm-retry/`](llm-retry/README.md) | Retries failed model requests under each provider's policy at durable agent-step boundaries | listens to `agent/request-error` |
| [`token-meter/`](token-meter/README.md) | Measures request and context pressure from the durable session log with a fixed heuristic | `ctx.tokenMeter` |

-----

<a id="related-documentation"></a>
## Related documentation

- [LLM streaming subsystem](../../Docs/subsystems/llm-streaming.md) — the message and block types, the assembled model request, the `StreamChunk` protocol, and the adapter contract.
- [Token meter subsystem](../../Docs/subsystems/token-meter.md) — the measurement semantics behind `ctx.tokenMeter`.
- [Official LLM integrations](../../Modules/Official/llm/README.md) — provider adapters and provider-specific request contributions.
- [Routed model context](../../../.agents/notes/implemented/architecture/2026-07-20-routed-model-context-and-compaction-policy.md) — how the loop routes model requests and compacts context.

<a id="dev-note"></a>
## Dev Note

None.
