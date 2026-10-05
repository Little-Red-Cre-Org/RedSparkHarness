---
description: "供路由和存储 Provider 共享的、与框架无关的 Workspace 身份及消费者操作。"
kind: "package-library"
---

# @deepseek-ai/dsh-workspace-definition

[English](README.md) | 中文

## 概述

本包拥有 WorkspaceId 品牌类型、无状态构造函数和 Workspace 消费者接口。Engine 路由与官方 Workspace Provider 使用相同身份，无需依赖该 Provider 的存储或执行适配器。


## 目录

- [使用本包](#use-this-package)
- [实现](#implementation)
- [延伸阅读](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用本包

解析器校验外部工作区标识后，导入 WorkspaceId 为其添加品牌类型。构造函数只添加类型标记，不验证记录或目录是否存在。所选 Workspace Provider 解析记录并检查目录状态，随后 Program 路由才能接受该工作区。

<a id="implementation"></a>

## 实现

公开值和类型与框架无关，由 Host 和 Client 共享。官方 dsh-workspace/workspace-types 导出重新导出本 Definition。WorkspaceId 品牌和 Workspace 接口各有唯一声明，不引入新的 registry、domain、Session writer 或持久化格式。

本包不需要 ./invariant 安装器：构造函数没有状态，也没有可独立观测的关系。记录成员归属及目录验证属于所选 Provider。

<a id="further-exploration"></a>

## 延伸阅读

- [Workspace 子系统](../../../Docs/subsystems/workspace.zh.md)
- [官方 Workspace Provider](../../../Modules/Official/workspace/workspace/README.zh.md)
- [原生根执行](../../core/native-session-execution/README.zh.md)

<a id="known-limitations-and-deferred-work"></a>

## Known Limitations and Deferred Work

- WorkspaceId 不验证记录存在性或目录状态。调用方必须在路由执行前使用所选 Workspace Provider。

不发布运行时 invariant 伴随包，因为身份构造器与 Workspace 接口不持有状态；成员关系与目录验证由选定 Provider 负责。

<a id="dev-note"></a>

### 开发备注

[设计记录](../../../../.agents/notes/implemented/architecture/2026-10-05-native-session-execution-authority.zh.md)说明安装所有权及能力范围。
