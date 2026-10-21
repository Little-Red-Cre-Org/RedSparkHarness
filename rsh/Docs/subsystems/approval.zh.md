# 用户审批

[English](approval.md) | 中文

[compat-user-approval](../../Compatibility/DSH/bridge/compat-user-approval) 的审批 seam 回答一个问题：这个具体操作是否可以继续？框架无关的审批 Definition 拥有共享请求/结果词汇和持久化策略投影；兼容包提供 `ctx.approval` 分发服务与 `approval/request` 应答者 waterfall（瀑布式事件）。UI 通道可以提供人类应答者；[ACP（Agent Client Protocol）自动化桥接层](../../Programs/ACP/packages/acp)为其拥有的 agent（智能体）提供一次性机器决策。调用方如 [dsh-tools](../../Engine/core/tools) 和 [dsh-tool-bash](../../Modules/Official/shell/tool-bash) 消费闭合的结果，除非结果为 `allowed-once`，否则一律拒绝。

源码：[`rsh/Compatibility/DSH/bridge/compat-user-approval/src/index.ts`](../../Compatibility/DSH/bridge/compat-user-approval/src/index.ts)

## 标识与结果

每个请求都会获得一个全新的 `ApprovalRequestId`。该品牌类型将 `approval/asked` 与 `approval/decided` 审计事件配对，同时不会让审批 id 与工具调用 id 或 agent/会话 id 互换。

```ts type-equiv
/** Opaque identity pairing one compatibility approval question with its decision. */
type ApprovalRequestId = Branded<'ApprovalRequestId'>
```

`ApprovalOutcome` 是闭合的，且失败时拒绝。`allowed-once` 仅授权所询问的那一个操作；调用方对 `rejected`、`cancelled` 和 `unavailable` 均执行拒绝。缺失、不负责该请求、抛异常或不合规的应答者会产生 `unavailable`，而非放行。

```ts type-equiv
/** One-shot outcome returned by the compatibility answerer chain. */
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
```

## 按会话策略

`ApprovalPolicy` 决定在交互式应答者运行之前发生什么。`ask` 委托给组合的应答者链，链的无应答默认值为 `unavailable`；`never` 确定性地返回 `rejected`，不分发任何应答者。生效值为 Session 日志中最后一条 `approval/policy` 事件，回退到服务配置。兼容服务通过 `overrideOf(session)` 读取显式覆盖；运行期间的变更调用 `ctx.approval.setPolicy(agent, policy)`，初始策略则通过 `setApprovalPolicy(session, policy)` 追加。

```ts type-equiv
/** Per-Session policy accepted by compatibility approval consumers. */
type ApprovalPolicy = 'ask' | 'never'
```

两种策略都会将各自完整的当前含义贡献给缓存安全的运行时上下文快照。带来源的 `user/message` 是持久化且模型可见的输入；审批状态变化时，会在保留的历史后追加一份新的完整快照，而不触碰承载渲染后系统提示词的 `system/message` 节点。

## 审批请求

`ApprovalRequest<AgentOwner>` 标识请求所有者与工具操作，但不会把 Agent 实现引入纯 Definition。兼容 API 将 `AgentOwner` 专化为完整的 scoped `Agent`，保留服务所用的实时 Session 与注入操作。请求有意省略工具参数：应答者通过 `callId` 将提示附加到已流式输出的工具调用上，而非渲染另一份可能漂移的副本。

```ts type-equiv
/** Framework-free request passed to the compatibility approval service. */
interface ApprovalRequest<AgentOwner> {
  readonly agent: AgentOwner
  readonly toolName: string
  readonly callId?: ToolCallId
  readonly reason?: string
  readonly signal?: AbortSignal
}
```

## 分发与审计

`ctx.approval.request(req)` 要求发起请求的会话处于一个尚未结束的轮次内。它追加 `approval/asked`，获取一个结果，追加对应的 `approval/decided`，然后以该结果完成。`never` 策略在服务内部、waterfall 分发之前强制执行，因此即使后来以 `prepend` 注册的应答者也无法绕过它。应答者在负责处理该请求时返回结果，否则调用 `next()` 委托；第一个应答占据唯一的决策槽位。

