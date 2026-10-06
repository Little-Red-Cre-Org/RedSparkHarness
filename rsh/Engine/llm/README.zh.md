---
description: "提供方无关的 LLM（大语言模型）能力包组：模型选择与调用约定、请求重试执行，以及具备回放感知的 token 计量。"
kind: "package-group"
---

# llm/ — LLM 能力家族

[English](README.md) | 中文

## 概述

Engine LLM 组负责提供方无关的模型调用、每个 Session 的模型选择、重试执行与 token 计量。`llm` 包定义插件与 Session 日志共享的消息、内容块与流式分片词汇；`native-model-selection` 持久化已选择的提供方路由；`llm-retry` 在持久化的 agent（智能体）步骤边界上重试失败的请求；`token-meter` 从持久化日志测量请求与上下文压力。官方提供方适配器及其请求贡献列在 [Modules/Official/llm](../../Modules/Official/llm/README.zh.md)。每个包 README 负责各自的包级行为。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`llm/`](llm/README.zh.md) | 通过已注册的提供方适配器流式发起一次模型调用，并共享 harness 的消息、块与分片词汇 | `ctx.llm` |
| [`native-model-selection/`](native-model-selection/README.zh.md) | 持久化 Session 的模型路由选择，并为后续请求恢复该选择 | 提供 `modelSelection` |
| [`llm-retry/`](llm-retry/README.zh.md) | 在持久 agent 步骤边界上按各提供方策略重试失败的模型请求 | 监听 `agent/request-error` |
| [`token-meter/`](token-meter/README.zh.md) | 用固定启发式规则从持久会话日志测量请求与上下文压力 | `ctx.tokenMeter` |

-----

<a id="related-documentation"></a>
## 相关文档

- [LLM 流式子系统](../../Docs/subsystems/llm-streaming.zh.md)——消息与块类型、组装后的模型请求、`StreamChunk` 协议与适配器约定（adapter contract）。
- [Token 计量子系统](../../Docs/subsystems/token-meter.zh.md)——`ctx.tokenMeter` 背后的测量语义。
- [官方 LLM 集成](../../Modules/Official/llm/README.zh.md)——提供方适配器与提供方专用请求贡献。
- [按路由的模型上下文](../../../.agents/notes/implemented/architecture/2026-07-20-routed-model-context-and-compaction-policy.zh.md)——loop 如何路由模型请求并压缩上下文。

<a id="dev-note"></a>
## 开发备注

无。
