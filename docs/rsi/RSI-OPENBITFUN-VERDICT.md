# OpenBitFun 底座判断报告：RSI 引擎与它的关系

> 写给皇上和后续所有参与的人。这是一个**判断题**，不是编码题——路选错，后面几个月的工作都跟着错。
> 本文每一条结论都带代码位置。管理员给我的转述我逐条核过，**有四处与代码不符**，见附录一。
> 调研范围：`D:\RSIHarness\desktop`（分支 `feat/openbitfun-desktop`），未改动任何代码。

---

## 零、一句话结论

**走第二条路：OpenBitFun 的引擎跑普通任务，RSI 专管自我改进；两者之间用「stdio ACP 子进程」连接——不是把 RSI 塞进 Rust，也不是把 RSI 降级成一个 adapter crate。**

理由一句话：OpenBitFun 已经**原生支持**把外部 agent 当子进程接进来，而且**自带一个完全对标的范本**（`packages/dsh-acp`，给"没有 ACP 入口的引擎"套一层 stdio 桥）。我们照它写一个 Python 版，工作量比任何一条"改 Rust"的路都小一个数量级。

---

## 一、先把事实摆清楚

### 1.1 三条错误预期（先说清楚，免得后面判断建立在错的数字上）

| 说法 | 实际 | 证据 |
|---|---|---|
| 「8 层、66 个 crate」 | **workspace members = 54**；磁盘上 Cargo.toml 共 59 个 | `desktop/Cargo.toml:2 | members = [` 至 `:57 | ]`（中间 54 行带引号）；`Get-ChildItem -Recurse -Filter Cargo.toml` = 59 |
| 「dsh-adapter 是把 dsh 当外部 AI 工作源接进来的范例」 | **它不是接 agent 的**，是读 dsh 的插件清单和会话记录的**只读投影器**，不执行任何东西 | 见 1.3 |
| 「内置预设 7 个」（我读出来的候选） | 实际 **5 个** | `builtin_clients.rs` 里 `id: "..."` 共 5 处：`:35` opencode、`:50` dsh、`:66` omp、`:76` claude-code、`:86` codex |

后两条正好颠倒了——**真正能当模板的不是 dsh-adapter，是别处。**

### 1.2 OpenBitFun 的引擎本体

`src/crates/execution/agent-runtime/src` 共 **77 个 .rs 文件、1,366,925 字节**。`lib.rs` 导出 40+ 个模块，与"会话/上下文/压缩/权限/事件/记忆"对应的有：

```
lib.rs:13 | pub mod checkpoint;
lib.rs:23 | pub mod deep_review;
lib.rs:29 | pub mod event_queue;
lib.rs:37 | pub mod evidence_ledger;
lib.rs:43 | pub mod permission;
lib.rs:67 | pub mod session;
lib.rs:71 | pub mod session_state;
```

这是一个**完整的、自己跑模型的** agent 运行时。它不需要我们的 Python 引擎才能工作。

### 1.3 `dsh-adapter` 到底做什么（关键校正）

`src/crates/adapters/dsh-adapter/src/lib.rs:1-7` 原文：

```rust
//! DeepSeek Harness (`dsh`) bundle source adapter.
//!
//! The production surface is intentionally small: load a `dsh`-compatible
//! managed package (its `package.json` bundle/profile declaration and any
//! declared `cordis.patch.yml` bundle patch) as a projection-only plugin runtime
//! adapter. The adapter does not execute Cordis plugins, install npm packages,
//! or depend on a user-local `dsh` CLI.
```

`session.rs:1` 更直接：

```rust
//! Read-only DeepSeek Harness v0 transcripts; no Cordis or CLI execution.
```

它只做两件事：
1. **插件源投影**：把一份 `package.json` 里 `dsh.bundle.patch` / `dsh.profile.bundles` 声明的 Cordis 插件行，投影成 OpenBitFun 的"插件源"（`source_adapter.rs:307 pub fn load_dsh_package_adapter`）。
2. **会话导入**：只读 `$DSH_HOME/sessions/**/session.jsonl`（`session.rs:14 SOURCE_REVISION = "dsh-session-v1"`，`session.rs:23 ECOSYSTEM = "deepseek-harness"`，`session.rs:62` 只匹配 `session.jsonl` 或 `session.jsonl.zstd`）。

