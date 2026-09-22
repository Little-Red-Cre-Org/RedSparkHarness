---
description: "原生 profile 可为每个感知 Session 的文件系统变更选择显式 sandbox mode 和工作区根目录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-sandbox-policy

[English](README.md) | 中文

## 概述

`dsh-native-sandbox-policy` 提供所选 sandbox 文件系统使用的 mode 和根目录。profile 必须指定 `read-only`、`workspace-write` 或 `danger-full-access` 以及绝对回退根目录。Session 调用使用不可变的 Session 工作区，因此 bridge 不会悄悄回退到不受限制的本地后端。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

`mode` 和 `workspaceRoot` 均为必填。`workspaceRoot` 必须为绝对路径，未知字段会拒绝 profile 激活。原生服务提供 `sandboxPolicy`；sandboxing 文件系统 Provider 会在激活前要求它。

<a id="model-experience"></a>
## 模型体验

该策略不直接发送文本。Consumer 工具或文件系统将被拒绝的变更映射为面向模型的结果，并由所属应用记录该结果。

#### KV Cache 影响

该包不添加或重排请求内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 策略只有一个 profile 级 mode，不投影 Session 覆盖事件。
- 它只限制文件系统 bridge 决策，不是操作系统隔离机制。

不发布 invariant companion，因为策略解析只有一个所属 Provider，且没有独立持久化观测。

<a id="dev-note"></a>
### 开发备注

无。
