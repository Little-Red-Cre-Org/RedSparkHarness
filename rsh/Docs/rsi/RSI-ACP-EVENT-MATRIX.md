# ACP 事件对照表：OpenBitFun 消费什么 vs RSI 发什么

> 这份文档回答一个问题：**桥搭起来之后，RSI 的事件能不能在 OpenBitFun 界面上正确显示。**
> 所有行号附原文。未改动任何代码。

---

## 一、结论摘要

| 维度 | 结果 |
|---|---|
| OpenBitFun 客户端实际消费的变体 | **7 个**（`stream.rs:126-165`），其余走 `_ => {}` 静默丢弃 |
| RSI `_relay` 实际发出的变体 | **4 个**（`agent_message_chunk` / `agent_thought_chunk` / `tool_call` / `tool_call_update`） |
| 发了但没人接 | **0 个** —— 四个全被接住 |
| 接了但我们不发 | **3 个** —— `usage_update` / `plan`（`available_commands_update`、`config_option_update` 另计） |
| 传输无关性 | **成立** —— `send` 只要求「收到一个 dict」，与 websocket 无耦合 |

**一句话：最小可用桥已经够了，界面不会空白。但会缺三样东西——token 用量、计划面板、命令列表。**

---

## 二、左边：OpenBitFun 实际消费什么

**位置**：`desktop/src/crates/interfaces/acp/src/client/stream.rs:118-174`，函数 `acp_dispatch_to_stream_events_with_tracker`。

核心是一个 `match notification.update`：

```
stream.rs:125 |         match notification.update {
stream.rs:126 |             SessionUpdate::AgentMessageChunk(chunk) => {
stream.rs:131 |             SessionUpdate::AgentThoughtChunk(chunk) => {
stream.rs:136 |             SessionUpdate::ToolCall(tool_call) => {
stream.rs:139 |             SessionUpdate::ToolCallUpdate(tool_call_update) => {
stream.rs:142 |             SessionUpdate::UsageUpdate(usage_update) => {
stream.rs:147 |             SessionUpdate::AvailableCommandsUpdate(update) => {
stream.rs:156 |             SessionUpdate::Plan(plan) => {
stream.rs:161 |             SessionUpdate::ConfigOptionUpdate(update) => {
stream.rs:166 |                 _ => {}
stream.rs:167 |             }
```

**总共 8 个分支，其中 7 个产出事件，`_ => {}` 吞掉其余一切。**

每个变体在客户端内部变成什么（`AcpClientStreamEvent`，`stream.rs:16-31`）：

| ACP 变体 | 内部事件 | 源码 |
|---|---|---|
| `agent_message_chunk` | `AgentText(String)` | `stream.rs:126-130` |
| `agent_thought_chunk` | `AgentThought(String)` | `stream.rs:131-135` |
| `tool_call` | `ToolEvent(...)` | `stream.rs:136-138` |
| `tool_call_update` | `ToolEvent(...)` | `stream.rs:139-141` |
| `usage_update` | `ContextUsageUpdated(...)` | `stream.rs:142-146` |
| `available_commands_update` | `AvailableCommandsUpdated(...)` | `stream.rs:147-155` |
| `plan` | `PlanUpdated(...)` | `stream.rs:156-160` |
| `config_option_update` | `ConfigOptionsUpdated(...)` | `stream.rs:161-165` |

**注意 `_ => {}` 的含义**：ACP 的 `SessionUpdate` 联合类型共有 16 个变体（含 `user_message_chunk` / `plan_update` / `plan_removed` / `current_mode_update` / `notice` / `compaction_update` / `compaction_summary_chunk` 等），**其余 8 个没人接，发了也是白费**。而且**不会报错**——这正是最危险的一类失败。

---

## 三、中间：RSI 实际发什么

**位置**：`rsi/acp_server.py`，全文件 `sessionUpdate` 只出现在 7 处，归为 4 个变体：

```
acp_server.py:695 | send, session_id, {"sessionUpdate": "agent_message_chunk",
acp_server.py:724 | {"sessionUpdate": "agent_thought_chunk",
acp_server.py:731 | {"sessionUpdate": "agent_message_chunk",
acp_server.py:738 | {"sessionUpdate": "tool_call",
acp_server.py:751 | {"sessionUpdate": "tool_call_update",
acp_server.py:762 | {"sessionUpdate": "agent_thought_chunk",
acp_server.py:776 | {"sessionUpdate": "tool_call_update",
```

