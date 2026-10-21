---
description: "面向以子进程方式启动 DeepSeek Harness 运行时、并通过 stdio JSON-RPC 驱动 agent（智能体）轮次的调用方的 TypeScript SDK 客户端：DeepSeekHarness 运行 API 与低层 HarnessClient。"
kind: "package-library"
---

# @deepseek-ai/dsh-sdk-client

[English](README.md) | 中文

## 概述

`dsh-sdk-client` 让 TypeScript 程序通过 stdio JSON-RPC 启动 Harness runtime 并驱动 Agent 轮次。`DeepSeekHarness` 可打开 Session、发送文本或图像提示词、推送通知流，并在 Agent 空闲后返回最后提交的 root 响应；`HarnessClient` 提供底层协议请求与订阅。客户端默认解析同版本 `@deepseek-ai/dsh` 可执行文件，也可通过 `dshBin` 指定。客户端跨多次运行持有子进程，并在 `close()` 或 `await using` 时回收；调用方可选择 profile 和启动设置。

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

native-sdk 配置组合生产的进程内子代理工具。Session 树订阅收到已接受的子事件及真实 `subagent.finished` 结果，覆盖一次性任务的完成、取消、失败和可持续驻留阶段结束；仅打断某一轮不会结束仍驻留的子任务，运行结果仍只投影根响应。后台子任务在真实就绪后返回 Jobs 句柄，并跨普通父回合继续执行；job_output/job_kill 提供输出与取消控制。配置安装 send_message 与 interrupt_agent；把 subagent 工具的 backgroundMode 设为 continuable 可准入持久子任务、后续引导和打断，并在进程重启后冷恢复同一子任务。可续接子任务实际清理完成后，会把持久 subagent-settled 通知加入父任务的下一个 turn。SDK wire 目录发现仍不支持；profile 的模型可见 `list_agents` 工具是独立能力。

当 TypeScript 代码需要从另一进程驱动完整 Harness 运行时、且你能显式指名运行时可执行文件时，使用本客户端。常用路径极简：用启动规格构造 `DeepSeekHarness`，运行提示词，然后关闭它，使子进程总能被回收。

### 用 DeepSeekHarness 运行 agent 轮次

```ts
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/native'

await using harness = new DeepSeekHarness({
  profile: 'sdk',
  patches: ['./automation.cordis.yml'],
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  reasoningEffort: ReasoningEffortId('max'),
  maxTokens: 49_152,
})
const result = await harness.run('say hi')
console.log(result.finalResponse)
```

子进程在首次使用时惰性启动，并在多次 `run()` 调用之间持续归实例所有；请调用 `close()`（或使用 `await using`），子进程才总能被回收。`start()` 会记忆化有界的 `initialize` 握手，其中包含工作区 cwd、提供方／模型路由、可选且由适配器持有的 `reasoningEffort`，以及可选的正整数 `maxTokens` 输出上限。Native SDK 还接受可选的 `maxSteps`；握手必须返回不大于请求值的正有效上限。兼容 Cordis runtime 会明确拒绝这个 Native 专属字段。服务器会在接受提示词前校验该确切路由；省略推理强度时保留模型自身的默认值。`initializeTimeoutMs` 默认 30 秒，为冷启动时完整 profile 就绪握手留出时间；诊断会写明所选 profile 并附带保留的 stderr 尾部。`run(input, { sessionId?, onNotification? })` 接受文本或 `SdkPromptContentBlock[]`；内联栅格图像块携带规范 base64 与 `mimeType`，并在运行时内变成持久附件。该调用拥有一个活动区间：它将提示词排入队列，等待其消息 id 出现在持久入队回执中，然后持续收集到整个 agent 下一次进入 `idle`。它返回 `RunResult { sessionId, finalResponse, events, notifications }`，其中 `finalResponse` 是该区间内根会话最后提交的助手文本——并非因果上归属于该提示词的响应，因为 steering（中途引导）、注入的上下文和其他排队工作都可能在 idle 前参与其中。`session(id?)` 打开具名或全新的会话句柄。握手失败且清理成功时，实例会换入全新客户端，使后续调用用新进程重试，直到终结性的 `close()`；如果初始化和清理均失败，`start()` 会返回保留两个原因的有序 `AggregateError`，并继续保留失败的客户端，避免在原进程退出尚未得到证明时启动另一个进程。`maxTokens` 限制每个根 agent 请求的输出量，并由进程内后代继承；压缩（compaction）插件单独持有摘要上限。

### Native Host 子进程传输

