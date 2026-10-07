---
description: "The native one-shot Subagent Definition and selected in-process spawn Provider delegate through the active Program executor."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-subagent

[English](README.md) | 中文

## 概述

原生 Subagent 服务定义与选定的进程内派生服务提供者通过活跃 Program 执行器委派任务。

## 目录

- [Configuration](#configuration)
- [Ownership](#ownership)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## 配置

原生入口要求 sessionExecution、activeSessions 与 promptSections，可选使用 tools、jobs 与 `externalSubagentDriver`，并提供 subagents。配置必须包含 providerName。`spawn` 选择进程内执行器，仍是已发布配置的默认值。其他名称必须与同一 Native Host 安装所选的单个外部驱动匹配；其可选服务依赖会使 Subagent Provider 先排空，再释放该驱动。内置 native-sdk 配置组合安装此 Provider 与原生 tool-subagent 消费者；其他配置必须显式选择外部 Module。

<a id="ownership"></a>
## 所有权

解析捕获精确父所有者、最新已记录的提供者/模型/推理强度、工作区与预算。覆盖子模型路由时清除继承的推理强度，除非显式选择。每个新子任务拥有独立持久 Session 与描述符。既有执行器执行深度限制、拥有唯一写入器，并释放子作用域的提示与工具限制。子任务禁用内置工具、继承选定沙箱策略且不能请求权限扩张。前台取消与卸载等待已接受执行完成清理；清理失败使操作拒绝。子任务已记录的模型错误返回真实部分输出及错误停止原因；未记录的失败仍使操作拒绝。`start()` 仅在选定执行器报告就绪且初始持久事实已提交后发布子 id；启动失败会在回滚后拒绝。设置 `outputSchema` 后，子任务必须提交一次符合 schema 的 `structured_output` 结果。无效尝试可以重试，成功提交后会拒绝后续调用；正常完成但未提交结果会以错误停止原因返回。

外部 Provider 仅支持一次性执行。`resolve()` 会签发私有的一次性准入，绑定精确的活跃父级与调用根所有者、各自 epoch、选定驱动，以及已解析的路由、工作区与预算。复制请求、重放以及已替换的所有者都会在启动前被拒绝。驱动收到的是脱离 Native 对象的请求 DTO，只包含 Session id 与 epoch，不包含 Native Agent、Session、Cordis Context 或 writer。启动前会拒绝不受支持的路由字段或子任务限制；预算来自父级且只能缩小。驱动的 `start()` 仅在真实子任务完成就绪握手后返回。Native 通过父级唯一 writer 写入并刷新 `subagent/external-start` 后才向消费者发布就绪；只有驱动确认完整子任务范围已静止后，才写入并刷新 `subagent/external-end`。父级 detach 会关闭新输入准入、取消并排空已接受的子任务，同时让 writer 保持可用，直到分离中的消费者持久化终止事实。子任务结果普通拒绝会在清理成功后传给调用方，不会使所有者排空或 Provider 释放失败；子进程范围清理与父级 lineage 持久化失败会对精确所有者和 Provider 保持粘性。

后台执行复制相同的已解析子权限与预算。Jobs 保留有界实时文本及最终输出；job_kill 请求取消，带 wait 的 job_output 等待终止清理。调用者取消在真实子任务就绪前拥有启动；发布后，父 Agent、Jobs 取消与提供者卸载拥有子任务，其生命周期独立于普通父回合。 Provider 通过 backgroundJobs 暴露选定的注册表。 continuationTools 标识子权限限制所用注册表；可持续控制必须选择同一注册表。

可持续启动通过 Program 提交描述符与首次收件箱准入后返回。sendMessage 只允许直接父子相邻关系，从持久描述符恢复已关闭的直接子任务，并返回已接受消息 id，不等待回答。list 读取选定 Program 的持久目录而不加载 Agent，穿过普通 Session 与一次性子任务，只返回此 Provider 的可持续描述符及实际驻留状态或逐项读取诊断。冷恢复保留路由、persona、工具限制与工作区；激活预算采用选定部署的默认值。interrupt 请求当前回合停止，并将未认领输入停放至另一条消息唤醒子任务。请求返回时，当前回合的清理尚未结束。父级销毁和提供者卸载等待驻留子任务清理；执行与清理失败使操作拒绝。

可持续子任务释放写入器与 Agent 后，Provider 读取该驻留阶段的持久 Session 历史，并把真实结果报告给已注册消费者。随后仅在选定 Program 仍开放时，通过精确父级 inbox 投递一条 subagent-settled 通知。结束原因与结束内容只来自本驻留阶段的持久后缀；清理失败报告 error，不保留更早回答。根父任务在下一用户轮次读取队列通知；驻留的可持续父任务沿用已有唤醒路径。Provider 关闭时，排空已接受的阶段仍会发布结果，但不再投递新通知。

<a id="model-experience"></a>
## 模型体验

### 委派输入

#### 模型看到什么

子任务接收任务文本、部署 persona、委派权限与筛选后的注册工具。每次模型请求前记录渲染提示和工具 schema。`subagent` 工具在前台清理后取得真实子内容及停止原因；后台启动返回真实子 id 与 Jobs 句柄，后续 job_output 结果进入父日志；SDK Session 树观察者收到已接受的子事件。

#### Token 影响

子任务与提示消耗子模型 token。返回最终或部分输出、后台启动确认、任务输出和结束通知会增加父历史。

#### KV Cache 影响

子任务开始新对话；其请求不复用父对话前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- persona 是作用域内的字面文本；不支持模板变量插值。
- 此 package 定义外部驱动契约，但不提供具体 SDK 或 Codex 适配器。产品 Module 必须使用共享 child-connection seam，并在 Host profile 中显式选择；native-sdk profile 选择 `spawn`。原生 SDK 子任务观察者覆盖进程内 Session；外部 wire 通知不会被投影。
- 不发布 invariant 配套模块：Program 保留 Agent、Session 与写入器权威；提供者仅拥有已接受调用与作用域安装。

<a id="dev-note"></a>
### 开发备注

[原生派生所有权](../../../../.agents/notes/implemented/architecture/2026-10-05-native-subagent-spawn.zh.md)。

[后台所有权](../../../../.agents/notes/implemented/architecture/2026-10-05-native-subagent-background.zh.md)。

[可持续所有权](../../../../.agents/notes/implemented/architecture/2026-10-05-native-subagent-continuation.zh.md)。

[结束通知准入](../../../../.agents/notes/implemented/architecture/2026-10-05-native-subagent-settlement.zh.md)。

[外部子任务所有权](../../../../.agents/notes/implemented/architecture/2026-10-08-native-external-subagent-driver.zh.md)。