拆到来源上（`_relay` 在 `:715`，另有 `:695` 是 `_run_prompt` 里的终稿补发）：

| RSI executor 事件 | 发出的 ACP 变体 | 源码 |
|---|---|---|
| `step.message` 带 `thinking` | `agent_thought_chunk` | `:721-726` |
| `step.message` 带 `assistant` | `agent_message_chunk` | `:727-733` |
| `tool.called` | `tool_call`（`status: "pending"`、`kind: "other"`） | `:735-745` |
| `tool.result` | `tool_call_update`（`completed` / `failed`） | `:746-758` |
| `model.retry` | `agent_thought_chunk`（文案 `retrying: …`） | `:759-766` |
| `plan.updated` | **只发 `tool_call_update` 收尾，不发 `plan`** | `:767-779` |
| `run.final` 补发 | `agent_message_chunk` | `:692-697` |

关键原文（`plan.updated` 那段，`:767-779`）：

```
acp_server.py:767 |         if kind == "plan.updated":
acp_server.py:768 |             # The call that produced this list was reported as a plan rather than
acp_server.py:769 |             # as a result, so its card would stay "in progress" and its bookkeeping
acp_server.py:770 |             # entries would never be collected. Closing it here is what keeps a
acp_server.py:771 |             # long session from accumulating one dead card per plan update.
acp_server.py:772 |             call_id = self._close_call(session_id, data, invent=False)
acp_server.py:773 |             if call_id:
acp_server.py:774 |                 await self._update(
acp_server.py:775 |                     send, session_id,
acp_server.py:776 |                     {"sessionUpdate": "tool_call_update",
acp_server.py:777 |                      "toolCallId": call_id,
acp_server.py:778 |                      "status": "completed"},
```

**它只关掉卡片，从来没有把 plan 内容发出去过。**

---

## 四、对照表（首要交付物）

| # | ACP 变体 | OpenBitFun 消费？ | RSI 发出？ | 判定 |
|---|---|---|---|---|
| 1 | `agent_message_chunk` | ✅ `stream.rs:126` → `AgentText` | ✅ `:731`、`:695` | **通** |
| 2 | `agent_thought_chunk` | ✅ `stream.rs:131` → `AgentThought` | ✅ `:724`、`:762` | **通** |
| 3 | `tool_call` | ✅ `stream.rs:136` → `ToolEvent` | ✅ `:738` | **通** |
| 4 | `tool_call_update` | ✅ `stream.rs:139` → `ToolEvent` | ✅ `:751`、`:776` | **通** |
| 5 | `usage_update` | ✅ `stream.rs:142` → `ContextUsageUpdated` | ❌ **不发** | **空白：界面无 token 用量** |
| 6 | `plan` | ✅ `stream.rs:156` → `PlanUpdated` | ❌ **不发**（只在 `:776` 关了卡片） | **空白：计划面板永远空** |
| 7 | `available_commands_update` | ✅ `stream.rs:147` → `AvailableCommandsUpdated` | ❌ 不发 | **空白：斜杠命令列表空** |
| 8 | `config_option_update` | ✅ `stream.rs:161` → `ConfigOptionsUpdated` | ❌ 不发 | **空白：模型/模式切换器空** |
| 9 | `user_message_chunk` | ❌ `_ => {}` | ❌ 不发 | 无影响（客户端自己回显输入） |
| 10 | 其余 7 个变体 | ❌ `_ => {}` | ❌ 不发 | 无影响 |

**统计（重数过）**：
- 通了：**4 个**
- 空白（它接、我们不发）：**4 个**（`usage_update` / `plan` / `available_commands_update` / `config_option_update`）
- 白费（我们发了没人接）：**0 个**

### 4.1 三个空白里，哪个必须补

**必须补 `plan`。** 理由不是"界面上少一块"，是**RSI 的自我改进要靠它**：`improve.py` 的每一轮是「测 live → 让 agent 改 → 门禁 → 测候选 → 提交」，这本身就是一个多步计划。不发 `plan`，用户在 OpenBitFun 界面上看不到"现在走到哪一步"，长任务会像卡死。

