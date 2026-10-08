---
description: "由 Engine 所有的 provider-neutral TypeScript SDK 协议 runtime 与 Session API，供公开 Program facade 和 Native SDK child adapter 共用。"
kind: "package-library"
---

# @deepseek-ai/dsh-sdk-runtime

[English](README.md) | 中文

## 概述

`dsh-sdk-runtime` 所有唯一一份 Harness SDK wire client 与高层 Session API 的 TypeScript 实现。它通过一个受管 child connection 运行，不选择可执行文件，也不组装产品 profile。公开的 [`dsh-sdk-client`](../../../Programs/SDK/packages/client/README.zh.md) facade 保留调用方 API 并提供同版本 `dsh` launcher；Native Module 通过该 Program 提供的固定 launcher capability 使用 runtime。

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

本包导出共用的 `HarnessClient`、`DeepSeekHarness`、Session handle、结果与通知类型，以及 Native child Module 使用的 runtime seam。它依赖具名的 [SDK wire protocol](../sdk-protocol/README.zh.md) 和 Core `ChildConnection`；native 入口只向 Native Host 类型面增加 `sdkChildRuntimeLauncher` service contract。launcher 仍由 Programs 实现，因此 Engine 包既不查找 `dsh`，也不接受调用方控制的 argv。

`createNativeSdkChildHarness` 将相同客户端实现绑定到 Program 选定的 runtime 与受管连接。运行在提示词前完成 protocol initialize 握手；若请求 `maxSteps`，Native server 必须协商出不高于请求值的正有效值。`maxTokens` 保持每次模型输出上限语义。Session cancel、steer、fork、通知订阅、EOF 处理与受管进程范围释放均复用同一实现。

<a id="understand-the-implementation"></a>

## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/api.ts`](src/api.ts) | 高层运行与 Session API；Native child 组合辅助函数 |
| [`src/client.ts`](src/client.ts) | JSON-RPC client、握手、订阅与受管 child 清理 |
| [`src/native.ts`](src/native.ts) | Engine 所有的 Program launcher capability contract |
| [`src/types.ts`](src/types.ts) | 共用 runtime 与调用方选项类型 |
| [`src/index.ts`](src/index.ts) | 包导出面 |
| — | 本包不发布 runtime invariant companion，因为它公开的是 provider-neutral SDK client API，而非 plugin 注册；其生命周期约定通过该 API 验证。 |

普通调用方 API 与可执行文件解析仍归 [Programs SDK](../../../Programs/SDK/packages/client/README.zh.md)。Engine runtime 不含另一套 agent loop；所选 Native server 将工作路由到既有 Native Session executor。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [SDK wire protocol](../sdk-protocol/README.zh.md)——共享请求、结果与通知。
- [公开 TypeScript SDK facade](../../../Programs/SDK/packages/client/README.zh.md)——受支持的调用方入口与固定 launcher 行为。
- [Native SDK child Module](../../../Modules/Official/subagent/sdk-child/README.zh.md)——可选委派适配器及权限边界。

-----

<a id="model-experience"></a>
## 模型体验

间接影响：由所选 runtime server 组装模型请求并记录对应 Session 事件。

#### KV Cache 影响

每个 child Session 都有自己的请求历史；本传输不改变请求前缀或提供方 cache 复用。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延期工作

- **本包不内置审批 UI 或策略**——TypeScript 调用方通过 `onApprovalRequest` 提供 handler；省略时以 `unavailable` 失败关闭，handler 会收到用于取消与关闭的 abort signal。
- **本包不提供产品 launcher**——可执行文件解析与固定 profile 组装按设计归 Programs。
- **不声称真实 catalog 或凭据验证**——受控协议 fixture 不能证明用户提供方登录、订阅 catalog 或网络推理。

<a id="dev-note"></a>
### 开发备注

公开包名仍为 `@deepseek-ai/dsh-sdk-runtime` 与 `@deepseek-ai/dsh-sdk-client`；迁移共享实现不会增加第二套 transport，也不会改变调用方的 Program facade。