`HarnessClientOptions.onApprovalRequest` 通过 `(request, signal) => outcome` 处理 Native approval 问题。返回值可为 `allowed-once`、`rejected`、`cancelled` 或 `unavailable`；省略回调时会以 `unavailable` 关闭处理。关闭 client 或取消 parent 请求会中止 signal。回调迟到的结果会被忽略，runtime 会对该请求回复 `cancelled`。

`@deepseek-ai/dsh-sdk-client/native` 为 Native Module 提供 `createNativeDeepSeekHarness(options, childConnection)`。它把 profile 固定为 `native-sdk`，仍解析同版本标准 `dsh` launcher。其 `NativeDeepSeekHarnessOptions` 不包含 `dshBin`、`profile` 或 `patches`；注入的 `childConnection` 只提供 Host 所有的受管 stdio 与完整进程范围清理能力，不用于任意可执行文件或 argv 选择。唯一的 provider-neutral SDK 协议/runtime 实现在 [Engine](../../../../Engine/subagent/sdk-runtime/README.zh.md)；此 Program facade 保留公开 TypeScript API 与唯一的标准 CLI resolver。

可选的 `dsh-sdk-child` Module 会快照所选提供方配置与父 Session 实际启用的 Native Headless 内建文件权限。只有确切的父级 `write_file` 权限、`approvalRequired`、workspace-write 根，以及绑定当前 parent owner 与 turn 的 `dsh-sdk` driver callback 同时存在时，child 才获得 `write_file`；缺少该 authority 时不能新增 writer。只有这一真实 relay 组合会在私有 child profile 中安装 `ask` 策略的 Native Approval。请求、取消与单次决策都会返回既有 parent approval authority，并由它作为唯一的持久 approval 事件写入者。child 使用共享 sandbox policy 与 process-sandbox backend；backend 仍允许其临时目录语义，Windows enforcement 在适用时为 partial（部分）。profile 是 opt-in，不改变标准 `native-sdk`。

### 用 HarnessClient 做低层控制

`HarnessClient` 是运行 API 之下的协议客户端：显式 `start()`、`initialize()`、`prompt()`、`request()` 与 `close()`，外加通知订阅。`prompt()` 在运行时接受排队消息后立即返回该消息的 id，绝不等待 agent 活动。`subscribe(filter?)` 返回 `NotificationSubscription`（可等待的 `next()`、非阻塞 `tryNext()`、异步迭代）；`subscribeSessionTree(id)` 把范围限定到一个会话及从 `subagent.started` 血缘边发现的后代——所选运行时决定公布哪些 Session，范围限定在客户端完成，与 Python SDK 完全一致。

本客户端为每种失败模式导出类型化错误：`JsonRpcResponseError`（协议错误响应，保留 code 与 data）、`RequestTimeoutError`（配置的时限已到）、`SdkProtocolError`（响应超出文档化协议）、`TransportClosedError`（运行时已消失——消息携带退出码与有界 stderr 尾部）。`close()` 先请求协议 `shutdown` 并刷新协议写入（两者均受 `shutdownTimeoutMs` 约束，默认 1000 毫秒），然后关闭 stdin 并等待共用 Provider 确认其管理的进程范围已释放；刷新失败会保留在诊断中，同时继续清理。Provider 负责平台相关的 TERM/KILL 升级。客户端关闭幂等，关闭后拒绝复用。给出 `HarnessClientOptions.env` 时它提供完整的 SDK 子进程环境（`undefined` 则快照父进程环境）；SDK 明确选择完整替换语义，而 Core 默认仍是擦除后的环境叠加。在 Windows 上，标准启动器仅在调用方未提供时补入宿主 `SystemRoot`（原生进程启动所需），不会继承父进程的其他变量。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释客户端背后的设计；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