审计事件仅写入日志，不进入模型 transcript（文本记录）。模型可见的行为是调用方派生的工具结果与当前运行时上下文快照。服务 dispose（资源释放）时会移除其上下文贡献；应答者监听器独立地通过 effect 绑定到其所属插件。

## 原生 profile 审批

`dsh-native-approval` 为使用 `NativeAgentRegistry` 而非 Cordis Agent 的 profile 提供独立的原生 `approval` Provider。`NativeApprovalService` 接受同一组封闭 outcome 词汇及 `ask`/`never` 部署策略，确认精确登记的原生 Agent，并在 `ask` 下调用其有序应答者。应答者可返回 `undefined` 来委托；缺失或失败的应答者会解析为 `unavailable`，Provider 释放会将未完成请求解析为 `cancelled`。

原生 Provider 不拥有 Session 或 Cordis 事件。其消费应用记录 `native-approval/asked` 和 `native-approval/decided` 审计对，然后渲染工具 outcome。原生 headless 将该路径应用于固定 `write_file` 工具，并转交给声明审批 reason 的贡献工具。不同的事件名称使原生请求 id 和策略数据与 user-approval 审计 payload 分离。

源码：[`rsh/Modules/Official/interaction/native-approval/src/index.ts`](../../Modules/Official/interaction/native-approval/src/index.ts)

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `rsh/Scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxapproval--approvalservicedefinition"></a>

### `ctx.approval` — `ApprovalServiceDefinition`

Cordis implementation specialized to the exact scoped Agent owner.

```ts cordis-catalog
/**
 * Set the durable per-Session approval policy for the live agent.
 * @param agent - live agent whose policy changes.
 * @param policy - next effective policy.
 */
setPolicy(agent: Agent, policy: ApprovalPolicy): void

/**
 * Ask the compatibility answerer chain for a decision inside the Agent's
 * open Session turn. The Provider appends `approval/asked` before dispatch
 * and `approval/decided` after the normalized outcome so the audit pair is
 * enclosed by that turn's durable log boundary. Calls made while no turn is
 * open reject before appending; a failure before either audit append commits
 * rejects the request. Post-commit observer failures are contained by
 * Session and do not reject the request or suppress its matching event.
 * @param request - exact operation and owner needing a decision.
 * @returns the fail-closed outcome.
 * @throws When the Session has no open turn or either audit append fails before commit.
 */
request(request: ApprovalRequest<Agent>): Promise<ApprovalOutcome>

/**
 * Read the explicit policy override recorded in the Session log.
 * @param session - Session with the durable policy fold.
 * @returns the explicit override or undefined.
 */
overrideOf(session: Session): ApprovalPolicy | undefined
```

Types: [Agent](core.zh.md) · [Session](session.zh.md)

Source: [`rsh/Compatibility/DSH/bridge/compat-user-approval/src/types.ts`](../../Compatibility/DSH/bridge/compat-user-approval/src/types.ts)

<a id="approval-events"></a>

### `approval/*` events

<a id="approvalrequest--waterfall"></a>

#### `approval/request` — waterfall

Ask composed answerers for one decision. Return an outcome to claim it or call `next()` to delegate. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) limits listeners to the requesting Agent's scope.

```ts cordis-catalog
/**
 * Ask composed answerers for one decision. Return an outcome to claim it or call `next()` to delegate.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) limits listeners to the requesting Agent's scope.
 * @param req - pending approval request.
 * @mode waterfall
 */
'approval/request'( this: Scoped<Agent>, req: ApprovalRequestEvent, next: () => Promise<ApprovalOutcome>, ): Promise<ApprovalOutcome>
```

Types: [Agent](core.zh.md) · [Scoped](scope.zh.md)

Source: [`rsh/Compatibility/DSH/bridge/compat-user-approval/src/types.ts`](../../Compatibility/DSH/bridge/compat-user-approval/src/types.ts)
<!-- END GENERATED cordis-surface -->
