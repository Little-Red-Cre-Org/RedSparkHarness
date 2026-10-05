---
description: "面向客户端与服务端实现者的 SDK 协议格式（wire format）说明：Harness 运行时与其 SDK 客户端之间使用的按换行分帧 JSON-RPC 传输，以及具名的请求、结果与通知类型。"
kind: "package-library"
---

# @deepseek-ai/dsh-sdk-protocol

[English](README.md) | 中文

## 概述

`dsh-sdk-protocol` 定义 Harness 运行时与 SDK 客户端共用的具名请求、结果和通知类型，并从 [Core](../../../../Core/util/json-rpc-line/README.zh.md) 重新导出 JSON-RPC 行传输。服务端是 [`dsh-sdk-jsonrpc-server`](../server/README.zh.md) 插件；客户端是 TypeScript 的 [`dsh-sdk-client`](../client/README.zh.md) 与 [Python SDK](../../python/README.zh.md)（后者复现这些类型但不导入它们）。实现或调试 SDK 协议端时使用本库；它不注册插件或配置。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当你构建或调试 SDK 协议端——服务插件、客户端库或使用该协议的自定义工具——时使用本包。它为你提供一个在调用方持有的字节流上承载 JSON-RPC 2.0 的传输，以及每个 SDK 方法与通知的类型化结构。

### 分帧与传输

[Core 传输库](../../../../Core/util/json-rpc-line/README.zh.md)负责换行分帧、请求关联、错误映射、监听器挂接与关闭。本包重新导出其类，让现有 SDK 客户端与服务端共用同一个传输类。

### SDK 方法

兼容 profile 提供原有三个请求方法与四个通知。native-sdk profile 还提供按 Session 取消与实时模型分块。

| 方向 | 方法 | 载荷类型 |
|---|---|---|
| client→server | `initialize` | `InitializeParams` → `InitializeResult` |
| client→server | `session/prompt` | `SessionPromptParams` → `SessionPromptResult`（持久入队回执） |
| 客户端→服务端 | `session/cancel` | `SessionCancelParams` → `SessionCancelResult`（仅 native-sdk） |
| client→server | `shutdown` | 无参数 → `{}` |
| 服务端→客户端 | `session.chunk` | `SessionChunkNotification`（native-sdk 实时模型投影） |
| server→client | `session.event` | `SessionEventNotification`（运行时内每个会话，不过滤） |
| server→client | `session.status` | `SessionStatusNotification`（整个 agent（智能体）的 `running`/`idle` 转换） |
| server→client | `subagent.started` | `SubagentStartedNotification` |
| server→client | `subagent.finished` | `SubagentFinishedNotification`（仅进程内运行） |

`HarnessSdkRequestMap` 与 `HarnessSdkNotificationMap` 按方法名索引这些结构；包根与传输一起导出它们。

### 载荷语义

`SessionPromptResult.messageId` 标识已排队的用户消息；它不标识后续的助手消息、轮次结束或提示词结果。`SdkPromptContentBlock` 接受普通持久内容以及 `SdkEncodedImageBlock { type: "image", data, mimeType }`；服务器在入队前把编码图像转换为持久引用。`InitializeParams.reasoningEffort` 是所选提供方／模型路由可选的非空适配器自有标识符；省略时保留该模型的默认值。`InitializeParams.maxTokens` 是可选的正安全整数，用于限制 SDK 创建的 agent 及其进程内后代的每次对话模型输出；省略时应用所选适配器的确切模型默认值。服务器会在初始化期间解析确切路由，并在握手成功前拒绝 `session/prompt`，因此缺少适配器、模型不可用或推理强度不受支持时，不会回退到构造期默认值。`SubagentFinishedNotification.lastAssistantMessage` 携带子 agent 最后一条非空 assistant 消息；若不存在这类消息，则携带其累积的 assistant 文本；子 agent 两种输出均未产生时，该字段缺省。`serverInfo.name` 的协议值固定为 `deepseek-harness-sdk-runtime`。通知载荷依赖 `SessionEvent`（`dsh-session`）、`ContentBlock`（`dsh-llm`）与 `SubagentStopReason`（`dsh-subagent`），因此会话词汇是协议格式约定的一部分。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释协议库背后的设计；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

本包采用一种职责分离设计：两个协议端共用一个按换行分帧的传输类，并以具名类型索引协议方法。包根是唯一的导入面——源模块不支持深层导入。它是没有插件、配置或注册的纯库；服务插件与客户端负责其周围的一切行为。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/transport.ts`](src/transport.ts) | 从 Core 重新导出 JSON-RPC 行传输 |
| [`src/types.ts`](src/types.ts) | 具名请求/结果与通知载荷类型，按方法索引 |
| [`src/index.ts`](src/index.ts) | 消费方接口：传输与具名协议类型 |
| — | 不发布运行时不变式伴生入口；SDK 方法与载荷是类型声明，共用传输的待完成请求状态由 Core 库自身管理。 |

### 帧分发

帧分发由 [Core 传输库](../../../../Core/util/json-rpc-line/README.zh.md)负责并测试；SDK 协议只增加具名方法和载荷类型。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当协议约定不够用时阅读以下页面。它们从服务插件进入客户端与可运行应用。

- [JSON-RPC 服务插件](../server/README.zh.md) — 通过 stdio 服务该协议的运行时插件。
- [TypeScript SDK 客户端](../client/README.zh.md) — 驱动该协议的客户端。
- [Python SDK](../../python/README.zh.md) — 复现这些结构的 Python 对应实现。
- [SDK 应用组合包](../../../../Compatibility/DSH/bundle/sdk-app/README.zh.md) — 启动服务器的 `dsh --profile sdk` 应用。

-----

<a id="model-experience"></a>
## 模型体验

无，因为这是面向客户端的协议库；模型可见行为归对外服务入口后方的运行时插件所有。

#### KV Cache 影响

无；此包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明协议未覆盖或未承诺的内容。它们是当前包约束，不是与其他协议格式的对比或任务积压。

- **无协议版本协商**——握手只携带 `serverInfo.version`（`0.0.1`，客户端不校验）；处于预发布阶段，无兼容承诺。
- **无取消与会话关闭方法**——客户端放弃轮次的方式是关闭运行时进程；见 [JSON-RPC 服务插件](../server/README.zh.md)。
- **server→client 请求是未使用的能力**——传输层支持，但服务器从不发送；Python SDK 的应答接口为未来审批流程预留。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文，明确不具权威性——已交付的行为与限制见上文各节与代码。本协议的各个结构由 Python SDK 复现（而非导入），因此在这里更改方法、载荷或协议稳定值 `serverInfo.name` 时，必须在同一次变更中更新 Python 对侧与 TypeScript 客户端。没有记录其他未解决的开放设计问题。

</details>