补法：`plan.updated` 事件里已经有 `steps`（`desktop.py` 那边的 `_on_plan` 就是读它的），直接映射成 ACP 的 `plan`：

```
ACP Plan = { entries: PlanEntry[] }
PlanEntry = { content: string, priority: "high"|"medium"|"low", status: "pending"|"in_progress"|"completed" }
```

`dsh-acp` 就是这么做的，`bridge.ts:604-613`：

```
bridge.ts:604 |       case 'todo/write': {
bridge.ts:605 |         const entries: PlanEntry[] = event.data.todos.map(todo => ({
bridge.ts:606 |           content: todo.content,
bridge.ts:607 |           // The harness todo list carries no priority; ACP requires one, and a
bridge.ts:608 |           // flat `medium` is the honest rendering of "unranked".
bridge.ts:609 |           priority: 'medium',
bridge.ts:610 |           status: todo.status,
bridge.ts:611 |         }))
bridge.ts:612 |         update(record, { sessionUpdate: 'plan', entries })
```

**"priority 一律 medium"这个做法可以直接抄**——我们的 plan 步骤也没有优先级，硬编一个 high 反而是撒谎。

**`usage_update` 建议补但不紧急。** `_run_prompt` 已经在回包里填了 `usage`（`acp_server.py:698-701`）：

```
acp_server.py:698 |         reply = {"stopReason": "end_turn"}
acp_server.py:699 |         usage = _usage_of(run)
acp_server.py:700 |         if usage:
acp_server.py:701 |             reply["usage"] = usage
```

但 `ContextUsageUpdated` 是 `usage_update` **通知**触发的，不是 prompt 回包触发的——**两处都要**才看得到。这是我读到 `stream.rs:142` 和 `acp_server.py:698` 之后得出的判断，没有实测验证。

**`available_commands_update` / `config_option_update` 不用补。** 我们没有斜杠命令，也没有"模式"概念。发了反而是空列表，跟不发一样。

---

## 五、第二件事：`_serve_frame` 的传输无关性

**结论：成立。** 依据是全部 `send(` 调用点（grep 共 10 处）：

```
acp_server.py:236 | await send({"type": "lifespan.startup.complete"})
acp_server.py:239 | await send({"type": "lifespan.shutdown.complete"})
acp_server.py:259 | await send({"type": "websocket.close", "code": 1008})
acp_server.py:261 | await send({"type": "websocket.accept"})
acp_server.py:273 | await send({"type": "websocket.send", "text": json.dumps(frame)})
acp_server.py:841 | await send({"jsonrpc": "2.0", "method": "session/update",
acp_server.py:941 | await send({"type": "http.response.start", "status": status,
acp_server.py:944 | await send({"type": "http.response.body", "body": payload})
acp_server.py:949 | await send({"jsonrpc": "2.0", "id": msg_id, "result": result})
acp_server.py:954 | await send({"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}})
```

分两类：

**A 类 —— 协议帧，3 处**（`:841`、`:949`、`:954`）：只发 `{"jsonrpc": ...}` 纯字典，**零传输假设**。这是 `_serve_frame` 的全部出口。

**B 类 —— 传输控制帧，7 处**（`:236`/`:239`/`:259`/`:261`/`:273`/`:941`/`:944`）：ASGI 专属，`{"type": ...}`。但这些**全在 `_websocket` / `_http` / `_lifespan` 三个函数体内**，不在 `_serve_frame` 的调用链上。

**关键的一行是 `:272-273`**：

```
acp_server.py:272 |         async def emit(frame: dict) -> None:
acp_server.py:273 |             await send({"type": "websocket.send", "text": json.dumps(frame)})
```

这里把 ASGI 的 `send` **包装成一个只收 dict 的 `emit`**，然后传给 `_serve_frame`：

```
acp_server.py:311 |             task = asyncio.create_task(self._serve_frame(frame, emit, connection))
```

**所以 `_serve_frame(frame, send, connection)` 这个 `send` 参数的契约就是：接收一个 dict，把它写成 ACP 帧。** 最后一个参数 `connection` 是一个不透明字符串（`:270 connection = secrets.token_hex(4)`），用于断线时按连接清理 session，与传输无关。