**它跟"把 RSI 引擎接进来"没有关系。** 它接的是 dsh 的**配置文件和历史记录**，不是 dsh 的运行时。

其他 `*-adapter` 同一个模式，全部是 runtime-free：

```
claude-code-adapter/src/lib.rs:1 | //! Runtime-free Claude Code source adapter.
codex-adapter/src/lib.rs:1      | //! Runtime-free Codex source adapter.
zcode-adapter/src/lib.rs:1      | //! Read-only Zcode source translation. Does not launch Zcode or execute its tools.
cursor-adapter/src/lib.rs:1     | //! Bounded, read-only Cursor history translation. Imported tools never execute.
```

**所以"照 dsh-adapter 写一个 rsi-adapter"这个设问，方向就是错的**——写了也只能读 RSI 的配置文件，跑不了 RSI 的循环。

### 1.4 真正的外部 agent 接入通道：ACP over stdio

`src/crates/interfaces/acp/src/lib.rs:1-4`：

```rust
//! OpenBitFun Agent Client Protocol integration.
//!
//! This crate owns the ACP client and server surfaces over OpenBitFun's assembled
//! runtime. Product hosts select the additive `client` and `server` features
//! explicitly; the compatibility default enables both roles.
```

它同时提供**客户端**（`AcpClientService`）和**服务端**（`AcpServer` / `OpenBitFunAcpRuntime`）。客户端这一侧就是拿来接外部 agent 的。

外部 agent 的配置结构（`client/config.rs`）：

```rust
pub struct AcpClientConfig {
    pub name: Option<String>,
    pub command: String,          // ← 只有命令
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub enabled: bool,
    pub readonly: bool,
    pub subagent: AcpClientSubagentConfig,
    pub permission_mode: AcpClientPermissionMode,
}
```

**没有任何 URL / host / port 字段。** 传输只有两条分支（`client/manager.rs:1811 open_transport_for_connection`）：

```rust
match remote_connection_id {
    Some(remote_connection_id) => self.start_remote_transport(...)   // ← SSH
    None => self.start_local_transport(...)                          // ← 本地子进程
}
```

本地那条（`manager.rs:1757-1767`）：

```rust
let program = resolve_configured_command(&config.command, &config.env);
let mut command = openbitfun_core::util::process_manager::create_tokio_command(&program);
command
    .args(&config.args)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
```

远程那条走 `ssh_manager.open_workspace_stdio(...)`——也是**在远端起一个 stdio 子进程**。

**结论：OpenBitFun 接外部 agent 的唯一通道是「起一个子进程，用 stdin/stdout 说 ACP」。没有 WebSocket，没有 HTTP。** 这与 `rsi/acp_server.py` 现在是 ASGI/WebSocket 服务（`run(host, port, secret, ...)`）不兼容——这是我们必须处理的第一件事。

### 1.5 现成的范本：dsh 自己怎么进去的

`client/builtin_clients.rs` 的内置预设里，dsh 那一条（`:50-58`）：

```rust
BuiltinAcpClientPreset {
    id: "dsh",
    command: "dsh",
    args: &["--profile", DSH_BUNDLED_PROFILE],
    tool_command: "dsh",
    install_package: Some("@deepseek-ai/dsh"),
    adapter_package: None,
    adapter_bin: None,
    bundled_profile: Some(DSH_BUNDLED_PROFILE),
},
```

`DSH_BUNDLED_PROFILE = "openbitfun-acp"`（`builtin_clients.rs:31`）。

旁边的注释（`builtin_clients.rs:44-48`）是整个判断的核心，原文：

