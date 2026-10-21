---
description: "Workspace Engine 分组：供路由与存储 Provider 共用的工作区身份和消费者操作。"
kind: "package-group"
---

# rsh/Engine/workspace

[English](README.md) | 中文

## 概述

本分组定义 Engine 路由与 Workspace Provider 共用的工作区身份和操作。消费者需要命名或解析工作区、又不应依赖特定存储 Provider 时使用这里的库。官方 Provider 负责工作区记录与目录验证。

## 目录

- [软件包](#packages)
- [相关文档](#related-documentation)
- [开发说明](#dev-note)

-----

<a id="packages"></a>
## 软件包

| 软件包 | 职责 |
|---|---|
| [`workspace-definition/`](workspace-definition/README.zh.md) | 供路由与存储 Provider 共用的工作区身份和消费者操作 |

<a id="related-documentation"></a>
## 相关文档

- [Workspace 子系统](../../Docs/subsystems/workspace.zh.md)——工作区行为与所有权。
- [官方 Workspace Provider](../../Modules/Official/workspace/workspace/README.zh.md)——工作区记录与目录验证。

<a id="dev-note"></a>
## 开发说明

[原生 Session 执行决策](../../../.agents/notes/implemented/architecture/2026-10-05-native-session-execution-authority.zh.md)定义 Workspace 身份如何进入执行。