**方案 B 不受影响的结论成立。** stdio 传输只要提供一个同样形状的 `send(frame: dict)`，把 `json.dumps(frame)` 写一行到 stdout 即可——这正是 `rsi/acp_stdio.py` 已经做的事。

### 5.1 一处必须注意的边界

`_websocket` 里有断线清理（`:277-290`）：连接断开时遍历 `self._opened`，把属于这个 connection 的 session 全部 `_abandon`。

**stdio 传输下，"断线"的等价物是 stdin EOF。** 如果 stdio 那侧没做等价清理，进程退出时正在跑的 run 会留下后台任务。这一点我在 `rsi/acp_stdio.py` 里看到有 `_shutdown`（`:137`），但**没有验证它是否调用了同样的清理路径**——这是下一步该测的，不是现在能断言的。

---

## 六、第三件事：`packages/dsh-acp` 的关键部分

### 6.1 方向：**引擎事件 → ACP 通知**（正是我们要的方向）

`bridge.ts:1-14` 开头说得最清楚：

```
bridge.ts:8  |  * The upstream bridge is automation-only by design: it carries prompt text,
bridge.ts:9  |  * committed assistant text, cancellation, and one-shot permission decisions,
bridge.ts:10 |  * and deliberately keeps tool calls, reasoning, and plans off the wire as
bridge.ts:11 |  * "presentation or trace data". An IDE is exactly the client that needs that
bridge.ts:12 |  * presentation data, so this fork keeps upstream's session, turn, and teardown
bridge.ts:13 |  * machinery verbatim and replaces only the `session/event` dispatch with a full
bridge.ts:14 |  * translation to ACP session updates.
```

**这段话等于替我们写好了设计说明**：上游桥只传文本，IDE 要的是展示数据，所以这个 fork 只改了事件分发。我们的处境一模一样——RSI 的 executor 事件要变成 ACP 展示数据。

### 6.2 三个文件各干什么

**`codec.ts`（70 行）—— 纯函数翻译，无状态**

| 函数 | 作用 | 源码 |
|---|---|---|
| `turnEndToStopReason` | 把 harness 的 turn 结束原因映射成 ACP 的 `StopReason` | `codec.ts:19-38` |
| `acpPromptToText` | 把 ACP prompt 的 content blocks 拍平成文本 | `codec.ts:47-58` |
| `promptHasUnsupportedContent` | 判断是否含 ACP baseline 之外的内容 | `codec.ts:68-70` |

**这两个函数我们已经有等价物了**：`acp_server.py` 的 `_prompt_text`（`:904`）就是 `acpPromptToText`。

有意思的是它的 `StopReason` 映射策略（`codec.ts:25-37`）——**`aborted` / `blocked` / `error` 全部映射成 `end_turn`，只有 `interrupted` 才是 `cancelled`**，注释写得很明确：

```
codec.ts:25 |     // `cancelled` is reserved for explicit client cancellation (`session/cancel`)
codec.ts:26 |     // and disposal, both settled out of band; a turn aborted by a hook or
codec.ts:27 |     // another owner is ordinary quiescence and reports `end_turn`.
```

**这条值得抄。** 我们的 `_run_prompt` 现在是 `cancelled` / `refusal` / `end_turn` 三分（`acp_server.py:686-687`、`:698`），语义上跟它一致，但它是用**显式的原因枚举**驱动的，不是猜的。

**`bridge.ts`（1,166 行）—— 主体，负责注册与分发**

- `:69` `export const name = 'acp-ide'`、`:71` `export const inject = ['agents']` —— 这是一个 Cordis 插件
- `:301` `export function apply(ctx: Context, config: AcpConfig): void` —— 插件入口，1,149 行到 `agentOptions` 之间全是它
- `:543` `const publishEvent = (record, event) => { switch (event.type) { ... } }` —— **核心映射函数**
- `:693` `ctx.on('session/event', ...)` —— 订阅引擎事件，然后调 `publishEvent`

`publishEvent` 的 8 个 case（`bridge.ts:545-656`）：