```
// DeepSeek Harness (dsh) — the harness has no ACP entry point of its own,
// so OpenBitFun ships one as a dsh PROFILE (packages/dsh-acp) and launches it
// through the user's own installation. The model and the API key stay in
// dsh, where the user configured them; OpenBitFun stores neither.
```

**dsh 也没有 ACP 入口。OpenBitFun 的处理方式是：自己写一个桥，把桥塞进对方的安装里，然后用对方的启动命令拉起它。**

那个桥就是 `packages/dsh-acp`：
- `bin.ts:1-12`：`#!/usr/bin/env node` … `dsh-acp-ide [--config path]` … 「**Stdout is reserved for JSON-RPC, so diagnostics go only to stderr**」
- `src/` 共 **1,540 行 TypeScript**：`bridge.ts` 53,174B / `app.ts` 10,006B / `tool-view.ts` 5,524B / `codec.ts` 2,653B / `bin.ts` 1,226B
- `app.ts:1-17` 自己组装 `agent-spine-demo` + `dsh-tools` + `dsh-tools` 的持久化/查询 + `./bridge.ts`
- `client/dsh_profile.rs:1-18` 负责把构建产物**幂等地**拷进 `$DSH_HOME/profiles/`（内容 digest 判重），远程工作区也有一份（`ensure_bundled_profile_remote`）

**这就是模板，而且它解决的正是我们的问题：一个没有 stdio ACP 入口的引擎，怎么被 OpenBitFun 接进去。**

---

## 二、三个方案，各自的代价

### 方案 A：用它的引擎替代 RSI

把 `rsi/improve.py` 的自我改进逻辑用 Rust 重写，长进 `agent-runtime`。

**代价：**
- 要重写的是 RSI 的**全部心跳**：`improve.py` 379 行只是主干，它还依赖 `gate.py`（13,400B 的门禁）、`store.py`（25,411B 的代际存储）、`taskset.py`（25,634B 的任务集与判分）、`golden.py`、`stats.py`。这些是一整套「有代际、可回滚、可审计」的工程设施，而且是毕设的创新点本身。
- 团队没有 Rust 经验（这是已知前提）。重写期间 RSI 完全停摆，没有中间态可交付。
- 重写完还要跟上游 3,543 个 PR 持续解冲突——而 RSI 是**我们唯一独有的东西**，把它和上游绑成一对，等于永久失去"上游怎么变都不影响我的创新点"这个优势。

**判断：不可行。**

### 方案 B：它的引擎跑普通任务，RSI 专管自我改进（**推荐**）

OpenBitFun 用自己的引擎做日常对话、工具调用、会话管理、权限、压缩——这些它已经做得比我们好，而且是我们几个月都做不出来的量。RSI 作为一个**外部 agent 子进程**挂进去，只在需要自我改进时被调用。

**落地形态**：照 `packages/dsh-acp` 的样式，写一个 `rsi/acp_stdio.py`——把现有的 `acp_server.py` 的 JSON-RPC 分发逻辑，换一个「stdin/stdout 帧」的传输层。

**关键证据：这个改动是可能的且很小的——而且已经做了一半。** `acp_server.py` 的核心分发已经是纯回调：

```python
acp_server.py:344 |     async def _serve_frame(self, frame: dict, send: Callable,
acp_server.py:345 |                            connection: str | None = None) -> None:
```

`send` 是一个 `Callable`，不是 websocket 对象。现有实现里 websocket 只是其中一种 `send`。换一个写 stdout 的 `send`、换一个读 stdin 的 `receive`，分发、方法表、`_relay`、`_update` 全部复用。

并且 `rsi/acp_stdio.py` 已经按这个思路写出来了（245 行，见第五章的更正）。

**代价：**
- 新增一个传输层（估 200–400 行 Python，含 Windows 下的二进制/UTF-8 处理）。
- 需要在 OpenBitFun 侧加一个内置预设（一条 `BuiltinAcpClientPreset` 记录）+ 一个安装/探测逻辑。参照 dsh 那条，是**一个结构体字面量**加几行 prerequisite probe。
- RSI 的 Python 环境要保证在用户机器上可用（`uv` 或装 Python），这是 dsh 那条路已经解决过的问题，可以照抄。

