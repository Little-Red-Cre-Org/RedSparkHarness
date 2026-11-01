# ACP 桥：让 goose 桌面客户端连到 RSI 自己的引擎

> 本文记录 **goose 桌面客户端与后端之间真实跑的协议**，取自两个来源，不是设计稿：
> 1. `D:\RSIHarness\.probe\acp_srv_probe.log` —— 真 goose 客户端连我们探针服务器的完整抓包（客户端视角）。
> 2. `D:\RSIHarness\.probe\acp_e2e.log` —— 我们当客户端连真 goosed 的抓包（服务端视角）。
> 另有源码佐证：`D:\RSIHarness\.probe\goose-src\ui\desktop\src\` 与 `D:\RSIHarness\.probe\goose-src\ui\goose-acp-client\src\generated\`。
>
> 实现在 `rsi/acp_server.py`，测试在 `tests/test_acp_server.py`。

---

## 一、这件事的定位

goose 桌面客户端默认自己拉起 goosed 子进程。设了 `GOOSE_EXTERNAL_BACKEND=1` 之后它不拉了，改为连一个已有的后端。**这个后端可以是 RSI 自己。**

于是得到的效果是：goose 的完整前端（Electron + React，几百个组件）直接接上 RSI 的引擎。`rsi/acp_server.py` 不实现第二个 agent，它把已经存在的 executor 的事件翻译成 ACP 通知。

```
goose desktop (Electron)
   │  GET /status          明文可达性探测，不带密钥
   │  GET /acp             必须 406，客户端靠这个判断「该开 socket 了」
   │  WS  /acp?token=…     initialize → session/new → session/prompt → session/update…
   ▼
rsi/acp_server.py  (ASGI，手写，导入时不依赖 uvicorn)
   │  make_backend("openhands")  —— 与 HTTP 前端共用同一个引擎
   ▼
