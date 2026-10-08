---
description: "保留旧版 TypeScript SDK DSH 子 agent 提供方的兼容包组。"
kind: "package-group"
---

# DSH subagent 兼容包

[English](README.md) | 中文

## 概述

此包组按既有包名和提供方名称，为兼容 profile 保留 Cordis DSH SDK 子级提供方。它通过公开的 TypeScript SDK 客户端驱动一个独立的 `dsh --profile sdk` 子进程；Engine 不拥有此 Program 依赖，也不复制另一份 subagent 实现。

原生 SDK 子级使用选择性启用的 [`sdk-child` Module](../../../Modules/Official/subagent/sdk-child/README.zh.md)。该 Module 接收 Host 批准的子进程连接，并将准入、取消、父级 Session 写入和进程范围清理留给 Native Subagent 与选定 Program。共享准入与生命周期契约见 [Subagent 子系统参考](../../../Docs/subsystems/subagent.zh.md)。

## 包

| 包 | 用途 |
|---|---|
| [`subagent-dsh-sdk/`](subagent-dsh-sdk/README.zh.md) | 兼容版 `ctx.subagents` Cordis 提供方，用于单独的 SDK profile 子运行时 |