**判断：代价最小，且保留了 RSI 的独立性。**

### 方案 C：RSI 作为它的一个 adapter crate

在 `src/crates/adapters/rsi-adapter` 写一个 Rust crate，让 OpenBitFun 认识 RSI。

**代价与判断：**
- **首先要说清楚：现有的 `*-adapter` 没有一个能当模板**，因为它们全是"只读别人配置"的投影器（1.3 节）。写 `rsi-adapter` 要么同样只读（那就跑不了循环，无意义），要么就是在 Rust 里重跑 RSI——退化成方案 A。
- 如果"adapter"指的是 ACP 客户端预设，那**不需要新 crate**：`builtin_clients.rs` 里加一条结构体就行，那是配置，不是 crate。
- 所以方案 C 实际上没有一个成立的含义。它或者等于 A，或者等于 B 的一个小配置改动。

**判断：作为独立路线不成立。**

---

## 三、RSI 的自我改进循环能落在哪一层

**结论：落在 OpenBitFun 之外，作为一个 ACP 子进程；它的"结果"通过 ACP 会话回传给 OpenBitFun。不要试图把它塞进 `agent-runtime`。**

### 3.1 先看 OpenBitFun 有没有现成的位置

`agent-runtime` 里有两个看起来接近的模块：

**`evidence_ledger`**（`lib.rs:37`，`evidence_ledger.rs`）：
```rust
pub const EVIDENCE_LEDGER_SCHEMA_VERSION: u32 = 1;
pub enum EvidenceLedgerTargetKind { File, Command, Subagent, Artifact, Checkpoint, Unknown }
pub enum EvidenceLedgerEventStatus { Created, Succeeded, Failed, PartialTimeout, Cancelled, Unknown }
```
它记的是**一次会话里每条证据的产生与结果**。RSI 要的是**跨代际的采纳记录**（哪一代、凭什么被采纳、能不能回滚）。两者的时间尺度不同：一个是一次 run 内，一个是多次 run 之间。**语义不对口，不能直接复用。**

**`deep_review`**（`lib.rs:23`，17 个子模块）：
```rust
//! Deep Review provider-neutral runtime policy and state owners.
//! Concrete workflow execution, AI calls, report delivery, and host-side tool
//! side effects remain in product assembly/core adapters until equivalence is
//! separately protected.
```
这是"代码评审"的多 agent 编排（budget / concurrency / report / team_definition）。形态上像我们的 improve()——都是"多轮、有预算、有裁决"。**但它的产物是评审报告，我们的产物是一个新的 harness 代际 + 可回滚的指针。** 没有 `commit(generation)` 这类概念。

### 3.2 RSI 需要什么，OpenBitFun 没有什么

`rsi/improve.py` 的一轮完整链路（行号取自当前文件，379 行）：

```
improve.py:189 | def improve(
improve.py:255 |     agent = make_runner(model=model, timeout=float(timeout))
improve.py:292 |     verdict = gate(surface, live, candidate, levels=("L1", "L4"))
improve.py:337 |     new_gen = store.commit(gen.id, candidate, kind="manual", ref="stable",
```

它需要的能力：
1. **代际存储 + 原子指针切换 + 回滚**（`store.py`，25KB）
2. **分级门禁 L1–L4**（`gate.py`，13KB）
3. **train/held-out 双测与判分**（`taskset.py`，26KB）
4. **"提案者看不到 held-out 和答案"的信息屏障**（`improve.py` 的 prompt 构造）

OpenBitFun 侧**一个都没有**，也不应该为它加——那是毕设的创新点，不是通用 agent 平台的职责。

### 3.3 所以落点

**落在 `rsi/`，通过 ACP 会话与 OpenBitFun 交互。** 具体地：

