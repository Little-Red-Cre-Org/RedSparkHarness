---
description: "通过经过身份验证的 RPC 和实时计划更新，向浏览器提供 Native 定时任务元数据。"
kind: "package-reference"
---

# Native 定时任务控制器

[English](README.md) | 中文

## 概述

Native Web 应用可以列出活动、暂停和失败的定时任务，并跟随已提交的变化。计划行不包含任务提示或捕获的执行配置。应用必须安装任务调度器和本控制器。

## 目录

- [参考](#reference)
- [不变量](#invariants)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)
- [模型体验](#model-experience)

<a id="reference"></a>
## 参考

Native Web profile 会在 `task-scheduler` 之后安装本控制器。它需要 Host Connection 和 Native 调度器服务。

`schedules/list` 返回活动、暂停和失败的计划。`schedules/follow` 是经过身份验证的 POST Fetch 路由，会发送 SSE 基线，随后发送已变化的行和删除通知。数据流读取已提交的调度器状态；其中不含任务提示或执行配置。

`schedule` 包含已保存的 RFC 3339 开始时间；对重复任务，还包含固定的经过时间间隔。`timeZone` 将该时间戳中的显式 UTC 偏移保留为 `UTC±HH:mm`；对 `Z` 和 `+00:00` 使用 `UTC`。清单会省略已完成的一次性计划。

失败使用通用消息和 `native/schedules`。Client Consumer 是 [Native Session](../../client/native-session/README.zh.md) 提供的 `clientNativeSchedule`。

## 不变量

本控制器只读取调度器已提交的计划和执行记录，不维护第二份状态，因此不发布运行时不变量伴随包。

## 已知限制与延期工作

本控制器只读取计划；它不会创建、暂停、恢复或删除计划。

<a id="dev-note"></a>
## 开发备注

任务调度器拥有持久化和计划执行。本包拥有经过身份验证的浏览器投影。

<a id="model-experience"></a>
## 模型体验

### 模型可见内容

本包不添加模型可见输入或工具。

### Token 影响

本包不发起模型请求，也不使用 Token。

### KV Cache 影响

本包不会更改请求前缀。