| harness 事件 | → ACP 变体 | 源码 |
|---|---|---|
| `assistant/chunk`（`text-delta`） | `agent_message_chunk` | `:545-551` |
| `assistant/chunk`（`reasoning-delta`） | `agent_thought_chunk`（受 `publishReasoning` 开关控制） | `:552-557` |
| `assistant/message`（非流式回放） | `agent_message_chunk` / `agent_thought_chunk` | `:562-582` |
| `tool/call` | `tool_call`（`status: 'pending'`） | `:584-588` + `:516-536` |
| `tool/result` | `tool_call_update`（`completed`/`failed` + `content` + `rawOutput`） | `:590-602` |
| `todo/write` | `plan` | `:604-614` |
| `turn/start` | `config_option_update`（只发一次，锁预设） | `:616-635` |
| `turn/end` / `step/end` / 其它 | 不发文，只清内部状态 | `:637-656` |

**跟我们 `_relay` 的映射几乎逐条对应**，差的就是 `plan` 那一条（见 4.1）和 `config_option_update`。

### 6.3 三个值得抄的具体做法

**① 工具名直接当标题，不做美化**（`bridge.ts:526-529`）

```
bridge.ts:526 |       // The harness tool name IS the title: a client matches it against its own
bridge.ts:527 |       // tool vocabulary to render a native card, and a prettified label would
bridge.ts:528 |       // only make that match guess.
bridge.ts:529 |       title: toolName,
```

我们现在是 `"title": str(data.get("name") or "tool")`（`acp_server.py:740`），**一致**。但 `"kind": "other"`（`:741`）是硬编的——它那边有个 `toolKind(toolName)` 函数在算。**补 `kind` 是低成本高收益的改动**：`edit` / `execute` / `read` 能让界面画出不同的图标和卡片样式。

**② 流式与终稿去重靠"记账"**（`bridge.ts:550`、`:554`、`:567-568`）

```
bridge.ts:550 |           record.streamedText.add(key)
bridge.ts:567 |         const emitText = !record.streamedText.has(key)
```

它用 `stepKey(turn, step)` 记住哪些 step 已经流过 delta，非流式回放时就不再重复发。

**我们的等价物是 `session.spoken`**（`acp_server.py:728`、`:693`）——但**粒度不同**：它是 per-step 的集合，我们是单个字符串。RSI 一个 turn 只有 0 号 step，所以单字符串够用；但如果将来支持多步，这个简化会漏。**记录一下，不着急改。**

**③ 回放历史**（`bridge.ts:672-691`）

`session/load` 之后要把历史重放给客户端，因为 `session/load` 的响应体不带 transcript。它逐条遍历 `session.events`，跳过 `assistant/chunk`（已并入 `assistant/message`）和 `turn/start`。

**我们现在 `loadSession: false`**（`acp_server.py:410 | "loadSession": False,`），所以没有这个问题。但**如果以后要支持"关掉窗口再打开还能看到历史"，这段就是必读的**。

---

## 七、我不确定的地方

1. **`usage_update` 是否真的能驱动界面上的 token 显示。** 我只确认了 `stream.rs:142` 会产出 `ContextUsageUpdated(...)`，没读 `AcpSessionContextUsage::from(usage_update)`（在 `session_options.rs`）确认它要哪些字段。ACP 的 `UsageUpdate` 必填 `used` 和 `contextLimit` 两项，我们只有 token 计数，**没有 contextLimit**——这可能是补不了的，需要读 `session_options.rs` 才能定。

2. **`tool_call_update` 的 `content` 结构。** 我们发的是 `[{"type": "content", "content": {"type": "text", "text": ...}}]`（`acp_server.py:754-756`），符合 ACP 的 `ToolCallContent = Content & {type:"content"}`。但 `stream.rs` 里 `acp_tool_call_update_events`（`:304`）怎么解析它、会不会因为缺 `rawOutput` 而退化，我没读那个函数。

3. **`rsi/acp_stdio.py` 的 `_shutdown` 是否做了 `_websocket` 那套按连接清理**（见 5.1）。这是我下一步该验的，不是现在能断言的。

---

## 八、给都水的一句话

**四个变体已经通了，界面不会空白。必补的只有 `plan` 一个**（`acp_server.py:604-614` 那 11 行照抄即可，priority 一律 `medium`）。`usage_update` 要先读 `session_options.rs` 确认字段要求，别急着补。
