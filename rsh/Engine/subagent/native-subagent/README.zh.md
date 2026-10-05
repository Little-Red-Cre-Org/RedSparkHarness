---
description: "The native one-shot Subagent Definition and selected in-process spawn Provider delegate through the active Program executor."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-subagent

[English](README.md) | 中文

## 概述

原生一次性 Subagent 服务定义与选定的进程内派生服务提供者通过活跃 Program 执行器委派任务。

## 目录

- [Configuration](#configuration)
- [Ownership](#ownership)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## 配置

原生入口要求 sessionExecution 与 promptSections，可选使用 tools 与 jobs，并提供 subagents。配置必须包含 providerName。内置 native-sdk 配置组合安装此提供者与原生 tool-subagent 消费者；其他原生配置可显式组合相同模块。

<a id="ownership"></a>
## 所有权

解析捕获精确父所有者、最新已记录的提供者/模型/推理强度、工作区与预算。覆盖子模型路由时清除继承的推理强度，除非显式选择。每个新子任务拥有独立持久 Session 与描述符。既有执行器执行深度限制、拥有唯一写入器，并释放子作用域的提示与工具限制。子任务禁用内置工具、继承选定沙箱策略且不能请求权限扩张。前台取消与卸载等待已接受执行完成清理；清理失败使操作拒绝。子任务已记录的模型错误返回真实部分输出及错误停止原因；未记录的失败仍使操作拒绝。

后台执行复制相同的已解析子权限与预算。Jobs 保留有界实时文本及最终输出；job_kill 请求取消，带 wait 的 job_output 等待终止清理。调用者取消在真实子任务就绪前拥有启动；发布后，父 Agent、Jobs 取消与提供者卸载拥有子任务，其生命周期独立于普通父回合。

<a id="model-experience"></a>
## 模型体验

### 委派输入

#### 模型看到什么

子任务接收任务文本、部署 persona、委派权限与筛选后的注册工具。每次模型请求前记录渲染提示和工具 schema。`subagent` 工具在前台清理后取得真实子内容及停止原因；后台启动返回真实子 id 与 Jobs 句柄，后续 job_output 结果进入父日志；SDK Session 树观察者收到已接受的子事件。

#### Token 影响

子任务与提示消耗子模型 token。返回最终或部分输出、后台启动确认及任务输出会增加父历史。

#### KV Cache 影响

子任务开始新对话；其请求不复用父对话前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- persona 是作用域内的字面文本；不支持模板变量插值。
- 此入口不提供可持续子任务、外部后端、目录与 subagent.finished 结果通知。
- 不发布 invariant 配套模块：Program 保留 Agent、Session 与写入器权威；提供者仅拥有已接受调用与作用域安装。

<a id="dev-note"></a>
### 开发备注

[原生派生所有权](../../../../.agents/notes/implemented/architecture/2026-10-05-native-subagent-spawn.zh.md)。

[后台所有权](../../../../.agents/notes/implemented/architecture/2026-10-05-native-subagent-background.zh.md)。
