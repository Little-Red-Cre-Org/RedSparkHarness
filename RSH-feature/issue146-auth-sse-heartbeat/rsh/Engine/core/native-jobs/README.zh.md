---
description: "带协作式取消与排空的原生 Agent 所有后台 job 注册表。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-jobs

[English](README.md) | 中文

## 概述

`dsh-native-jobs` 为由一个精确存活 Agent 所有的工作提供原生 `jobs` 注册表。它分配带 kind 前缀的 id，将读取和取消限制为同一个 Agent 对象，记录状态与有界的实时和最终输出，并在 Host 释放或手动释放 Agent 时排空协作式 runner。它不决定哪些 job 事实变为模型可见内容或持久化 Session 事件。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

`./native` 入口要求 `agents`、提供 `jobs`，并接受 `maxConcurrentPerAgent`：正安全整数上限，默认值为 `10`，以及 `maxOutputBytes`：保留 UTF-8 尾部输出的正安全整数字节预算，默认值为 `262144`。`start()` 会在调用 runner 前验证精确登记的 Agent、小写连字符式 kind 和非空 label。runner 会得到一个 `AbortSignal` 与发布已观察文本的回调，取消或完成前均可发布；同步 throw 或 rejected Promise 会变为失败的终态记录，预期的运行失败则 resolve 为显式终态 outcome。

`cancel()` 会把存活记录变为 `stopping` 并 abort runner；其最终 outcome 仍是权威。`read()` 返回实时或最终保留输出及截断状态，读取不消费文本。终态 outcome 的 `output` 替换实时文本作为最终展示；未提供时保留实时文本。取消或完成后回调失效；终态 outcome 仍在所属清理完成后返回。`wait()` 使用调用方提供的超时和可选取消信号；取消等待不会停止任务。`dispose()` 则停止接收、abort 所有存活 runner，并等待它们协作式完成。owner 开始释放时，注册表会在 Agent 触发释放事件前 abort 并排空该 Agent 的所有存活 runner。每个公开读取、等待与取消都要求原始且仍可用的登记 Agent 实例，因此已注销、正在释放或替换后的对象不能查看早先 owner 的 job。

<a id="model-experience"></a>
## 模型体验

原生 job 状态与最终输出会保留在注册表内，直到应用选择模型可见的投影，才会间接影响模型。

#### KV Cache 影响

原生 job 生命周期与保留输出不会增加模型请求内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- runner 必须配合取消；注册表没有进程 kill 或 worker 终止权限。
- 注册表没有 Session writer、工具 schema、浏览器 projection 或 remote controller；[native-tool-jobs](../../jobs/native-tool-jobs/README.zh.md) 单独贡献面向模型的控制工具。
- 原生 shell、subagent 和 workflow Provider 在采用这一所有权隔离机制时，会自行选择输出保留与 Session projection。

不发布 invariant companion，因为在应用记录前，job 状态没有独立的持久化观测。

<a id="dev-note"></a>
### 开发备注

无。
