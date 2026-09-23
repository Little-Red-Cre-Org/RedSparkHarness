# Agent Note: JSON-RPC 行传输归 Core 所有

Status: implemented

English | [中文](2026-09-23-json-rpc-line-transport-ownership.md)

## Problem

Engine 中的 Codex app-server 适配器仅为了逐行 JSON-RPC 传输而依赖 Program 所有的 SDK 协议包。这条依赖让通用字节流机制与无关的 SDK 方法名称绑定，并需要运行时分层策略例外。

## Decision

Core 中的 `@deepseek-ai/dsh-json-rpc-line` 拥有既有传输实现及其行为测试。SDK 协议通过原有公开入口重新导出同一个类和错误类型；SDK 专用的方法与载荷类型仍留在 SDK 协议源码中。Codex 适配器直接导入 Core 传输，并移除对应的 Engine 到 Program 依赖例外。

传输层继续负责行分帧、请求关联、错误响应、中止结算和监听器释放。调用方负责其流和子进程终止。Core 包不包含 SDK 方法名或 Codex app-server 字段。

## Alternatives considered

**把传输复制到 Codex 适配器：** 两份实现可能在取消、UTF-8 分帧和待完成请求清理上产生分歧。

**把整个 SDK 协议移到 Core：** 具名方法、Session 事件及 SDK 客户端通知属于 Program 协议事项，而非通用传输机制。

**保留分层例外：** 这会保留可避免的 Engine 到 Program 依赖，尽管两方需要的是同一个通用传输。

## Consequences

SDK 客户端和服务端保留原有公开导入，并共用同一个传输类。Codex 适配器不再依赖 SDK 协议包。按照仓库现行规则，Core 包仍声明 Cordis peer 元数据，直到 P5 调整原生依赖策略；本次 P4 调整解决一条分层依赖，但不能证明已安装产物的无 Cordis 闭包。

## Verification

迁移后的传输测试覆盖分帧、格式错误的输入、取消、错误和关闭。SDK 客户端与服务端测试通过正常入口检查重新导出的类；Codex app-server 测试检查其直接导入 Core。Workspace 约束会在没有例外时拒绝重新引入的 Engine 到 Program 依赖。
