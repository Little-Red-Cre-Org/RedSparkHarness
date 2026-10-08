---
description: "Native Subagent 适配器：使用标准 dsh Native SDK profile 与 Host 受管 stdio 连接运行子任务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-sdk-child

[English](README.md) | 中文

## 概述

此 Native Module 提供 `dsh-sdk` 外部 Subagent 路由。每个已准入的子任务都会通过 Program 提供的固定 launcher 与 Host 所有的受管 stdio 连接使用 Engine 所有的公开 SDK 传输。Native Subagent 仍唯一负责准入、谱系、结果发布和父 writer；所选 Native SDK server 使用现有单一 Headless step loop。

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

使用显式的 `native-sdk-dsh-child` profile 选择该能力。现有 `native-sdk` profile 及其 `spawn` 默认不变。这个 profile 选择 sandbox 文件系统、Native sandbox policy 和本地进程沙箱 Provider，再挂载本 Module 与固定 launcher carrier。launcher 在操作系统临时目录中创建随机的新 DSH_HOME；只有托管进程范围确认静止后才删除这个精确目录。它只把所选 pi-ai 提供方配置复制到该 home。子进程通过 Host 凭据 Provider 解析所选凭据；不会整份继承父环境，也不会读取已存储的 OAuth/API-key 记录。被选配置必须显式声明 `apiKeyEnv`。

子进程使用父 Session 的确切 cwd。模型可见文件权限只来自父 Native Headless 内建工具；同名自定义 Plugin 工具不会授予 child 内建能力。child 读取仍限制在 cwd。只有父快照授予 `write_file`、父级要求审批、快照提供 workspace-write 根，且 `dsh-sdk` driver 持有绑定已准入 owner、epoch 与 turn 的审批 callback 时，child 才能获得 `write_file`。固定 launcher 只在这个私有 child 组合中安装 `ask` 策略的 Native Approval。child 请求按 operation、request、Session 与 tool-call 身份关联；仅 parent authority 写入 asked／decided 事件并可返回 `allowed-once`。取消或 owner 退役会排空 relay，并拒绝迟到决策。进程沙箱另行限制文件副作用；backend 仍具有文档所述临时目录语义，Windows enforcement 在适用时报告为 partial（部分），不能称作完整 OS 边界。

SDK 入口只接受工作区、提供方／模型／推理路由、每次请求的 `maxTokens`、父级 `maxSteps` 和确切获授的内建文件工具。Program 所有的 launcher 用固定 `--profile native-sdk` 解析同版本标准 `dsh` 包；Module 与公开 Host adapter 均不能选择任意 executable、argv、profile 或 patch。注入的 launcher 和 `childConnection` 是固定启动与受管传输／生命周期能力，不是命令逃逸口。

<a id="understand-the-implementation"></a>
## 理解实现

本适配器将一个已准入的 Native 外部子任务请求映射为 child SDK Session。SDK 握手协商出 `maxSteps` 后即报告就绪；所选 server 会将其限制到 profile 上限，并由 Headless loop 在后续 turn 执行时强制该上限。`maxTokens` 限制每次 child 模型请求。Module 返回 child 的 `result` promise 与 `dispose` 函数；结果可能先于 dispose 完成而结算。Native Subagent Provider 会等待结果与受管进程清理完成，再持久化并发布终态事实／结果。Native Subagent 拥有准入、谱系、父 Session 写入和终态发布；[共用 SDK runtime](../../../../Engine/subagent/sdk-runtime/README.zh.md) 拥有协议 client。

本适配器不发布 runtime invariant companion，因为其按请求运行的生命周期没有独立运行时观测；Native Subagent 拥有准入、谱系、父 Session 写入和终态发布，child server 则拥有持久 Session 事件。

<a id="further-exploration"></a>
## 进一步探索

- [Subagent 子系统](../../../../Docs/subsystems/subagent.zh.md)——共享准入与生命周期归属。
- [共用 SDK runtime](../../../../Engine/subagent/sdk-runtime/README.zh.md)——协议 client 与 Session API。
- [Agent Note](../../../../../.agents/notes/implemented/architecture/2026-10-08-native-sdk-external-child-runtime.zh.md)——launcher 与权限决策。

<a id="model-experience"></a>
## 模型体验

间接影响：所选 Native SDK server 根据委派提示与获授工具组装 child 请求，并记录 child Session。

#### KV Cache 影响

每个 child Session 都有独立的请求历史；本适配器不改变提供方的 cache 行为。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

这些约束决定本适配器可运行哪些外部子任务请求，以及 child 获得多少权限。

- **提示内容**——支持文本和持久图像引用；其他内容块会在启动前拒绝。
- **Subagent 能力**——不支持 persona、工具过滤透传和结构化输出，因此 profile 会拒绝这些请求，也无法运行 Ralph。
- **凭据**——所选提供方配置必须声明 `apiKeyEnv`；不支持继承已存储 OAuth/API-key 记录或完整父环境。
- **写入权限**——只有精确父级授权、审批要求、workspace-write 根和绑定的审批 callback 同时存在时才启用 `write_file`。
- **进程隔离**——backend 保留临时目录例外；适用时 Windows enforcement 为 partial（部分）。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

Engine runtime 拥有唯一 provider-neutral SDK 协议实现；Programs 保留公开 SDK facade 与固定 CLI resolver。TypeScript 与 Python SDK client 均公开服务端到客户端的 approval request 与关联决策。parent Native Headless owner 仍是唯一审批 authority 与持久事件写入者。所有权决策见 [Agent Note](../../../../../.agents/notes/implemented/architecture/2026-10-08-native-sdk-external-child-runtime.zh.md)。

</details>
