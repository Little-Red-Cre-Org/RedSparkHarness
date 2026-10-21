---
description: "代码执行能力族的包映射：程序执行能为你做什么，以及每个部分由哪个包负责。"
kind: "package-group"
---

# code-runtime/——代码执行能力族

[English](README.md) | 中文

## 概述

此能力家族分离可移植运行契约、Cordis 适配器与执行后端。需要在全新 Node Worker 中执行时选择 worker-thread TypeScript 后端；需要明确使用原生受限进程时选择 process-sandbox；需要 CPython 时选择私有实验性 Python 后端。每次运行均不继承此前程序的状态，失败会作为结果返回。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

Definition、Compatibility 适配器与运行时 Provider 分别拥有可移植契约、Cordis 服务和具体执行机制；各 README 说明对应所有者。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`code-runtime-definition`](../../../Engine/core/code-runtime-definition/README.zh.md) | 定义与框架无关的代码运行请求和 Provider 操作 | — |
| [`compat-code-runtime/`](../../../Compatibility/DSH/bridge/compat-code-runtime/README.zh.md) | 实现 Cordis `ctx.codeRuntime` 服务契约 | `ctx.codeRuntime` |
| [`native-code-runtime/`](native-code-runtime/README.zh.md) | 提供执行 Provider 共用的原生 Worker 运行时 | — |
| [`code-runtime-worker-thread/`](code-runtime-worker-thread/README.zh.md) | 在全新的 Node Worker 线程中执行 TypeScript 程序 | 注册 `ctx.codeRuntime` |
| [`code-runtime-process-sandbox/`](code-runtime-process-sandbox/README.zh.md) | 为明确选择原生运行时的 profile 提供受沙箱限制的进程执行 | — |
| [`experimental/code-runtime-python/`](../../Community/experimental/code-runtime-python/README.zh.md) | 实验性 Python 后端：负责 Node 宿主与 CPython 子进程之间的 fd-3 协议 | — |

-----

<a id="related-documentation"></a>
## 相关文档

先从子系统参考了解服务约定，再看消费此能力的 PTC mode 设计，以及它所遵循的能力 seam 模型。

- [代码运行时子系统参考](../../../Docs/subsystems/code-runtime.zh.md)——请求／结果词汇、绑定与 `ctx.codeRuntime` 的 Cordis 接口面。
- [PTC mode Agent Note](../../../../.agents/notes/implemented/feature/2026-06-15-ptc.zh.md)——工具注册表如何把 `run_code` 呈现给模型。
- [能力 seam](../../../Docs/capability-seams.zh.md)——本家族遵循的 Service Definition / Service Provider / Consumer 拆分。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
