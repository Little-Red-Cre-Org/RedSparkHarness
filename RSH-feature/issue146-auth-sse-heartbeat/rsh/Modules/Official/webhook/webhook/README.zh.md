---
description: "面向注册可信外部事件策略并创建 Workspace 会话的维护者，说明 webhook 规则运行时。"
kind: "package-reference"
---

# @deepseek-ai/dsh-webhook

[English](README.md) | 中文

## 概述

`dsh-webhook` 通过 Cordis `ctx.webhookRuntime` 或显式 Native `./native` Provider 提供受信任的程序化 webhook 规则。两者都公开 `register(rule)` 并分发已验证交付；提供方身份验证属于适配器包。规则可以用 `null` 放弃，也可以请求在准入 Workspace 中创建一个普通根 Session。

## 目录

- [规则接口](#rule-interface)
- [会话请求](#session-request)
- [组合](#composition)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="rule-interface"></a>
## 规则接口

`WebhookRule<K>` 具有带 brand 类型的唯一 `id`、提供方 `kind` 与 `run(delivery, signal)`。回调可以执行任意受信任代码，并返回 `null` 或一个 `WebhookSessionRequest`。Native 会先解析所有匹配回调，再创建任何 Session，因此回调失败不会留下部分 Session 操作。若多个规则都返回请求，Native 会等待每项操作结算；一项失败会导致 HTTP 操作失败，但已被同级规则 inbox 接纳的消息仍然持久存在。

`VerifiedWebhookDelivery` 携带提供方种类、已配置来源 id、提供方交付 id、规范化的无损 JSON 与接收时间。运行时会在共享前快照并冻结完整值。`deliveryId` 仅是来源信息；重复交付会再次运行规则。

注册是一项 effect。它的可等待 disposer 会先隐藏规则，再中止并排空活动回调。回调必须观察所提供的 signal；忽略取消的同进程代码无法被安全强制停止。

<a id="session-request"></a>
## 会话请求

`WebhookSessionRequest` 要求 `workspacePath`、`title`、`prompt`、`agentPreset` 与 `permissionPreset`；可选 `model` 会指定明确的提供方／模型路由与输出 token 上限。Native 会先按所选 root 的规范 allowed roots 与 sandbox policy 验证路径，再创建或复用持久 Workspace 元数据。Agent preset、permission preset、标题及显式模型选择会作用于真实 Session 和普通 root execution。未指定模型时使用所选 route 的常规模型选择默认值。

Native 通过所选 Program 的 root maintenance 与 execution 操作创建 Session，再将其附加到 Workspace，并持久入队普通 user 消息。消息带有 `source.kind: "webhook"` 及提供方、来源、交付与规则来源信息。持久 inbox-spliced 事件是接纳提交点；Native 的 `202` 等待该事件，而不等待模型完成。之后 Program 会结算轮次、释放确切闲置 Agent 与临时 route，并保留持久 Session 历史和 Workspace 关联。inbox 接纳前失败时，会排空本次新建 execution 并可恢复地删除 Session；已成功创建的 Workspace 记录可以保留。

Cordis compatibility Provider 保留现有 `Agent.followup()` 提交点和进程内 fire-and-forget 行为；它不会增加 Native Agent 或 Session authority。

<a id="composition"></a>
## 组合

Cordis Provider 在 Web Host plane 上加载于 Agents、模型默认值、agent presets、permission presets、标题与 Workspace 注册表之后。用户编写的规则插件注入 `webhookRuntime`，并通过自己的 effect 交出 `register()` 返回的 disposer。Native composition 使用 `@deepseek-ai/dsh-webhook/native`，要求所选 `rootExecution`、Workspace registry、Agent preset 与 permission preset Provider、可恢复 Session deletion，并在该 root 上启用动态 `workspaceRoutes`。显式模型请求还要求 model selection 和 model directory Provider。

包根入口是 Cordis compatibility Provider。只有 Cordis 和仅供旧 Agent 兼容入口使用的 helper peers 标记为 optional；Cordis profile 必须提供它们，仓库 CLI profile 已显式声明这些 peers。Native runtime 与公开声明所需 peers 在 package 层仍为必需，其中也包括仅用于类型的 peers。`dsh.native` 的 service `requires` 与 `optional` 分别描述 Provider 能力，不改变 package 安装依赖。Native consumer 可在不安装 Cordis 的情况下导入中立 `./definition` 契约；导入 `./native` 的 consumer 必须安装该入口声明的 peers。缺少必需 peer 时会在模块解析阶段失败。Native Web 在配置动态 Workspace 创建的 root 上支持完整规则到 Session 的路径。当前 SDK facade 未公开该创建能力，因此 Native Provider 会在安装时拒绝该组合；ACP facade 支持仍待其独立集成完成。

[GitHub 评审指南](../../../../Docs/user/guide/github-review.zh.md)展示了规则模块、专用入口端口、密钥设置与 Workspace 路由。

<a id="model-experience"></a>
## 模型体验

### 规则编写的初始提示词

#### 模型看到的内容

每个匹配规则都会让模型看到 `WebhookSessionRequest.prompt` 返回的非空文本原文。通用运行时不增加私有框架；若规则包含外部文本，则由规则负责标明其信任属性。随附 GitHub 示例会把选定 PR 字段标为不受信任的 JSON 元数据。

#### Token 影响

一条依赖数据的 user-role 消息保留在新会话中，并持续贡献 token，直到普通压缩（compaction）替换或移除该历史。

#### KV Cache 影响

初始提示词开启一个新会话，因此它建立而不是使该会话的可复用请求前缀失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限进程内 fire-and-forget** — 崩溃会丢失尚未接纳提示词的规则调用；不存在队列、回放或重试。
- **无内置去重** — 提供方重复交付可能创建重复会话；需要幂等性的规则自行负责。
- **不确认执行完成** — Native `202` 表示每个非 null 规则动作都已被持久 inbox 接纳，不表示模型执行完成。多规则失败可能发生在同级动作已接纳之后；已接纳消息仍然持久存在。
- **受信任回调必须配合取消** — 运行时 teardown 会中止并等待回调，但无法终止任意同进程代码。
- **Workspace 元数据持久存在** — 规范路径和 policy 准入后，Workspace 创建就是持久提交；之后 Session 准备或接纳失败时记录仍可能保留。临时 route、Agent、observer、writer 与 Workspace attachment 仍会分别排空。
- **profile capability 明确** — 当前 Native Web composition 支持完整 Session 请求。SDK 暂缺 root 动态 Workspace 创建能力，ACP 集成待完成；Native Provider 缺少所需 route 操作时会拒绝安装。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
