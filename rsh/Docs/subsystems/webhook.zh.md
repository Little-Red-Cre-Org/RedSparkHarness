# Webhook runtime

[English](webhook.md) | 中文

Webhook 子系统会把已通过身份验证的外部交付转换为零个或多个普通根 Session。提供方适配器拥有身份验证与通用 JSON 接收；受信任的程序化规则拥有条件与外部调用；Cordis 与 Native Provider 分别拥有自己的规则生命周期和 Session 创建。Native GitHub entry 复用所选 Native HTTP listener，调用受信任 Native 规则，并在确认每条非 null 请求的持久 inbox 接纳后才确认 HTTP 请求。[Webhook 已实现决策](../../../.agents/notes/implemented/feature/2026-08-22-fire-and-forget-webhook-sessions.zh.md)记录了 Cordis 为何不保留交付或完成状态；[HTTP route 与 Native ingress 决策](../../../.agents/notes/implemented/architecture/2026-10-07-http-route-definitions-and-native-github-ingress.zh.md)记录传输与接纳所有权。

## 共享值

`WebhookRuleId`、`WebhookSourceId` 与 `WebhookDeliveryId` 是不透明字符串。交付 id 仅用于来源信息：runtime 既不存储也不对它去重。

`WebhookEventMap` 可按提供方种类合并扩展。`WebhookEventOf<K>` 会选择已知提供方事件，否则接纳通用无损 JSON，从而让树外适配器无需修改 runtime 包。

`VerifiedWebhookDelivery<K>` 包含 `kind`、已配置 `source`、提供方 `deliveryId`、规范化 `event` 与非负安全整数 `receivedAt`。runtime 会先验证、分离并冻结完整值，再把它分发给多个规则。

`WebhookRule<K>` 包含唯一 id、提供方种类与 `run(delivery, signal)`。回调可以执行任意受信任代码。它返回 `null` 或一个 `WebhookSessionRequest`，并且异步工作若应在注册卸载时停止，就必须观察 signal。

`WebhookSessionRequest` 要求绝对 `workspacePath`、标题、文本提示词、agent preset 与 permission preset。可选 `model` 会指定明确的提供方／模型路由与可选输出 token 上限，并使用该适配器的默认推理强度。省略时会快照包含推理强度的完整当前部署选择，直到首个请求记录持久 header。

## Fire-and-forget 分发

`dispatch()` 会快照匹配规则，彼此独立地调度每个规则，并在任何回调结算前返回。抛出与拒绝按规则分别被包含。注册 disposer 会先移除规则，再中止并排空活动调用，因此后续交付无法进入正在卸载的代码。

runtime 没有队列、重试、去重、执行状态、崩溃重放、Agent 状态监听器或完成结果。重复交付可能创建重复 Session。唯一的活动操作表是私有 teardown 记账，并随进程消失。

## Session 创建

非 `null` 结果会在异步预检前生成快照。runtime 会验证 permission 与 agent preset，解析或创建规范 Workspace，创建 Session cwd 等于 Workspace 路径的 Agent，在发布前挂载所选 agent preset，并在应用权限、标题与初始 follow-up 前持久附加 Session。

Native follow-up 是普通持久 user-role 消息，使用 `source.kind: "webhook"`，并携带提供方／来源／交付／规则来源信息。关联 inbox 插入被接受时即提交接纳；每条非 null 请求到达该点后 HTTP 才返回 `202`，但不会等待模型完成。`null` 规则不会创建 Workspace route、Agent、Session 或模型请求。Native 会先解析所有匹配回调，因此回调失败不会留下部分 Session 操作。若多条请求中某项在接纳前失败，其他操作会全部排空后返回 HTTP 错误；已被同级 inbox 接纳的消息仍然持久存在。

附加失败会在提示词出现前释放新 Agent。附加之后、提示词接纳之前的失败会尝试脱离 Workspace 并释放 Agent，且不会取代原始错误。预检期间自动创建的 Workspace 会保留，因为另一个并发调用者可能已经使用它。

## GitHub 适配器

Cordis `@deepseek-ai/dsh-webhook-github` entry 会在注入的 `ctx.webServer` 上注册精确路由，为每次请求解析凭据引用，在 JSON 解析前验证未改动的 `application/json` body，并在内存分发后返回 `202`。其规范化事件保证为已签名的无损 JSON 对象；规则负责验证自己消费的事件特定字段。

同一 package 的显式 `./native` entry 会在 Native Web Assets 提供的 listener 上注册，并由该 listener 先行执行 `/api`、已挂载 channel 与 Client 页面检查。它通过 `webhookRules` 分发。每条 `WebhookSessionRequest` 都由所选 Program 准备：规范 Workspace 路径必须通过已配置的 allowed roots 与 sandbox policy；Agent preset、permission preset、标题和可选模型选择通过正常 root owner 应用；提示词则作为 user message 持久入队，并关联精确的 `agent/inbox/spliced` 事件。inbox 接纳前失败返回 `503`。接纳后 root 最终结果仍由 `rootExecution` 拥有并记录。卸载会撤回路由接纳、中止规则回调与接纳前工作，并排空 route handler 和自有 execution。此路径不会安装第二个 application、Agent 注册表或 Session writer。

规范路径、preset、permission 和可选模型均准入后，Workspace registry 创建就是持久提交。之后 Session 准备失败时，合法 Workspace 元数据可能保留，本次操作的临时 route 和 Agent 则排空。inbox 已接纳的 Session 会在轮次和 route 结算后继续持久保留。若在 inbox 接纳前失败，Native 只排空本次确切的新 execution，并可将其 Session 字节移入可恢复删除；不会删除持久 Workspace 元数据。

完整 Native Web 支持要求所选 `rootExecution` Provider 配置动态 `workspaceRoutes` 和 `createWorkspaceRoute`，并提供 Workspace registry、Agent preset、permission preset 与可恢复 Session deletion。当前 SDK facade 未公开动态 Workspace 创建，因此 Native Webhook Provider 会拒绝该组合，不会静默把事件发送到 base root。ACP 接线不属于当前 Native Web 路径。Cordis 保留 compatibility runtime 与原有时序语义。

[GitHub 评审指南](../user/guide/github-review.zh.md)介绍了在隔离的第二个 WebServer 上挂载 Cordis 路由，因此暴露 webhook 入口不会暴露浏览器 API。Native ingress 显式选择，并复用已有 Native Web listener。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `rsh/Scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxwebhookruntime--webhookruntime"></a>

### `ctx.webhookRuntime` — `WebhookRuntime`

Fire-and-forget rule runtime. Session creation is the only built-in action.

```ts cordis-catalog
/**
 * Register one trusted programmatic rule.
 * @param rule - unique id, provider kind, and arbitrary callback.
 * @returns awaitable effect disposer that aborts and drains this rule's active callbacks.
 */
register<K extends string>(rule: WebhookRule<K>): () => Promise<void>

/**
 * Start every currently matching rule and return before any callback settles.
 * @param delivery - authenticated provider data; snapshotted before dispatch.
 * @throws synchronously when the runtime is closing or the delivery is malformed.
 */
dispatch<K extends string>(delivery: VerifiedWebhookDelivery<K>): void
```

Source: [`rsh/Modules/Official/webhook/webhook/src/index.ts`](../../Modules/Official/webhook/webhook/src/index.ts)
<!-- END GENERATED cordis-surface -->
