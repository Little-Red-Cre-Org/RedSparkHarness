---
description: "ACP（Agent Client Protocol）包组：通过 JSON-RPC stdio 将全新 harness agent（智能体）暴露给程序化客户端的仅面向自动化的服务器。"
kind: "package-group"
---

# acp/：Agent Client Protocol 自动化

[English](README.md) | 中文

## 概述

acp 组提供兼容与原生承载包：服务器，让程序与自动化流程可以通过标准 Agent Client Protocol 运行持久 DeepSeek Harness agent。客户端可以创建、列出、恢复与关闭会话，挂载标准 MCP 服务器，选择模型选项，发送文本与图片提示词，接收语义更新，响应权限提示并取消工作——无需人类参与。从另一个 harness 启动这种服务器的配套客户端位于 `subagent/subagent-acp`。本页概述该包组；各包的具体约定由其 README 规定。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`acp/`](acp/README.zh.md) | 让程序通过 ACP 管理持久 agent、挂载 MCP 服务器、选择模型选项、发送提示词、取消工作并接收语义更新 |
| [`native-acp/`](native-acp/README.zh.md) | 显式选择的原生文本 ACP 承载层，支持持久化 Session 提示、取消、关闭、列出与恢复 |

-----

<a id="related-documentation"></a>
## 相关文档

- [dsh-subagent-acp](../../../Engine/subagent/subagent-acp/README.zh.md)——spawn 并驱动本服务器的进程外 ACP 客户端。
- [ACP 作为仅面向自动化的协议](../../../../.agents/notes/implemented/simplification/2026-07-23-acp-automation-only-protocol.zh.md)——自动化约定及其协议边界的决策记录。
- [在单个连接上多路复用并发 ACP 会话](../../../../.agents/notes/archived/feature/2026-06-14-acp-multi-session.md)——按会话隔离、归属与清理决策。

<a id="dev-note"></a>
## 开发备注

无。
