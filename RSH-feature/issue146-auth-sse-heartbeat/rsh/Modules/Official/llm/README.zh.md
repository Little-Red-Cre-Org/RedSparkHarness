---
description: "第一方模型提供方适配器与官方 DeepSeek 请求贡献。"
kind: "package-group"
---

# llm/：官方模型集成

[English](README.md) | 中文

## 概述

本组负责第一方提供方协议，以及加入官方 DeepSeek 请求的元数据。适配器会向[Engine LLM 组](../../../Engine/llm/README.zh.md)定义的提供方无关 `ctx.llm` 服务注册模型路由。DeepSeek 请求贡献可读取 Engine 拥有的 Session 服务，以及 `Core/vendor` 提供的共享 Cordis Loader，但不负责 Session 的存储、格式或查询 API。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | 贡献 |
|---|---|---|
| [`llm-deepseek/`](llm-deepseek/README.zh.md) | 直连官方 DeepSeek chat-completions 的适配器 | 注册到 `ctx.llm` |
| [`llm-pi-ai/`](llm-pi-ai/README.zh.md) | 通过 pi-ai 目录与协议实现的提供方路由 | 注册到 `ctx.llm` |
| [`deepseek-llm-api-extensions/`](deepseek-llm-api-extensions/README.zh.md) | 为官方 DeepSeek 请求顶层字段提供具有生命周期归属的注册表 | `ctx.deepseekLlmApiExtensions` |
| [`plugin-package-inventory-deepseek/`](plugin-package-inventory-deepseek/README.zh.md) | 为官方 DeepSeek 请求提供当前启用的 Loader 包清单 | `dsh_plugin_packages` |
| [`session-log-deepseek/`](session-log-deepseek/README.zh.md) | 为官方 DeepSeek 请求提供增量规范 Session 日志后缀 | `dsh_session_log` 及其 delivery-accepted 事件 |

<a id="related-documentation"></a>
## 相关文档

- [Engine LLM 能力组](../../../Engine/llm/README.zh.md)——提供方无关的模型调用与选择包。
- [LLM 流式子系统](../../../Docs/subsystems/llm-streaming.zh.md)——共享的模型请求与流式类型。
- [Session 子系统](../../../Docs/subsystems/session.zh.md)——规范事件日志与持久化的所有权。
- [DeepSeek API 请求扩展](../../../Docs/deepseek-llm-api-wire-extensions.zh.md)——模型输入之外的请求字段。

<a id="dev-note"></a>
## 开发备注

无。
