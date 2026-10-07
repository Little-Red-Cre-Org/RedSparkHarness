---
description: "通过显式原生配置运行可恢复的终端对话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-tui

[English](README.md) | 中文

## 概述

原生终端支持多轮对话、实时输出、扩展斜杠命令和按 profile 安装的 Agent preset。用户可排队输入、停止当前轮次，并恢复同一份持久会话。启动需要交互式终端与显式原生 Provider 装配。

## 目录

- [使用与配置](#configuration)
- [实现](#implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 使用与配置

`./native` 入口由 `dsh --profile native-tui` 装配。它复用[共享执行器的配置](../../../Engine/core/native-headless/README.zh.md#configuration)，并要求 `locale` 为 `en` 或 `zh`、`background` 为 `#rrggbb`，以及正安全整数 `maxQueuedInputs`、`maxHistoryEvents`、`maxTranscriptEvents`、`maxStreamChunks`、`maxPendingHumanRequests`。历史读取超过上限会失败；展示与流式缓存只保留最近的配置条数。

新会话不接受位置参数；`--resume <session-id>` 恢复原会话。Enter 排队。没有人机请求时，Esc 停止当前轮次并发送非空草稿。Ctrl+C 在执行时停止、空闲时退出。`/help`、`/sessions`、`/mode`、`/model`、`/reasoning`、`/clear`、`/retry`、`/exit`、`/quit` 保留为本地控制；`/help` 列出其他已安装命令。即使扩展注册同名命令，本地名称仍优先；不支持的参数会在本地拒绝。其他斜杠输入只交给已安装的命令 Registry，未知名称会报错；斜杠输入不会成为模型消息。`/clear` 仅清理视图。停止会丢弃尚未执行的输入；退出先取消并等待接受的执行清理，再释放 Ink。执行清理拒绝时仍释放 Ink；执行和终端清理同时失败时以 `AggregateError` 保留两者。

内置 Profile 安装 `modelSelection`，由模型适配器提供 `modelDirectory`。`/model` 读取已公布模型及隔离的 Provider 错误；`/reasoning` 读取当前模型的实际推理强度。输入展示的编号提交完整选择，Esc 关闭菜单。两者均要求终端空闲且没有排队输入。选择通过共享执行器的独占 Session 维护比较已观察的持久 revision，并先持久化，再影响下一轮；冷恢复保留选择。标题显示选定路由和实际推理强度；输入模态与上下文容量来自实际 Provider，未知元数据明确标记。自定义装配缺少任一 Provider 时明确报告控制不可用。

工具审批支持 `/allow` 仅允许本次操作或 `/deny` 拒绝；模型问题支持编号单选／多选、无选项时自由文本，或 `/other 文本`。每个请求归确切的活跃 root Session 及其选定 Program 所有。终端只呈现有界 FIFO，并拒绝旧画面的迟到回答；既有执行器记录审批审计和提问工具结果。人机请求期间，Esc 关闭该确切根 Agent epoch 并保留未提交草稿，其他 Consumer 接纳的工作也遵循此规则。执行及 writer 排空前禁止新输入和选择器；后续输入通过新的 Agent epoch 恢复持久历史。清理失败时终端关闭并保留原始错误。退出先撤销待回答输入，再等待执行排空。其他 Program、Session 和委派请求保持原有回答链。提问与审批要求选定对应 Provider；此交互不代表权限预设、策略变更或持久授权。

`/sessions` 在终端空闲且没有排队输入或待回答的人机请求时列出配置工作区内已存储的 Session 标识。输入展示的编号通过既有执行器恢复会话，Esc 关闭菜单。人机请求取消尚未完成的选择器操作并关闭显示的菜单；菜单选择输入不会回答该请求。历史读取成功后才替换对话与模型观察，并清除先前的重试输入；恢复不提交模型请求，后续输入归选定会话所有。持久化 Provider 负责发现，执行器保留 writer 所有权。

应用声明共享执行器的可选 `modelSelection` 服务；配置的 Provider 会将持久化选择用于后续轮次。

内置 `native-tui` profile 安装包含 `standard` 和 `minimal` 常驻装配的 Registry。`standard` 包含 Goal 与 Todo 工具；`minimal` 仅包含 Todo，不含 Goal 工具。自定义 profile 可安装其他由 scope 提供的装配。`/mode` 在首次轮次之前列出选定 Registry。编号选择通过根执行器的持久化修订检查与 Agent 替换；终端只接收元数据和已记录的选择事实。已开始的 Session 拒绝变更，冷恢复后也保持锁定。菜单不提交模型请求。

profile 安装共享 `commands` Provider 和 Goal 命令。`/goal <request>` 通过选定的根 Session owner 记录并运行 Goal 命令；`/goal pause` 可以中断活动模型请求，不必排在被中断轮次之后。命令运行与结果事件会持久记录，命令输入不会加入模型对话。

<a id="implementation"></a>
## 实现

<details>
<summary>实现细节</summary>

[启动层](src/native.ts)装配 Ink，[控制器](src/controller.ts)拥有输入队列、恢复与结算。选定的 `sessionExecution` 与 `activeSessions` Provider 传给共享执行器；终端不创建第二个 writer。命令分发捕获选定 Session，并在模型输入队列之外使用同一执行器，因此命令可以暂停自己正在中断的轮次。已完成行来自持久事件，临时流帧只用于展示。[展示库](../terminal-ui/README.zh.md)同时服务兼容终端。未发布 invariant companion：队列与视图没有独立观察者；Session 与 Provider 拥有持久一致性验证。

</details>

<a id="model-experience"></a>
## 模型体验

间接通过[共享原生执行器](../../../Engine/core/native-headless/README.zh.md#model-experience)与选定常驻装配影响模型。终端本身不新增模型提示词或工具；命令输入记录为命令事件，而不是用户消息。

#### KV Cache 影响

展示与输入队列不修改已记录的模型请求前缀；执行器拥有缓存相关请求变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 内置模板提供 `standard` 与 `minimal` 装配；自定义 profile 必须在预期 scope 中安装 Registry 和每个常驻装配。
- 权限选择器与 Plan／Todo 面板不属于此终端界面。
- Page Up 与 Page Down 使用共享的渲染行估算浏览保留的对话行。发送输入、恢复 Session 或清理视图后回到底部。单条大型消息与流式输出仍受展示限制，完整已接受输出保留在 Session 中。
- 完整 `native-tui` 模板仍依赖其他模块的原生入口；独立终端证据使用显式文件系统与外部模型 Provider。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
