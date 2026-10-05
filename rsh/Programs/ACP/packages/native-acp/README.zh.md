---
description: "通过标准 ACP 协议驱动持久化的原生 Session。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-acp

[English](README.md) | 中文

## 概述

选择 `dsh --profile native-acp`，即可通过标准 ACP JSON-RPC 标准输入输出创建、发送提示、取消、关闭、列出和恢复持久化的 Session。已提交的助手文本、推理和注册工具生命周期事实转换为有序的 `session/update` 通知。兼容的 `acp` profile 仍是默认 ACP 组合。

## 目录

- [配置](#configuration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

<a id="configuration"></a>

## 配置

Profile 设置 `provider`、`model`、`systemPrompt` 和正整数 `maxSteps`。每个 Session 通过 `session/new` 选择一个已存在的绝对工作目录，同时仅接受一个文本提示。重叠的提示显式失败。创建返回之前，空 Session 已持久化。恢复检查存储的工作目录与谱系，并在接受后续提示之前重放已提交的展示事件。关闭释放活动执行器并保留存储日志。输入结束和 Host 取消会取消并等待已接收的工作结束；ACP 没有标准的关闭进程请求。

原生预设组合安装模型适配器、原生 Agent 与模型执行、本地文件系统、凭据和 Session 持久化。可通过 profile patch 安装其他原生工具。只有精确的执行取消原因会转换为取消响应；清理失败及无关的执行失败仍作为协议错误上报。

<a id="dev-note"></a>

## 开发备注

[原生 ACP 决策记录](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-acp-session-carrier.zh.md)说明了协议与执行的所有权。此承载层没有可与执行器分歧的独立 Agent 或 Session 状态投影，因此不发布 invariant 入口。

<a id="model-experience"></a>

## 模型体验

### ACP 文本提示

#### 模型看到什么

通过 `session/prompt` 接收的文本进入持久化 Session 收件箱，并通过[原生 Session 执行器](../../../../Engine/core/native-headless/README.zh.md#model-experience)送达模型。ACP 展示通知不添加模型输入。

#### Token 影响

提交的文本在获准执行的步骤以及保留它的后续步骤中增加输入 token。

#### KV Cache 影响

提交的提示在保留的历史后追加用户文本；此前请求内容保留其顺序。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延后工作

- Session 专属 MCP 挂载、图片／音频／嵌入式输入、模型配置控制、权限／提问请求和附件展示不属于此承载批次；不支持的提示内容与 MCP 声明显式失败。初始化声明仅支持文本提示且不支持 HTTP MCP。需要这些能力的现有 ACP 客户端在原生对等能力实现之前使用兼容 profile。