- OpenBitFun 侧：新增一条 ACP 客户端预设（`builtin_clients.rs` 里加一个 `BuiltinAcpClientPreset`），`command` 指向我们的 stdio 桥。
- RSI 侧：`rsi/acp_stdio.py` 新增 stdio 传输，复用 `acp_server.py` 的 `_serve_frame` / `_dispatch` / `_relay`。
- 自我改进仍由 `improve.py` 驱动，它现在调 `make_runner()`（`improve.py:255`），换成通过 ACP 让 OpenBitFun 的引擎来跑提案——这样"提案者"和"被改进的对象"仍然是同一个执行者，这是 `improve.py` 注释里强调的可证伪性前提。

**缺的东西**：基本的传输层已经写了一半（`rsi/acp_stdio.py`，245 行）；缺的是它的测试与 CLI 接线。其余全部现成。

---

## 四、`dsh-adapter` 能不能当模板

**不能。而且这个设问的方向需要纠正。**

- 它读的是 dsh 的 `package.json` 和 `session.jsonl`（1.3 节），**不执行、不驱动、不调用**任何 agent。
- 照它写 `rsi-adapter`，产出的东西只能"导入 RSI 的历史会话到 OpenBitFun"，跑不了 improve()。

**真正该当模板的是另外两样东西，按工作量从小到大：**

| 模板 | 是什么 | 我们的用法 | 量级 |
|---|---|---|---|
| `builtin_clients.rs` 的 dsh 预设（`:50-58`） | 一个结构体字面量 + 字段 | 加一条 `rsi` 预设，`command` 指向我们的桥 | **十几行** |
| `packages/dsh-acp`（1,540 行 TS） | 给"没有 ACP 入口的引擎"套 stdio 桥的完整实现 | 我们已有 ACP 分发逻辑（`acp_server.py` 1,010 行）+ 已写好的传输层（`acp_stdio.py` 245 行） | **补测试 + 接 CLI，不是重写** |

第二项是这个判断里最有价值的发现：**dsh 面对的困难和我们的完全相同——都没有 stdio ACP 入口——而 OpenBitFun 已经给出了完整解法。我们不是从零开始，是照着抄，而且已经抄了一半。**

---

## 五、建议的执行顺序

**重要更正（写报告时才发现）**：`rsi/acp_stdio.py` **已经存在**——2026-10-24 20:21 落盘，245 行，`python -c "from rsi import acp_stdio"` 可导入，公开面为 `StdioServer` / `serve_stdio` / `engine_home` / `main`。但 `tests/test_acp_stdio.py` **不存在**，`rsi/cli.py` 里也**没有** `acp-stdio` 子命令（grep `acp_stdio|acp-stdio` 在 `cli.py` 零命中）。

另有一份更早的封存版在 `.probe/path2-parked/acp_stdio.py`（196 行），与线上这份**不同**。

所以下面第 1 步已经部分完成，实际要做的是补完而不是从零写：

1. **补 `tests/test_acp_stdio.py`。** 封存版配套的测试（`.probe/path2-parked/test_acp_stdio.py`，7,360B）覆盖了四条关键契约：一帧一行、畸形行不断连接、多请求并发在飞（`session/prompt` 阻塞读取会让客户端的 cancel 永远排在后面）、输入结束要停掉在跑的 run。这四条是传输层的全部价值，一行都不能少。
2. **在 `rsi/cli.py` 加 `acp-stdio` 子命令。** 照现有 `acp` 子命令（`cli.py:303 cmd_acp`）的样子加一个，不动已有的 `acp`。
3. **手工握手验证。** 用 OpenBitFun 侧的 ACP 客户端预设直接连我们的桥，跑通 `initialize` → `session/new` → `session/prompt` → `session/update`。
4. **验证通过后，才动 OpenBitFun 侧。** 加内置预设（`builtin_clients.rs` 里一条 `BuiltinAcpClientPreset`）、加探测逻辑。
5. **最后才谈自我改进怎么从 OpenBitFun 界面触发。** 在那之前 RSI 的 improve() 仍然可以从命令行跑，不必等。