rsi/backend.py → OpenHands SDK → 模型
```

---

## 二、环境变量契约

客户端这一侧由 `ui/desktop/src/main.ts` 决定，三段逻辑都在 `getExternalBackendUrlFromEnv` / `getExternalBackendFromEnv` 里：

| 变量 | 作用 | 源码 |
|---|---|---|
| `GOOSE_EXTERNAL_BACKEND` | 只要非空就**不再自己拉 goosed**。是开关，值本身不看 | `main.ts:856 \| if (!process.env.GOOSE_EXTERNAL_BACKEND) {` |
| `GOOSE_EXTERNAL_BACKEND_URL` | 后端 base url，**必须在 `/acp` 之前**，不能带 query 或 fragment | `main.ts:860 \| const configuredUrl = process.env.GOOSE_EXTERNAL_BACKEND_URL?.trim();` |
| `GOOSE_PORT` | `GOOSE_EXTERNAL_BACKEND_URL` 没给时的端口回退，默认 3000 | `main.ts:865 \| return \`http://127.0.0.1:${process.env.GOOSE_PORT \|\| '3000'}\`;` |
| `GOOSE_SERVER__SECRET_KEY` | **必填**。缺了客户端直接抛错，不会静默降级 | `main.ts:877 \| 'GOOSE_SERVER__SECRET_KEY must be set when using GOOSE_EXTERNAL_BACKEND. ' +` |

URL 校验规则来自 `ui/desktop/src/acp/url.ts`：

- 协议必须是 `http:` 或 `https:`（`normalizeAcpHttpBaseUrl`）。
- 带 `?` 或 `#` 直接抛 `External ACP backend URL must not include query parameters or fragments`。
- 以 `/acp` 结尾也抛错 —— 因为客户端自己会拼 `/status` 和 `/acp`。

对应到 RSI 侧，`rsi/cli.py:316-319` 打印的就是这几行：

```
rsi acp on http://127.0.0.1:57800
  home  <engine home>
  goose: GOOSE_EXTERNAL_BACKEND=1
        GOOSE_EXTERNAL_BACKEND_URL=http://127.0.0.1:57800
```

---

## 三、握手三步

客户端在画窗口之前只做这三件事，任何一步答案不对，表现都是「装了但打不开」，而不是一个协议错误。

### 第一步：`GET /status`

不带任何密钥，纯可达性探测。判定条件是 `2xx`：

```
remoteBackends.ts:220 | probe(request, statusHttpUrlFromHttpBase(baseUrl), pinnedHostname, null, (hop, resolvedUrl) =>
remoteBackends.ts:221 | hop.status >= 200 && hop.status < 300
```

服务端回 `acp_server.py:181 | await _reply_json(send, 200, {"status": "ok", "backend": "rsi-harness"})`：

```json
{"status": "ok", "backend": "rsi-harness"}
```

### 第二步：`GET /acp` —— 必须 **406**

这一步带 `X-Secret-Key` 头去探，**但服务端在这里不验密钥**。客户端只认两种结果：

| 客户端收到 | 它的判断 | 源码 |
|---|---|---|
| `406` | 密钥通过，可以开 socket | `remoteBackends.ts:244 \| if (hop.status === 406) {` |
| `401` / `403` | 密钥被拒（文案会提示去核对 `GOOSE_SERVER__SECRET_KEY`） | `remoteBackends.ts:255 \| if (hop.status === 401 \|\| hop.status === 403) {` |
| 其它 | `GET /acp returned N, expected 406` | `remoteBackends.ts:264 \| detail: \`GET /acp returned ${hop.status} ...\`` |

**为什么必须 406 而不是 200**：200 会让客户端当成 SSE 去读并一直等；401 会报成密钥错误而不是「服务器活着」。406 在 goose 自己的逻辑里就是「这个端点存在，但现在不是给你用 HTTP 拿的」。

所以密钥错误**只能**在第三步的 websocket 上拒，第二步一律 406 —— `tests/test_acp_server.py:126` 专门钉住了这一点：`test_the_acp_route_refuses_a_plain_get_even_with_a_bad_secret`。

### 第三步：`WS /acp?token=<secret>`

密钥走 **query 参数 `token`**，不走 header（`remoteBackends.ts:284 \| url.searchParams.set('token', secret);`）。header 形式 `x-secret-key` 也接受，因为第二步那个 HTTP 探测用的是 header，同一个凭据不该有两种拼法。

Reject 是 `websocket.close` code `1008`（`acp_server.py:194`）。

抓包里真实的三连（`acp_srv_probe.log:13-16`，User-Agent 是 `RSIHarness/1.55.0 Chrome/150 Electron/43.4`）：

```
10:52:20 HTTP GET /status
10:52:20 HTTP GET /acp
10:52:20 HTTP GET /acp   x-secret-key: probe-secret
10:52:20 WS connect path=/acp query=token=probe-secret  origin=file://
```

注意没有 header 的那次 `GET /acp` 也在 —— 客户端两种都试。

---

## 四、JSON-RPC 方法表

传输是标准 JSON-RPC 2.0，`id` 由客户端给。goose 的 `initialize` 用的是 `id: 0`（`acp_srv_probe.log:20`）。

### 4.1 `initialize`（request）

抓到的真实请求（`acp_srv_probe.log:20`）：

```json
{"jsonrpc":"2.0","id":0,"method":"initialize","params":{
  "protocolVersion":1,
  "clientCapabilities":{"elicitation":{"form":{}},"_meta":{"goose":{
    "mcpHostCapabilities":{"extensions":{"io.modelcontextprotocol/ui":{"mimeTypes":["text/html;profile=mcp-app"]}}},
    "customNotifications":true,"recipeParameterRequests":true}}},
  "clientInfo":{"name":"goose-app","version":"1.55.0"}}}
```

版本号固定在 1：`acpConnection.ts:30 | const ACP_V1_PROTOCOL_VERSION: 1 = PROTOCOL_VERSION;`。

回包（`acp_server.py:317-343`）：

```json
{"protocolVersion": 1,
 "agentCapabilities": {
   "loadSession": false,
   "promptCapabilities": {"image": false, "audio": false, "embeddedContext": true}},
 "agentInfo": {"name": "rsi-harness", "version": "0.1.0"},
 "authMethods": []}
```

`protocolVersion` 回**客户端问的那个**，客户端没问就回自己的 1 —— 客户端拿这个判断双方是否一致。

`image: false` / `audio: false` 是有意的：executor 只吃文本，声称支持就等于允许客户端送一份读不了的图。

真 goosed 的能力声明更宽（`acp_e2e.log:2` 里有 `sessionCapabilities: {list, delete, close}`、`mcpCapabilities`），但客户端**不校验**这些字段，所以窄声明是安全的。

### 4.2 `session/new`（request）

```json
{"cwd": "D:/dir", "mcpServers": [], "_meta": {"client": "goose-desktop"}}
```

`mcpServers` 恒为 `[]`，`_meta` 里可能还有 `enabledExtensions` / `recipeId` / `recipeDeeplink`（`sessions.ts:252-261`）。

回包只有 `sessionId` 是必读的：

```json
{"sessionId": "rsi-0001", "models": null, "modes": null}
```

`models` / `modes` 回 `null` 客户端不报错 —— `acpNewSession` 只取 `response.sessionId` 和 `response._meta`（`sessions.ts:263,268`）。真 goosed 会回一大堆 `modes` 和 `configOptions`（`acp_e2e.log:3`），那是它自己设置页要用的，不是 ACP 必需。

### 4.3 `session/prompt`（request）

```json
{"sessionId": "rsi-0001",
 "prompt": [{"type": "text", "text": "..."}]}
```

`prompt` 是 content block 数组，**不是字符串**（`prompt.ts:14-17`）。图片块也可能出现，但我们在 `initialize` 里说了不收，所以丢弃是符合契约的。

这是**长请求**：它不立刻回，而是先推一串 `session/update` 通知，最后才回 `result`。所以服务端必须能在一个请求的处理期间往同一条连接上写通知。

回包：

```json
{"stopReason": "end_turn"}
```

`stopReason` 五个合法值（ACP `StopReason`）：`end_turn` / `max_tokens` / `max_turn_requests` / `refusal` / `cancelled`。`acp_server.py` 只产出其中三个：`cancelled`(:510/:563)、`refusal`(:565)、`end_turn`(:576)。

真 goosed 还会带 `usage`（`.probe/acp_e2e.log:6`）：

```json
{"stopReason": "end_turn", "usage": {"totalTokens": 4382, "inputTokens": 4380, "outputTokens": 2}}
```

我们也填 `usage`（`_usage_of`，`acp_server.py:702`）。**这是唯一能上报 token 的地方**（见 6.2）；executor 没测到用量时这个字段整个不出现，而不是写 0。

### 4.4 `session/cancel`（**notification，不是 request**）

```json
{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"…"}}
```

没有 `id`，不期待回包：`prompt.ts:22 | await client.connection.agent.notify(methods.agent.session.cancel, { sessionId });`。

服务端的实现（`_session_cancel`，`acp_server.py:432`）置一个标志位，然后调 executor 的 `interrupt`（`_interrupt`，`acp_server.py:452`）真的打断正在跑的那一轮。`interrupt` 返回它是否停住了东西，这个返回值记在 `interrupt_hit` 里，被等待中的 `prompt` 用来决定回包说 `cancelled` 还是 `end_turn` —— 一次没打断任何东西的取消，不会让回包谎称「已取消」。

还没开始跑的 prompt 也能被取消：它拿到 session 锁后发现标志位已置，直接回 `cancelled`，一步都不跑。

### 4.5 `session/list`（request）

请求：`{"_meta": {"types": ["user", "scheduled"]}}`。
回包：`{"sessions": [SessionInfo, …]}`。

`SessionInfo` 的必填字段只有两个（`goose-acp-client/src/generated/types.gen.ts`）：

```ts
export type SessionInfo = {
    sessionId: SessionId;
    cwd: string;
    additionalDirectories?: Array<string>;
    title?: string | null;
    updatedAt?: string | null;
    _meta?: { [key: string]: unknown } | null;
};
```

我们回 `{"sessionId": …, "cwd": …}`（`acp_server.py:404-421`）已经满足。

### 4.6 `session/load` / `session/delete` / `session/close`

- `session/load`：**不支持**，`initialize` 里已声明 `loadSession: false`。客户端据此不会调它。
- `session/delete` / `session/close`：都走 `_session_drop`（`acp_server.py:373`），只丢本进程的记录。executor 自己的历史在它的 `persistence_dir` 里，不归这里管。删一个不存在的 id 不报错 —— 窗口会问两次。删一个**正在跑**的会话会先 `_abandon`（`acp_server.py:389`）停掉那一轮，否则 executor 会为一个已经不存在的窗口继续调工具、继续计费。

### 4.7 `_goose/unstable/*`（goose 私有扩展）

goose 在标准 ACP 之上加了一整套自己的方法，前缀固定 `_goose/unstable/`。**这一层不是可选的**：`defaults/read` 回空的后果不是少个字段，而是窗口停在「选个 provider」那一页，永远进不了聊天。

答案由 `rsi/goose_rpc.py` 决定，`acp_server.py` 只把它的两种失败翻成 JSON-RPC 错误码。抓包里出现过且已实现的：

| 方法 | 参数 | 答复 |
|---|---|---|
| `_goose/unstable/defaults/read` | `{}` | `{"providerId","modelId"}`，读 `config.toml` 的 `model_provider` / `model`；没有配置时两者都是 `null`（**不是空串**，schema 是 `String.nullish()`） |
| `_goose/unstable/config/read` | `{"key":"GOOSE_PROVIDER"}` | `{"value": …}`，认识的 key 回值，不认识的回 `null` 而不是报错 |
| `_goose/unstable/config/read-all` | `{}` | `{"config": {…}}`，含渲染层直接读的 `GOOSE_PROVIDER` / `GOOSE_MODEL` / `active_provider` / `providers` |
| `_goose/unstable/providers/list` | `{}` 或 `{"providerIds":[…]}` | `{"entries":[…]}`，每个块一条；只用当前 `model_provider` 那条带 `defaultModel` 和 `models` |
| `_goose/unstable/providers/catalog/list` | `{"format":"openai"}` | 同上形状（客户端两条路都走） |
| `_goose/unstable/config/fields/read` | `{"providerId": …}` | 可编辑字段；密钥只报 `isSet: true`，`value` 恒为 `null` |
| `_goose/unstable/config/readiness` | `{"providerId": …}` | `{"ready", "error"}`；`env_key` 指向不存在的变量时 `ready: false` 并说明原因 |
| `_goose/unstable/session/info` | `{"sessionId": …}` | `{"session": {…}}` —— **必须带 `session` 外层**，见下 |
| `_goose/unstable/session/rename` | `{"sessionId","title"}` | 改标题 |
| 其余 `/list` 结尾 | — | 空数组（`recipes` / `extensions` / `schedules` 等这一类，`rsi/goose_rpc.py:38` 的 `EMPTY_LISTS`） |

**`session/info` 的两种必错写法**：回 `{}` 会让 `sessions.ts:268` 拿到 `undefined` 的 `sessionInfoResponse.session`，接着 `sessions.ts:80` 读 `s._meta` 直接 TypeError，`createSession` 抛异常，**会话永远建不出来**；回 `{…}`（不带 `session` 外层）字段全被忽略，症状是会话能建但标题、`messageCount` 全是空的。`tests/test_goose_rpc.py` 钉的是前者，因为它是会崩的那个。

这条不是从抓包里读出来的 —— `.probe/acp_srv_probe.log` 里 goose 只走到 `providers/catalog/list` 就被断了（`:49` WS disconnect 1001），从没走到 `session/new`。它是从 `sessions.ts` 源码读出来的，然后被真机复现确认：**未实现时窗口停在 onboarding**。

---

## 五、`session/update` 通知

```json
{"jsonrpc":"2.0","method":"session/update",
 "params":{"sessionId":"…","update":{"sessionUpdate":"agent_message_chunk","content":{…}}}}
```

goose 前端真正渲染的变体，全部在 `ui/desktop/src/acp/sessionNotificationAdapter.ts:78-111` 的 `switch` 里：

| `sessionUpdate` | 客户端行为 | 源码 |
|---|---|---|
| `user_message_chunk` | 追加到 user 气泡 | `:80` |
| `agent_message_chunk` | 追加到 assistant 气泡 | `:82` |
| `agent_thought_chunk` | 追加到思考区 | `:84` |
| `tool_call` | 建一张工具卡片 | `:86` |
| `tool_call_update` | 改那张卡片的状态/内容 | `:88` |
| `session_info_update` | 改会话标题、`activeRunId`、确认 steer | `:90` |
| `usage_update` | **什么都不做**（`return []`） | `:109` |
| 其它 | 静默丢弃 | `default: return [];` |

**关键含义**：客户端对未知变体是宽容的（`default` 分支丢弃而不是报错），所以多发不会崩；但 `usage_update` 目前是空实现，token 数在那里画不出来。

### 5.1 `tool_call` 的字段

```ts
export type ToolCall = {
    toolCallId: ToolCallId;      // 必填，与后续 update 配对
    title: string;               // 必填，卡片标题
    name?: string | null;
    kind?: ToolKind;
    status?: ToolCallStatus;
    content?: Array<ToolCallContent>;
    locations?: Array<ToolCallLocation>;
    rawInput?: unknown;
    rawOutput?: unknown;
};

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";
export type ToolKind = "read"|"edit"|"delete"|"move"|"search"|"execute"|"think"|"fetch"|"switch_mode"|"other";
```

`toolCallId` 是唯一的硬约束：`tool_call` 和 `tool_call_update` 靠它配对，配不上就变成两张卡或一张永远转圈的卡。

id 直接跟 executor 自己的 `call_id` 走 —— `rsi/oh_events.py:153/180/213/228` 把 OpenHands SDK 的 `tool_call_id` 原样带进事件，`_open_call`（`acp_server.py:645`）拿它当 id，`_close_call`（`acp_server.py:665`）按它找回来配：

```python
return "call-" + (key or format(self._call_counter, "06d"))
```

没有 `call_id` 的事件（`CodexBackend` 那条路径）退回进程内计数器，同名的按先来先配。因此两张同工具的卡永远是两个 id，结果乱序回来也落在自己的卡上 —— 由 `tests/test_acp_server.py::ToolCallIdentityTests` 三条钉住，并做过变异验证（改回只按名字配对，`test_a_result_closes_the_call_its_id_names` 变红）。

当前实现固定 `"kind": "other"`（`acp_server.py:619`），所以 goose 里所有工具都画同一个图标。

---

## 六、事件翻译表

`rsi/backend.py` 只发八种 kind（`EVENT_KINDS`）：`step.started` `step.message` `tool.called` `tool.result` `plan.updated` `model.retry` `run.finished` `approval.decided`。

`acp_server.py:_relay`（`:593-643`）的映射：

| RSI kind | ACP 输出 | 说明 |
|---|---|---|
| `step.message` 有 `thinking` | `agent_thought_chunk` | 思考内容单独一路 |
| `step.message` 有 `assistant` | `agent_message_chunk` | 同时记进 `session.spoken` |
| `tool.called` | `tool_call`，`status: "pending"` | |
| `tool.result` | `tool_call_update`，`completed`/`failed` | `output` 截 4000 字（`:431`） |
| `model.retry` | `agent_thought_chunk`，文案 `retrying: …` | 借思考区报重试 |
| `step.started` / `plan.updated` / `run.finished` / `approval.decided` | 不发 | 客户端没有对应渲染位 |

### 6.1 终稿不重复发

`run.final` 通常是最后一个 `step.message` 的原文，已经以 `agent_message_chunk` 流过了。所以只在 `final.strip()` 不在 `session.spoken` 里时才补发一次（`acp_server.py:571-575`）——否则同一个答案会画两遍。

`session.spoken = assistant.strip()` 是**覆盖**不是累加（`acp_server.py:606`），所以多步任务的中间文本不在 `spoken` 里，最后一步的终稿也不会被误判为已发。这个设计的边界：如果终稿恰好等于某个中间步的文本，会被吞掉。当前接受。

### 6.2 token 数：填在 prompt 回包里

ACP 的 `usage_update` 我们不发，`prompt` 的 `usage` 字段填。两处都能填，但数据源不同：

- executor 事件里**没有** token 字段 —— `backend.py` 的 `RunResult` 有 `prompt_tokens` / `completion_tokens`（`rsi/agent.py:102-103`），但它们不在事件里。
- 所以填法是在拿到 `run` 之后，把 `run.prompt_tokens` / `run.completion_tokens` 填进回包的 `usage`，照 `.probe/acp_e2e.log:6` 里真 goosed 的形状。实现在 `_usage_of`（`acp_server.py:702`）。

**为什么不发 `usage_update`**：客户端对它的处理是 `return []`（`sessionNotificationAdapter.ts:109`），发了也画不出来；真正的位置是 prompt 回包的 `usage`。

---

## 七、已知缺口（按严重度）

### 7.1 ~~`session/info` 返回 `{}` → 客户端崩~~ 已修

修法就是 §4.7 那行：回 `{"session": {…}}`。`_describe_session`（`acp_server.py:404`）产出它，`tests/test_goose_rpc.py::SessionInfoTests` 钉住「回外层」和「未知 session 抛 `-32602`」两条，真机已验证能进聊天并跑真实任务。

### 7.2 ~~`session/delete` / `session/close` 未实现~~ 已实现

`_session_drop`（`acp_server.py:373`）。只丢本进程的记录，executor 自己的历史留在它的 `persistence_dir` 里；删一个不存在的 id 不报错，因为窗口会问两次。删一个**正在跑**的会话会先 `_abandon`（`acp_server.py:389`）停掉那一轮。

### 7.3 ~~token 用量不上报~~ 已上报

`prompt` 回包里现在有 `usage`：`_usage_of`（`acp_server.py:702`）把 `run.prompt_tokens` / `run.completion_tokens` 翻成客户端认的 `inputTokens` / `outputTokens` / `totalTokens`。形状取自真 goosed 的实测回包（`.probe/acp_e2e.log:6`）：

```
{"stopReason": "end_turn", "usage": {"totalTokens": 4382, "inputTokens": 4380, "outputTokens": 2}}
```

两种情况刻意区分：executor 报了两个 0（没测到）时**整个 `usage` 字段都不出现**，不写 0 —— 0 是「这一轮免费」，而真相是「这一轮没被测量」，两者不一样。`tests/test_acp_server.py::UsageTests` 钉住两条。

`usage_update` 通知仍然不发：客户端对它的处理是 `return []`（`sessionNotificationAdapter.ts:109`），发了也画不出来。

### 7.4 ~~`CANCEL_GRACE` 是死代码~~ 已删除

它从来只被定义、没人读（旧 `acp_server.py:67`），注释描述的「等一会儿」这个等待从来不存在。删掉而不是补一段等待：真实语义不是「等」，而是

- **还没开始**的 prompt：`_session_prompt` 拿到 session 锁后发现 `cancelled` 就回 `cancelled`，一步都没跑；
- **已经在跑**的 prompt：`_session_cancel` 调 executor 的 `interrupt`，然后**还要看这一轮自己是怎么结束的**（`_was_stopped`）——只有三件事同时成立才回 `cancelled`：客户端要求停、executor 说它停了东西、这一轮不是自己跑完的。

第三条是第二轮之后才补上的，因为漏了它会造成一种很难发现的假话：SDK 对同步 `run()` 的回退是 `pause()`，它让当前那次请求跑完再停。于是「打断成功」的运行可能仍然正常结束，而回包说 `cancelled` —— 用户屏幕上答案都在，界面却说任务被放弃了。同理，一个报错的运行是 `refusal`，不是 `cancelled`。

四种情况都由 `tests/test_acp_server.py::ShutdownTests` 钉住（正常结束被取消 → `end_turn`；报错被取消 → `refusal`；真被打断 → `cancelled`；不取消 → `end_turn`）。

### 7.5 ~~并行工具调用会撞 `toolCallId`~~ 已修

旧 `_call_id`（`index` + `name`）要求同一 step 内工具名唯一，并行调用两张卡会合成一张。现在 id 跟着 executor 自己的 `call_id` 走：`rsi/oh_events.py:153/180/213/228` 把 SDK 的 `tool_call_id` 原样带出来，`_open_call` / `_close_call`（`acp_server.py:645/665`）按它配对，结果可以乱序回来。没有 `call_id` 的事件（`CodexBackend` 那条）退回一个进程内计数器，同名的仍按先来先配。

`tests/test_acp_server.py::ToolCallIdentityTests` 三条：同名两次不同 id、乱序结果落在自己的卡上、孤立结果也有 id。**做过变异验证**：把按 id 配对改回只按名字，`test_a_result_closes_the_call_its_id_names` 变红。

### 7.6 工具卡片固定 `kind: "other"`

`acp_server.py:619` 写死 `"kind": "other"`，所以 goose 里所有工具画同一个图标。executor 的 `tool.called` 带 `name`，映射成 `read`/`edit`/`execute` 是可能的，只是没做。

---

## 八、怎么自己验

```powershell
# 1. 纯协议层，不烧 API
python -m pytest tests/test_acp_server.py tests/test_goose_rpc.py -q

# 2. 起服务
python -m rsi.cli acp --port 57800 --secret probe-secret

# 3. 接到 goose 桌面端
$env:GOOSE_EXTERNAL_BACKEND="1"
$env:GOOSE_EXTERNAL_BACKEND_URL="http://127.0.0.1:57800"
$env:GOOSE_SERVER__SECRET_KEY="probe-secret"
Start-Process <goose 安装目录>\Goose.exe
```

`tests/test_acp_server.py` 覆盖**协议本身**：握手三连、密钥四种情况、`initialize` 版本协商、JSON-RPC 错误码、`prompt` 全流程（含终稿不重发、错误走 `refusal`）。用 `FakeBackend`，不碰模型、不联网。

`tests/test_goose_rpc.py` 覆盖**私有方法那一层**：每个回包按字段名断言，因为缺字段的失败模式是客户端静默回落到 onboarding，不会有任何异常冒出来。它读真的 `config.toml`（写进临时目录），不是桩掉 reader——这一层的意义就是「它说的和 executor 会用的一致」，桩掉就不证明了。

**这两套都测不到的**：客户端读了我们没预料到的字段。7.1 是那么发现的，而且不是靠抓包（那次连接没走到 `session/new`），是靠读 `sessions.ts` 源码，再回真机复现。真机连一次仍然是唯一能发现这一类的地方。
