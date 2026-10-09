---
description: "通过标准 ACP 协议驱动持久化的原生 Session。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-acp

[English](README.md) | 中文

## 概述

选择 `dsh --profile native-acp`，即可通过标准 ACP JSON-RPC 标准输入输出创建、发送提示、取消、关闭、列出和恢复持久化的 Session。已提交的助手文本、推理和注册工具生命周期事实转换为有序的 `session/update` 通知。兼容的 `acp` profile 仍是默认 ACP 组合。

## 目录

- [配置](#configuration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

<a id="configuration"></a>

## 配置

Profile 设置 `provider`、`model`、`systemPrompt` 和正整数 `maxSteps`。每个 Session 通过 `session/new` 选择一个已存在的绝对工作目录，同时仅接受一个按顺序排列的文本／图片提示。重叠的提示显式失败。创建返回之前，Engine 通过 root 维护操作持久化空 Session。此操作要求宿主组合安装原生 `activeSessions` Provider；缺少该服务时，安装规划会在激活前拒绝此 profile。恢复检查存储的工作目录与谱系，并在接受后续提示之前重放已提交的展示事件。关闭释放活动执行器并保留存储日志。输入结束和 Host 取消会取消并等待已接收的工作结束；ACP 没有标准的关闭进程请求。

Program 将 `rootExecution` 作为原生 application service 提供。它依据精确附着的 root Agent 和 Session 身份找到所属的 per-Session Engine executor，再通过该 root 的 branded route 分派；maintenance 和 fork 的新目标 ID 无须等于 ACP wire Session ID。route 准入会拒绝 foreign、delegated、released 和 closing root owner。清理期间，`capture` 与 `cancel` 会继续按精确身份解析正在关闭的 owner，使取消能在 Engine detach 之前完成。必需的 `releaseIdle` 操作会委托给所属 Engine；Engine 仅接受已准入动态 Workspace route 上精确且已结算的 owner，ACP 的 per-Session base route 不满足该条件。此 profile 未配置动态 Workspace 准入，因此不提供可选的 `createWorkspaceRoute` 能力。该设计保留每条 route 不可变的 cwd 与执行作用域，并把 root permission 请求投递到所属 ACP wire Session。route 活动时，已安装的 Provider 可以使用 root 操作；关闭 Session 或连接会释放其 executor 和 root。ACP wire 方法提供提示取消与 Session 关闭；settle、maintenance、fork、预设选择和按 route 授权的存储操作仍是内部 service。仅当所选持久化 Provider 支持可恢复删除时才提供该能力。动态 `selectWorkspace` 仍受 Engine 已注册 Workspace 和显式 route 准入配置约束；此 ACP profile 不启用该准入，继续通过标准 ACP `session/new` 与 `session/resume` 选择 cwd。

原生预设组合安装模型适配器、原生 Agent、active Session 与模型执行 Provider、本地文件系统、凭据和 Session 持久化。可通过 profile patch 安装其他原生工具。只有精确的执行取消原因会转换为取消响应；清理失败及无关的执行失败仍作为协议错误上报。

应用声明共享执行器的可选 `modelSelection` 服务，并使用其 Host 编译配置。Session 新建、模型配置、提示执行、精确 root 取消与清理都会使用公开的 `rootExecution` 操作；ACP 提示取消仍保持协议层的轮次取消语义。

新建和恢复的 Session 返回所选模型目录提供的标准 `configOptions`。`session/set_config_option` 接受已公布的不透明模型值与声明的推理档位，通过独占 Session 维护持久化完整选择，并发送 `config_option_update`。提示执行期间收到的请求等待该提示结算，选择用于下一轮；配置待结算时拒绝另一提示。调用方取消会中断排队的发现与修改；关闭和 EOF 会取消并排空已接收的控制操作。缺少目录或选择 Provider 时返回空选项并拒绝修改。目录缺项不会清除当前已记录的路由。

图片提示需要所选附件 Provider 与模型目录。初始化仅在两者均安装时声明图片准入；每次图片提示在同一次根执行准入中检查 Session 下一步选择的模型并准备附件，拒绝未声明图片输入的模型。附件 Provider 校验已配置的位图格式、base64、字节与像素限额，标准化整批图片，并在用户消息准入之前按输入顺序返回持久引用。非法图片不会进入 Session 收件箱。取消与传输结束的清理也覆盖图片准备。

预设审批 Provider 将精确所属根工具调用送到标准 `session/request_permission`，先发送其已提交的工具更新。只有 `allow-once` 允许执行；拒绝、未知选项与取消均不授权。执行器记录每个 asked/decided 对。每个 Session 在关闭和恢复前后仅允许一条未结算的权限传输请求；正整数 `maxPendingPermissions` 限定整个连接的总量（默认 `32`）。容量用尽时后续请求得到 unavailable 决策。取消发送协作式传输取消，并完成 Session 审计结算，不等待忽略取消的对端。旧传输请求由连接持有，直到对端答复或 EOF 关闭连接；迟到答复不能授权执行。连接退出先拒绝并排空这些请求，再释放 Provider。

<a id="dev-note"></a>

安装原生工具后，`session/new` 和 `session/resume` 接受标准 stdio 与 Streamable HTTP MCP 声明。每个 Session 独立拥有传输连接和工具作用域；同级 Session 可复用服务名称，互不暴露工具。ACP 控制端授权绝对命令路径、参数、环境与 Session 工作目录，或带请求头的 HTTP(S) URL。完整列表先通过校验，初次连接和工具发现成功后才发布 Session。启动失败仅释放该待发布组合；关闭 Session 或 EOF 会停止工具准入，并协作排空执行器与连接。MCP 撤销随取消开始。关闭失败会保留已关闭的 Session 记录，拒绝恢复、提示和配置修改；仅清理成功才移除该记录。`mcpToolCallTimeoutMs` 为定时器范围内的正整数，默认 `60000`。MCP 诊断写入 stderr，保留协议 stdout。MCP 资源和提示词不对外提供；不支持的传输类型会被拒绝。

安装 `commands` Provider 后，`session/new` 与 `session/resume` 会使用标准 `available_commands_update` 广告其中的命令。仅包含一条完整已注册斜杠命令（例如 `/compact`）的 `session/prompt` 会在确切 Session root owner 上通过同一 Provider 分派；普通提示文本不变。命令输出使用标准 `session/update` 消息，提示取消会通过其所有信号排空命令。

## 开发备注

[原生 ACP 决策记录](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-acp-session-carrier.zh.md)说明了协议与执行的所有权。本包不发布运行时不变量伴生入口，因为 ACP Session 表将每个协议 Session 与其执行器及 MCP 资源配对，而执行器拥有 Agent 执行和持久 Session 状态；ACP 记录保存传输与资源生命周期及临时控制，不是第二份 Session 投影。

<a id="model-experience"></a>

## 模型体验

### ACP 文本与图片提示

#### 模型看到什么

通过 `session/prompt` 接收的文本、资源链接引用和标准化图片引用进入持久化 Session 收件箱，并通过[原生 Session 执行器](../../../../Engine/core/native-headless/README.zh.md#model-experience)送达模型。资源链接使用兼容承载层的方括号文本，名称与 URI 按 JSON 加引号；相邻文本合并，不抓取资源，并保留文本／图片顺序。持久化模型选择通过所选 Provider 影响后续请求装配；协议配置通知不添加模型输入。

#### Token 影响

提交的文本和模型图片预览在获准执行的步骤以及保留它们的后续步骤中增加输入 token。

#### KV Cache 影响

提交的提示在保留的历史后追加用户内容；此前请求内容保留其顺序。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延后工作

- 音频／嵌入式输入、提问请求和附件展示不属于此承载批次；不支持的提示内容显式失败。初始化声明不支持音频、嵌入上下文。需要这些能力的现有 ACP 客户端在原生对等能力实现之前使用兼容 profile。