**第 1–3 步不依赖任何 OpenBitFun 侧改动，可以立刻开始，且失败不影响任何人。**

---

## 六、我不确定的地方（不编）

1. **`AcpClientConfig` 是否还有别的字段被我漏掉**——我只读了 `config.rs` 的 struct 定义，没读它的反序列化路径。如果存在 `#[serde(flatten)]` 之类，可能有额外字段。
2. **OpenBitFun 的 ACP 客户端对 `session/update` 变体的接受度**——我只确认了它消费 ACP 标准协议（`agent_client_protocol` crate），没读 `client/stream.rs`（26,702B）确认它具体渲染哪些变体。这会影响"RSI 的事件能不能在 OpenBitFun 界面里正确显示"。
3. **`rsi/acp_server.py` 的 `send` 回调是否真的完全传输无关**——我读到签名是 `send: Callable`，但没有把所有用到 `send` 的位置逐个核过（特别是 `_update` 和 `_session_prompt` 里跨线程的 `queue` 那一段）。这是方案 B 可行性的关键假设，**开工前必须先验证**。
4. **长期跟上游的成本**——方案 B 在 OpenBitFun 侧的改动很小（一个预设 + 一个 stdio 桥），理论上冲突面很小；但我没有实际演练过 merge 一次上游。

---

## 附录一：管理员转述中与代码不符的地方

| # | 转述 | 代码实际 | 位置 |
|---|---|---|---|
| 1 | 「8 层、66 个 crate」 | workspace members = **54**，磁盘 Cargo.toml 59 个 | `desktop/Cargo.toml:2-56` |
| 2 | 「`dsh-adapter` 是把 dsh 当外部 AI 工作源接进来的现成范例」 | 是**只读的插件源投影 + 会话导入**，不执行任何 agent | `dsh-adapter/src/lib.rs:1-7`、`session.rs:1` |
| 3 | 「`{claude-code,codex,opencode,cursor,zcode}-adapter` 都是外部 agent 接入范例」 | 全部是 `Runtime-free` / `Read-only`，只读对方配置 | 五个 crate 的 `lib.rs:1` |
| 4 | （隐含）外部 agent 可以通过网络接 | `AcpClientConfig` 只有 command/args/env；transport 只有本地子进程与 SSH 两条 | `client/config.rs`、`manager.rs:1811` |

**这四条不改变最终结论的方向，但改变了理由。** 如果按转述去照 `dsh-adapter` 写 crate，会做出一个跑不了 RSI 的东西。

## 附录二：关键文件清单（复核用）

```
desktop/Cargo.toml                                        workspace members=54
desktop/src/crates/interfaces/acp/src/lib.rs              ACP client + server
desktop/src/crates/interfaces/acp/src/client/config.rs    AcpClientConfig（无 url 字段）
desktop/src/crates/interfaces/acp/src/client/manager.rs   :1811 传输二选一；:1757 stdio 子进程
desktop/src/crates/interfaces/acp/src/client/builtin_clients.rs  :31 DSH_BUNDLED_PROFILE；:50 dsh 预设
desktop/src/crates/interfaces/acp/src/client/dsh_profile.rs      把桥拷进 $DSH_HOME/profiles
desktop/packages/dsh-acp/src/                            1540 行 TS 的 stdio 桥（模板）
desktop/src/crates/adapters/dsh-adapter/src/lib.rs       只读投影，不是 agent 接入
desktop/src/crates/execution/agent-runtime/src/          77 文件 / 1.37MB，OpenBitFun 自己的引擎
RSIHarness/rsi/improve.py                                379 行，:189 improve / :255 make_runner / :337 commit
RSIHarness/rsi/acp_server.py                             1010 行 ASGI；:344 _serve_frame(frame, send, connection) 是纯回调；56 条测试
RSIHarness/rsi/acp_stdio.py                              245 行，stdio 传输（20:21 落盘，可导入，无测试无 CLI）
RSIHarness/.probe/path2-parked/acp_stdio.py              196 行封存版 + test_acp_stdio.py 7360B
```
