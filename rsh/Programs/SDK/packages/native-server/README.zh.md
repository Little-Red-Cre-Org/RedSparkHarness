---
description: "基于共享 Session 执行器的原生 SDK JSON-RPC 应用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-sdk-server

[English](README.md) | 中文

## 概述

显式选择的 `dsh --profile native-sdk` 应用通过标准输入输出提供现有的按行分帧 SDK JSON-RPC 方法：`initialize`、`session/prompt`、`session/cancel`、`session/steer`、`session/fork` 和 `shutdown`。它使用一个原生 Session 执行器处理具名 Session，发送已持久化的 `session.event` 通知和整个 Session 的 `session.status` 状态变化，并在关闭或输入结束时取消并等待模型初始化与已接收的轮次结束。TypeScript 与 Python 客户端仍默认使用 `sdk` profile；调用方需显式选择 `native-sdk`。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>

## 配置

Profile 设置 `systemPrompt` 和正整数 `maxSteps`。`initialize` 为当前进程选择一个工作目录、提供方、模型，以及可选的推理强度和输出 token 上限。每个 Session ID 同时只运行一个轮次；后续提示从该 Session 的持久日志恢复，包括进程重启之后。`session/prompt` 仅在收件箱回执持久化后返回消息 ID；在此之前的失败以 JSON-RPC 错误返回给两个 SDK 客户端。

原生路径还为已接收模型分块发送 `session.chunk`，并提供 `session/cancel`。取消仅针对当前已接收轮次，在持久化接收前或结束后返回 false，并等待其资源清理结束后响应。清理失败会拒绝取消请求。排队提示与其它 Session 独立接收。分块投影选定派发，`assistant/message` 或 `assistant/attempt` 仍是其持久化所有者。同 id 提示恢复存储历史。

`session/fork` 将源历史复制至已结束轮次，写入新的目标 Session，不调用模型。可选 `atSeq` 选择该已结束轮次中的既有事件，省略时选择最后结束的轮次。源历史保持不变，目标的下一次提示恢复持久化副本。随附 native-sdk profile 安装 Session-execution Provider；应用显式要求其执行与活动所有者服务。

`session/prompt` 接受有序文本块及编码栅格图片（`{ type: "image", data, mimeType }`）。必需的附件 Provider 在持久化收件回执之前校验规范 base64、声明媒体类型、解码字节与部署限额。Session 保存不可变引用；所选模型适配器读取已验证的请求变体，重启或分叉后同样如此。拒绝调用者提供的持久化附件引用。所选模型必须支持图片输入。

`session/steer` 通过精确的活动 Session 所有者，为已接收根任务的下一步排入有序提示内容。持久化后返回消息 ID，不中断当前模型派发。拒绝未知、空闲、已取消或属于其它 Program 的所有者。如果下一步开始之前任务被取消或自然结束，已接收输入仍保留为待处理项，恢复轮次会认领它。引导输入与普通提示共用图片准入。

<a id="dev-note"></a>

## 开发备注

[原生 SDK 决策记录](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-sdk-session-execution.zh.md)说明了进程和 Session 的所有权选择。

<a id="model-experience"></a>

## 模型体验

### SDK 提示

#### 模型看到什么

通过 `contentBlocks` 提交的文本和已准入的图片引用进入持久化 Session 收件箱，并通过[原生 Session 执行器](../../../../Engine/core/native-headless/README.zh.md#model-experience)送达模型。JSON-RPC 状态通知不添加模型输入。

#### Token 影响

提交的文本与图片在获准执行的步骤以及保留它们的后续步骤中增加输入 token。

#### KV Cache 影响

提交的提示在保留的历史后追加用户内容；此前请求内容保留其顺序。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延后工作

- 子代理通知仍由兼容 SDK profile 提供。
