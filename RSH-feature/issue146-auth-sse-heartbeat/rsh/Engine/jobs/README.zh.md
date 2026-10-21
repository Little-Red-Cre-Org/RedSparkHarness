---
description: "jobs 组地图：后台任务控制——注册表约定、进程本地存储与面向模型的任务工具，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# jobs/：后台任务能力家族

[English](README.md) | 中文

## 概述

jobs 组涵盖后台工作面向模型的控制工具。在 Cordis 装配中，`jobs` 定义注册表，`jobs-local` 存储由 Agent 所有的工作，`tool-jobs` 提供控制工具和会话内完成通知。原生装配使用独立的 [Agent 所有任务注册表](../core/native-jobs/README.zh.md)和 `native-tool-jobs` 控制工具。两者都将访问限定为拥有任务的 Agent；目前原生单次运行应用在每轮结束时释放 Agent，也不向空闲 Agent 投递完成通知。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`jobs`](jobs/README.zh.md) | 定义后台任务约定：id、归属、生命周期与完成监听器 | `ctx.jobs` |
| [`jobs-local`](jobs-local/README.zh.md) | 在本进程中运行并存储任务，按所有者隔离 | 注册到 `ctx.jobs` |
| [`tool-jobs`](tool-jobs/README.zh.md) | 让模型读取、列出和终止任务，并投递完成通知 | 注册到 `ctx.tools` |
| [`native-tool-jobs`](native-tool-jobs/README.zh.md) | 向选定的原生工具注册表公开由 Agent 所有的任务 | 原生 `tools` |

-----

<a id="related-documentation"></a>
## 相关文档

- [后台任务运行时子系统](../../Docs/subsystems/jobs.zh.md)——任务类型、快照字段与 `ctx.jobs` API。
- [通用长时间运行工具运行时 Agent Note](../../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.zh.md)——后台任务运行时背后的设计。
- [任务注册表 seam Agent Note](../../../.agents/notes/archived/architecture/2026-07-26-job-registry-seam.md)——按所有者隔离的注册表约定及其理由。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
