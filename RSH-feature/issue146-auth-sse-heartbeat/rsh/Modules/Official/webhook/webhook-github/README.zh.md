---
description: "面向把已认证 JSON 事件路由到 webhook 运行时的部署，说明带签名的 GitHub webhook 适配器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-webhook-github

[English](README.md) | 中文

## 概述

`dsh-webhook-github` 基于同一份原始 body HMAC 验证逻辑提供两个可选入口。Cordis entry 注册在 `ctx.webServer` 上，经 `ctx.webhookRuntime` 分发，并在内存分发后返回 `202`。显式 Native entry 注册到所选 Native HTTP listener，经受信任的 `WebhookRule` 回调分发，并仅在每个非 null 会话请求的 inbox 消息均已持久接纳后才返回 `202`。请根据当前 runtime 与其接纳约定选择入口。

## 目录

- [配置](#configuration)
- [HTTP 约定](#http-contract)
- [Native ingress](#native-ingress)
- [专用监听器组合](#dedicated-listener-composition)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="configuration"></a>
## 配置

| Key | 含义 |
|---|---|
| `source` | 携带给 Cordis 规则或 Native webhook 来源信息的非空适配器实例，例如 `primary-github`。 |
| `path` | 不带尾随斜杠、查询或片段的精确非根路径。 |
| `secretEnv` | 包含 GitHub webhook 密钥的凭据引用。 |
| `maxBodyBytes` | 未改动请求 body 的正安全整数上限。 |
| `rootRoute` | Native 专用：由 `rootExecution` 选择的配置 base route id；每条规则请求的 Workspace 会在此 route 下单独准入。 |

Cordis entry 要求前四个字段；Native entry 还要求 `rootRoute`。每次请求都会重新解析密钥引用，因此轮换会在下一次交付生效，而无需重新加载插件。

<a id="http-contract"></a>
## HTTP 约定

只接受 `POST application/json`。适配器读取有界 UTF-8 body，要求 `X-Hub-Signature-256`、`X-GitHub-Delivery` 与 `X-GitHub-Event`，解析密钥，在 JSON 解析前验证 HMAC，并要求顶层是无损 JSON 对象。它绝不记录密钥、签名或 payload。

| 状态 | 含义 |
|---|---|
| `202` | Cordis：已验证 JSON 已在内存中分发。Native：匹配规则均已结束，每条非 null 会话请求都已到达关联的持久 `agent/inbox/spliced` 事件。返回 `null` 或没有匹配规则不会创建 Session，也不会调用模型。 |
| `400` | 必需 header、UTF-8、JSON 或顶层对象无效。 |
| `401` | 签名无效。 |
| `405` | 方法不是 `POST`。 |
| `413` | 声明或流式 body 超过 `maxBodyBytes`。 |
| `415` | media type 不是 `application/json`。 |
| `503` | 凭据、所选 runtime、Workspace 准入、规则执行或 inbox 接纳前的 Session 操作失败。多规则交付中其他操作可能已持久接纳 inbox；该操作不会回滚。 |

GitHub 事件特定字段的验证属于各受信任规则；适配器只保证通过身份验证的通用 JSON。Cordis entry 不等待规则执行。Native 接纳会等待每个非 null 请求的 inbox 持久化，但不等待模型完成。重复交付不会去重。

<a id="native-ingress"></a>
## Native ingress

只有在 Native profile 已提供 Native Web listener、凭据、`rootExecution`、`webhookRules`、Workspace、Agent preset 与 permission preset Provider 时，才选择本包 `./native` entry。配置 `source`、`path`、`secretEnv`、`maxBodyBytes` 与既有 base `rootRoute`；每条返回的 `WebhookSessionRequest.workspacePath` 都由该 root 的动态 Workspace route policy 规范化并准入。所选 root 必须提供 `createWorkspaceRoute` 和可恢复 Session deletion。本包不会提供 application 或 root execution Provider。`native-web-session-controller` 仍是所选 `rootExecution` Provider，`native-web-host` 仍是唯一 application。

Native listener 会在通用路由前保留 `/api` token 与已挂载 channel 检查，并拒绝与这些路由或 Client 页面重叠的 webhook 路径。GitHub HMAC 仍在 JSON 解析前覆盖原始 body。适配器等待 Native rule registry 分发：所有匹配回调先结束，之后才创建 Session；`null` 规则不会创建任何内容，非 null 请求则使用其 title、prompt、Agent preset、permission preset、可选模型选择和准入 Workspace 创建普通 Program-owned root Session。每项请求对应的持久 `agent/inbox/spliced` 事件完成后才返回 `202`。inbox 接纳前失败返回 `503`；已被同级操作接纳的消息仍然持久存在。接纳后会观察并记录 root 结算结果。卸载会撤回路由接纳、中止规则回调与接纳前工作，并等待 route handler 和自有 execution 排空。

当前配置了动态 Workspace routing 的 Native Web profile 支持完整请求路径。当前 SDK facade 未公开动态 Workspace 创建，因此 Native webhook Provider 在该组合中会于装配阶段失败；ACP facade 支持待其独立集成完成。Cordis 保留原有 compatibility rule runtime 和时序。

<a id="dedicated-listener-composition"></a>
## 专用监听器组合

普通 Web profile 已经拥有 `ctx.webServer`。把另一个 `dsh-host-webserver` 和此适配器挂载到仅隔离 `webServer` 的 group 内；适配器仍会继承凭据与 `webhookRuntime`。[GitHub 评审指南](../../../../Docs/user/guide/github-review.zh.md)在 TLS 反向代理后使用 `127.0.0.1:3081/github`，而 UI 继续位于端口 3080。

<a id="model-experience"></a>
## 模型体验

间接地，模型请求由所选 runtime 的规则契约生成；此适配器只负责认证和分发数据，不组装模型请求。

#### KV Cache 影响

相互独立。身份验证与 HTTP 分发不触碰模型请求；任何新会话前缀都属于消费它的规则与运行时。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **无 TLS**：注入的开发 WebServer 通常只监听 loopback，并位于 TLS 反向代理或 tunnel 后。
- **仅通用 payload 验证**：规则负责验证自己消费的 GitHub 事件字段。
- **不向提供方确认下游完成**：Cordis `202` 先于规则调用与会话创建；Native `202` 确认每条非 null 请求的 inbox 已持久接纳，不确认模型完成。
- **多规则可能部分提交**：若一条会话请求在接纳前失败，其他请求仍会排空后再返回 `503`；已接纳的 inbox 仍持久存在，提供方重试时可能重复。
- **profile capability 明确**：启用动态 Workspace routing 的 Native Web profile 支持完整会话请求。SDK 暂未公开该 route 创建操作，ACP 集成尚待完成。
- **不支持表单编码**：GitHub 必须发送 `application/json`；`application/x-www-form-urlencoded` 会被拒绝。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。authentication 与 input validation 在对应 HTTP 操作中完成；route/disposer 对称性由 `dsh-host-webserver` 负责。
