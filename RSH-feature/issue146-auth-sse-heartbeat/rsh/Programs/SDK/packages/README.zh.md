---
description: "SDK 家族的包映射：JSON-RPC 协议，以及供进程外 SDK 使用的 TypeScript 客户端与服务器。"
kind: "package-group"
---

# sdk/：从另一进程驱动 Harness 运行时

[English](README.md) | 中文

## 概述

SDK 家族让另一进程通过按换行分帧的 JSON-RPC 驱动完整的 DeepSeek Harness 运行时。Engine 所有的协议与 runtime 包定义共享 wire 和 Session 客户端行为；TypeScript Program facade 选择同版本 `dsh` launcher，服务端则通过 stdio 接受 SDK 请求。TypeScript 客户端与 [Python SDK](../python/README.zh.md) 使用同一种协议，而这些包不会创建开发者项目，也不定义其他应用。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

每个包的 README 都介绍了其所对应栈组件的用途。

| 包 | 职责 |
|---|---|
| [`sdk-protocol`](../../../Engine/subagent/sdk-protocol/README.zh.md) | Engine 所有的按换行分帧 JSON-RPC 传输与具名 wire 类型 |
| [`sdk-runtime`](../../../Engine/subagent/sdk-runtime/README.zh.md) | Engine 所有的 TypeScript Session API 与 provider-neutral SDK runtime |
| [`client/`](client/README.zh.md) | Program facade：选择同版本 `dsh` launcher 并保留公开 TypeScript SDK API |
| [`server/`](server/README.zh.md) | `jsonrpc` 插件：通过 stdio 为进程外 SDK 客户端提供服务 |
| [`native-server/`](native-server/README.zh.md) | 显式选择的原生 SDK profile 应用：使用共享 Session 执行器 |

-----

<a id="related-documentation"></a>
## 相关文档

先从 Python SDK（客户端约定的姊妹实现）开始，再看可运行应用与组边界背后的决策记录。

- [Python SDK](../python/README.zh.md)——采用同一种协议并附带打包运行时的 Python 对应实现。
- [SDK 应用组合包](../../../Compatibility/DSH/bundle/sdk-app/README.zh.md)——启动 JSON-RPC 服务器的 `dsh --profile sdk` 应用。
- [架构](../../../Docs/architecture.zh.md) — 打包后的 Python 客户端为何启动相同的具名 profile。
- [SDK 项目工具链移除](../../../../.agents/notes/archived/simplification/2026-08-11-remove-sdk-project-toolchain.md) — 本组为何从不创建、配置或构建开发者项目。
- [SDK subagent 提供方](../../../Compatibility/DSH/subagent/subagent-dsh-sdk/README.zh.md) — harness 内部使用 TypeScript 客户端的提供方。

<a id="dev-note"></a>
## 开发备注

无。
