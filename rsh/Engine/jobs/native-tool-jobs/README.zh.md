---
description: "面向模型的原生 Agent 后台任务控制工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-tool-jobs

[English](README.md) | 中文

## 概述

`dsh-native-tool-jobs` 向选定的原生工具注册表登记 `job_output`、`job_list` 和 `job_kill`。它按精确的发起 Agent 从选定的原生任务注册表读取或取消工作。消费它的应用负责把每次调用和结果写入 Session；此包不创建第二套 Agent、任务或 Session 权威。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

`./native` 入口要求 `jobs` 和 `tools`，不提供服务。它接受正有限定时器时长 `waitTimeoutMs`（默认 `30000`）与 `maxWaitTimeoutMs`（默认 `600000`）。默认值不得超过上限。`maxOutputBytes`（默认 `16384`，最小 `128`）限制每条模型可见文本结果。移除这一安装时，仅注销它登记的三个工具。

`job_output` 读取最终输出与当前状态。设置 `wait: true` 后，它等待终态或配置的超时；请求可以传入 `timeout_ms`，但受 `maxWaitTimeoutMs` 限制。工具调用中止时只停止等待，不取消任务。`job_kill` 请求协作式取消，并在 runner 结束前返回。所有操作都限定为拥有任务的精确存活 Agent。

<a id="model-experience"></a>
## 模型体验

### 工具操作

#### 模型看到的内容

模型会收到 `job_output`、`job_list` 和 `job_kill` 的 schema。`job_output` 在可用时返回最终输出及状态行；`job_list` 返回当前 Agent 所有任务的 id、kind、状态和 label；`job_kill` 报告是否已请求取消，或任务此前已经结束。应用在下一次模型请求前将结果写入日志一次。

#### Token 影响

三个 schema 会在每次模型步骤中增加请求 token。工具结果保留在后续请求和恢复的历史中。

#### KV Cache 影响

安装或移除这一贡献会改变工具 schema 前缀；仅任务状态变化不会改变此前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 原生注册表保留最终输出，没有增量流读取接口。因此活动任务返回 `(no output yet)`。
- 截断后的输出会包含省略标记；`job_output` 会在字节预算内保留状态行。
- Agent 释放时，它的任务会被取消并排空。单次运行的原生 headless 应用在每轮结束时释放 Agent，所以任务不能跨 CLI 调用继续运行。
- 原生 shell、subagent 与 workflow Producer 必须自行登记 runner；此包只提供控制工具。

不发布 invariant companion，因为此包没有独立于任务与工具注册表的状态。

<a id="dev-note"></a>
### 开发备注

无。
