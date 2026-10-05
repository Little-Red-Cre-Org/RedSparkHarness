---
description: "基于共享 Session 执行器的原生 SDK JSON-RPC 应用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-sdk-server

[English](README.md) | 中文

## 概述

显式选择的 `dsh --profile native-sdk` 应用通过标准输入输出提供现有的按行分帧 SDK JSON-RPC 方法：`initialize`、`session/prompt`、`session/cancel` 和 `shutdown`。它使用一个原生 Session 执行器处理具名 Session，发送已持久化的 `session.event` 通知和整个 Session 的 `session.status` 状态变化，并在关闭或输入结束时取消并等待模型初始化与已接收的轮次结束。TypeScript 与 Python 客户端仍默认使用 `sdk` profile；调用方需显式选择 `native-sdk`。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>

## 配置

Profile 设置 `systemPrompt` 和正整数 `maxSteps`。`initialize` 为当前进程选择一个工作目录、提供方、模型，以及可选的推理强度和输出 token 上限。每个 Session ID 同时只运行一个轮次；后续提示从该 Session 的持久日志恢复，包括进程重启之后。`session/prompt` 仅在收件箱回执持久化后返回消息 ID；在此之前的失败以 JSON-RPC 错误返回给两个 SDK 客户端。

<a id="dev-note"></a>

## 开发备注

[原生 SDK 决策记录](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-sdk-session-execution.zh.md)说明了进程和 Session 的所有权选择。

<a id="model-experience"></a>

原生路径还为已接收模型分块发送 `session.chunk`，并提供 `session/cancel`。取消仅针对当前已接收轮次，在持久化接收前或结束后返回 false，并等待轮次结束后响应。排队提示与其它 Session 独立接收。分块投影选定派发，`assistant/message` 或 `assistant/attempt` 仍是其持久化所有者。同 id 提示恢复存储历史；Session 分叉尚无 SDK 协议方法。

## 模型体验

### SDK 文本提示

#### 模型看到什么

通过 `contentBlocks` 提交的文本进入持久化 Session 收件箱，并通过[原生 Session 执行器](../../../../Engine/core/native-headless/README.zh.md#model-experience)送达模型。JSON-RPC 状态通知不添加模型输入。

#### Token 影响

提交的文本在获准执行的步骤以及保留它的后续步骤中增加输入 token。

#### KV Cache 影响

提交的提示在保留的历史后追加用户文本；此前请求内容保留其顺序。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延后工作

- 此原生 SDK 路径仅接收非空文本内容块。内联图片输入和子 Agent 通知仍由兼容 SDK profile 提供。