客户端是同一协议上的两层：`DeepSeekHarness`（自有运行）叠加在 `HarnessClient`（协议客户端）之上，与 Python SDK 的分层一致。它运行在任何 harness 上下文之外，使用框架无关的本地 `dsh-subprocess` 连接 Provider，无需挂载 NativeHost 或 Cordis。所选运行时决定公布哪些 Session；会话树范围限定是客户端对 `subagent.started` 血缘边的过滤。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/api.ts`](src/api.ts) | Program facade：标准 launcher 与向后兼容的 `DeepSeekHarness` 导出 |
| [`src/client.ts`](src/client.ts) | Program facade：同版本 `dsh` 解析与本地进程适配器 |
| [`src/native-launcher.ts`](src/native-launcher.ts) | 固定 Native child launcher：提供方 overlay、父 sandbox policy 与私有 home 清理 |
| [`src/native.ts`](src/native.ts) | Native Host 固定 child launcher 导出 |
| Engine [`sdk-runtime`](../../../../Engine/subagent/sdk-runtime/README.zh.md) | 唯一的 `HarnessClient`、`DeepSeekHarness` 与 provider-neutral SDK 协议 runtime 实现 |
| — | 本包不发布 runtime invariant companion，因为它是在调用方进程中运行的 SDK client library，而非 runtime plugin；公开 SDK API 覆盖其 launcher 与 connection 生命周期。 |

### 自有活动流程

一次运行会订阅会话树、把提示词排入队列，等待提示词的消息 id 出现在持久的 `agent/inbox/spliced` 回执中，然后持续收集通知，直到整个 agent 报告 `idle`。`finalResponse` 从收集到的事件中最后一条 `assistant/message` 派生。传输丢失、超时与协议违例会使本次运行被拒绝；模型结果仍可在事件流中观察，但不会归属于某一输入。

### 错误与关闭

每种失败模式都映射到一个导出的错误类——协议错误响应、请求时限已到、响应超出文档化协议、运行时死亡——调用方可以按失败类型分支处理；这四个类从 [src/index.ts](src/index.ts) 导出。关闭使用 Core 的 child-connection disposal 和所选 Provider 的进程范围观察，并在 stdin EOF 等待前刷新协议输出。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当客户端约定不够用时阅读以下页面。它们从协议格式进入服务插件与使用本客户端的应用。

- [SDK 协议格式](../../../../Engine/subagent/sdk-protocol/README.zh.md)——本客户端使用的 JSON-RPC 方法与载荷结构。
- [JSON-RPC 服务插件](../server/README.zh.md)——服务本客户端的运行时插件。
- [Python SDK](../../python/README.zh.md) — 共享同一运行时对端与协议的设计孪生。
- [SDK subagent 后端](../../../../Compatibility/DSH/subagent/subagent-dsh-sdk/README.zh.md) — harness 内部消费本客户端的例子。
- [SDK 应用组合包](../../../../Compatibility/DSH/bundle/sdk-app/README.zh.md) — 本客户端启动的 `dsh --profile sdk` 运行时应用。

-----

<a id="model-experience"></a>

显式选择 `profile: "native-sdk"` 后，`HarnessSession.cancel()` 与 `HarnessClient.cancel(sessionId)` 等待已接收轮次取消；无活动轮次时返回 false。`onNotification` 在持久化助手事件之前接收实时 `session.chunk` 通知。兼容 profile 拒绝此原生专属取消方法。

显式选择 `profile: "native-sdk"` 后，`run` 还接受与文本混合的编码栅格图片块（`{ type: "image", data, mimeType }`）；原生附件 Provider 负责校验与持久化存储。

`HarnessSession.steer(input)` 与 `HarnessClient.steer(sessionId, contentBlocks)` 为活动 native-sdk 根任务持久化下一步输入。返回消息 ID 时不等待模型答案，也不取消当前派发。turn 中断后若 root 已暂停，steer 会唤醒它；显式重新启用之前，Goal 工作仍保持关闭。空闲或未知 Session 及兼容 profile 拒绝该请求。

`HarnessSession.fork(destinationSessionId, atSeq?)` 返回新的 native-sdk 句柄，其下一次运行恢复复制历史；`HarnessClient.fork` 提供协议回执。[原生服务端参考](../native-server/README.zh.md#configuration)定义源、工作区与已结束轮次的准入。

## 模型体验

无，因为这是客户端进程库；模型可见行为存在于所 spawn 运行时组合的插件中。

#### KV Cache 影响

客户端进程中无影响。子进程的 profile、patch、提供方、模型与历史决定缓存复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明本客户端何时不合适或需要特别注意。它们是当前包约束，不是与其他 SDK 客户端的对比或任务积压。

- **无捆绑运行时解析**——客户端解析同版本 `@deepseek-ai/dsh` 包（或调用方提供的 `dshBin`）；打包可执行文件的发现留在 Python 侧，直到出现 TypeScript 发行版消费方。
- **兼容 profile 的取消限制**——兼容 profile 没有提示词取消方法；放弃其轮次意味着关闭运行时（见[协议限制](../../../../Engine/subagent/sdk-protocol/README.zh.md#known-limitations-and-deferred-work)）。
- **没有逐提示词结果**——低层 `prompt()` 只返回入队回执；高层 `run()` 负责从回执到 idle 的收集。
- **没有通用的服务端主动请求 API**——唯一映射的请求是 Native `approval/request`，仅供明确绑定的 SDK child approval relay 使用；标准 `native-sdk` 不安装该 relay。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文，明确不具权威性——已交付的行为与限制见上文各节与代码。启动规格有意保持完全显式：在出现 TypeScript 发行版消费方之前，不计划做捆绑运行时解析。请让关闭阶梯与错误词汇与驱动同一运行时的 Python 客户端保持同步。没有记录其他未解决的开放设计问题。

</details>
