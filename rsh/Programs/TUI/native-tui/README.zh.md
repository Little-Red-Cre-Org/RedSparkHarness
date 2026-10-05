---
description: "通过显式原生配置运行可恢复的终端对话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-tui

[English](README.md) | 中文

## 概述

原生终端支持多轮对话、实时输出和文件工具结果展示。用户可排队输入、停止当前轮次，并恢复同一份持久会话。启动需要交互式终端与显式原生 Provider 装配。

## 目录

- [使用与配置](#configuration)
- [实现](#implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 使用与配置

`./native` 入口由 `dsh --profile native-tui` 装配。它复用[共享执行器的配置](../../../Engine/core/native-headless/README.zh.md#configuration)，并要求 `locale` 为 `en` 或 `zh`、`background` 为 `#rrggbb`，以及正安全整数 `maxQueuedInputs`、`maxHistoryEvents`、`maxTranscriptEvents`、`maxStreamChunks`。历史读取超过上限会失败；展示与流式缓存只保留最近的配置条数。

新会话不接受位置参数；`--resume <session-id>` 恢复原会话。Enter 排队，Esc 停止当前轮次并发送非空草稿，Ctrl+C 在执行时停止、空闲时退出。`/help`、`/model`、`/reasoning`、`/clear`、`/retry`、`/exit`、`/quit` 可用；其他命令明确报错。`/clear` 仅清理视图。停止会丢弃尚未执行的输入；退出先取消并等待接受的执行清理，再释放 Ink。执行清理拒绝时仍释放 Ink；执行和终端清理同时失败时以 `AggregateError` 保留两者。

内置 Profile 安装 `modelSelection`，由模型适配器提供 `modelDirectory`。`/model` 读取已公布模型及隔离的 Provider 错误；`/reasoning` 读取当前模型的实际推理强度。输入展示的编号提交完整选择，Esc 关闭菜单。两者均要求终端空闲且没有排队输入。选择通过共享执行器的独占 Session 维护比较已观察的持久 revision，并先持久化，再影响下一轮；冷恢复保留选择。标题显示选定路由和实际推理强度；输入模态与上下文容量来自实际 Provider，未知元数据明确标记。自定义装配缺少任一 Provider 时明确报告控制不可用。

<a id="implementation"></a>
## 实现

<details>
<summary>实现细节</summary>

[启动层](src/native.ts)装配 Ink，[控制器](src/controller.ts)拥有输入队列、恢复与结算。选定的 `sessionExecution` 与 `activeSessions` Provider 传给共享执行器；终端不创建第二个 writer。已完成行来自持久事件，临时流帧只用于展示。[展示库](../terminal-ui/README.zh.md)同时服务兼容终端。未发布 invariant companion：队列与视图没有独立观察者；Session 与 Provider 拥有持久一致性验证。

</details>

<a id="model-experience"></a>
## 模型体验

间接通过[共享原生执行器](../../../Engine/core/native-headless/README.zh.md#model-experience)影响模型；终端不新增提示词、工具或持久事件类型。

#### KV Cache 影响

展示与输入队列不修改已记录的模型请求前缀；执行器拥有缓存相关请求变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 预设与权限选择器、交互审批、Plan／Todo 面板、命令贡献和会话浏览器尚未接入。
- 视图显示最近的消息行，不提供历史滚动；大段流式输出受展示上限约束，完整已接受输出保留在 Session。
- 完整 `native-tui` 模板仍依赖其他模块的原生入口；独立终端证据使用显式文件系统与外部模型 Provider。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
