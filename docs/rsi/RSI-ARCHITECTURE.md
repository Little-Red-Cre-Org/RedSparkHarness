# RSI Harness 架构

> 本文描述**当前代码真实的样子**，不是设想。每个模块、每条依赖都对应仓库里实际存在的文件。
> 设计动机见 RSI-DESIGN.md，实施过程见 RSI-ROADMAP.md。

---

## 一、项目全貌

仓库分三层。**下面两层是上游 Harness2 的，上面一层是我们加的。**

```
┌─────────────────────────────────────────────────────────────┐
│  rsi/            ← 本项目新增：生命周期层（约 1,600 行）      │
│  代际存储 · 采纳门禁 · HTTP 服务 · 压测                        │
├─────────────────────────────────────────────────────────────┤
│  harness2/       ← 上游：方法论层（约 4,000 行，仅两处补丁）   │
│  递归 · 证据树 · 选择 · 经验库 · 提示词                        │
├─────────────────────────────────────────────────────────────┤
│  third_party/ + dependencies/  ← 上游 benchmark 与工具链       │
└─────────────────────────────────────────────────────────────┘
```

**代码量对比（这正是项目定位的量化说明）：**

| 层 | 文件 | 行数 |
|---|---|---|
| `rsi/`（我们） | 10 个 .py | ~3,400 |
| `harness2/`（上游） | 44 个 .py | ~4,000 |
| 我们的测试 | 5 个 .py | 1,088 |
| 上游测试 | 1 个 .py | 264 |

我们没有重写搜索算法，**一行都没有**。加的是它缺的那一层。

---

## 二、分层依赖

分层按「谁可以依赖谁」写，不按目录写。箭头指向被依赖者。

```
  入口    cli.py ─────────────▶ client.py (Tkinter)
             │                       │
             │ (延迟导入)             │
             ▼                       ▼
  执行   server.py ──▶ gate.py ──▶ golden.py
             │             │            │
             │             │            └─▶ 子进程跑 golden task
             ▼             ▼
  存储   store.py  ◀──── sessions.py ────▶ agent.py
             │                  ↑                 │
             │               注入 Runner          │ 调模型 / 调工具
  压测   stress.py ──▶ server.py                 │
             ▼                                   ▼
    ═══════════════════════════════════════════════════════
      harness2.core (tree / runmark / spec)   模型端点 (OpenAI 兼容)
    ═══════════════════════════════════════════════════════
```

### 实际 import 关系（AST 提取，非推测）

| 模块 | 模块级依赖 | 延迟导入 | 上游 |
|---|---|---|---|
| `store.py` | — | — | `harness2.core.tree` |
| `golden.py` | — | — | `harness2.core.tree` |
| `agent.py` | — | — | `harness2.core.tree` |
| `sessions.py` | — | `agent`（仅 `workspace()`） | `harness2.core.tree` |
| `gate.py` | `golden` | — | `harness2.core.tree` |
| `server.py` | `store` | `gate` | `harness2.core` |
| `client.py` | `agent`, `sessions`, `store` | — | `harness2.substrate.opencode` |
| `stress.py` | `store` | `server` | — |
| `cli.py` | `store` | `client`, `gate`, `server` | `harness2.substrate.opencode` |

模块级依赖**无环**（脚本可查）。

### 两条刻意的边界

**一、存储不决定怎么执行。** `sessions.py` 在模块级不 import `agent`。它声明两个
Protocol——`Runner`（能跑一个 task）与 `RunResult`（跑完能被归档的 7 个属性）——
由调用方注入。理由不是洁癖：这样测试能用假 runner 驱动整个存储层，不必连模型；
`tests/test_sessions.py` 里有一条测试专门起子进程断言 `rsi.agent` 没被导入。

**二、`cli.py` 不在模块级 import `client.py`。** 否则每个 `rsi list` 都要先载入
Tkinter 并建一个 Tcl 解释器，在无显示器的机器上直接失败。

**关键性质：`rsi/` 从不 import `harness2.core.recursion`、`selection`、`prompts`、`library`。**
搜索算法完全在上游黑盒里，我们只在它产出的树之上做文章。

---

## 三、数据流：一次完整的采纳

这是整个系统最重要的一条路径。

```
① 候选 harness（来自上游搜索，或人工编辑的目录）
        │
        ▼
② gate.py :: gate(surface, live_tree, candidate)
        │
        ├── L1 静态 ── tree.validate() + compile() 每个 .py
        │      失败 → 返回 GateResult(ok=False, level="L1")
        │
        ├── L4 预算 ── tree.diff_summary() 对比阈值
        │      失败 → level="L4"
        │
        ├── L2 冒烟 ── golden.py 起子进程真跑 2 个任务
        │      失败 → level="L2"，附 stderr
        │
        └── L3 回归 ── 与 live 对比，检测倒退
               失败 → level="L3"
        │
        ▼ 全部通过
③ store.py :: commit(parent=live, tree, evidence={"gate.json": ...})
        │
        ├── 计算 content_hash（与上游 runmark.fingerprint 同算法）
        ├── 查重：内容已存在于任何代际 → 拒绝
        ├── 写 generations/<新id>/{manifest.json, tree/, evidence/}
        ├── 冻结为只读
        └── 原子更新 refs/stable.json（os.replace）
        │
        ▼
④ server.py :: LiveHarness 缓存失效
        │
        ▼
⑤ 下一次 /current 请求拿到新代际（读者无感，无需重启）
```

### 为什么 L1/L4 在 L2/L3 之前

| 级别 | 典型耗时 |
|---|---|
| L1 静态 | ~0.1ms |
| L4 预算 | ~0.1ms |
| L2 冒烟 | ~100ms（2 个子进程） |
| L3 回归 | ~150ms（4 个子进程） |

**差三个数量级。** 一个明显超预算的重写，根本不该启动任何子进程。这个顺序是压测后确认的。

---

## 四、代际存储的数据模型

```
<store>/
├── generations/
│   ├── g0001/
│   │   ├── manifest.json     {id, parent, content_hash, kind, created_at, note}
│   │   ├── tree/             c1..c8 完整树（写入后只读）
│   │   │   ├── systemprompt.md
│   │   │   ├── guardrails.md
│   │   │   ├── LongTermMEMORY.md
│   │   │   ├── tool_descriptions/tool_guidance.md
│   │   │   └── scripts/*.py
│   │   └── evidence/
│   │       └── gate.json     采纳时门禁的完整结论
│   └── g0002/
│       └── ...（parent: g0001）
└── refs/
    └── stable.json           {generation: "g0002", updated_at, by, reason}
```

### 两条不变式

1. **代际不可变。** 写入后只读；任何修改都产生新代际，其 `parent` 指向旧代际。
2. **线上版本是指针，不是副本。** 切版本 = 一次 `os.replace` 写一个小 JSON。

所以：**回滚不重建、不复制、不重启。** 实测一次切换 14ms。

### content_hash 必须与上游一致

```python
# 我们的实现
for p in sorted(Path(normalize_rel(rel)) for rel in tree):
    h.update(p.as_posix().encode()); h.update(b"\0")
    h.update(tree[p.as_posix()].encode()); h.update(b"\0")
```

两个细节是踩坑换来的：

- **排序的是 `Path` 对象，不是字符串。** `LongTermMEMORY.md`（大写 L）按路径排序在
  `guardrails.md` 之后，按字符串排序在之前。用错了就和上游对不上。
- **写盘必须显式 `newline="\n"`。** Windows 上 `write_text` 会把 LF 转 CRLF，
  而 `runmark.fingerprint` 哈希的是原始字节。

对得上的意义：代际的指纹可以直接和它产出的 rollout 记录的 harness 指纹比对。

---

## 五、服务层

### 两把锁

```
_write_lock   串行化采纳（两个门禁不能看到同一个 live 基线）
_swap_lock    只在「读指针+取缓存」或「写指针+清缓存」两步持有
```

**门禁不持有任何锁。** 第一版用一把锁，压测立刻暴露：采纳在门禁里要 150–240ms，
所有读者都堵着。

### 缓存

`LiveHarness` 缓存「当前代际的树」。ref 只通过本对象改变，两条修改路径都清缓存，
所以**缓存非空即为答案**，热路径不碰磁盘。

第一版是「先 `store.current()` 看 id 变没变」——但那次读盘要 267μs，缓存等于没生效。

### 端点

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/` | 服务信息 |
| GET | `/current` | 代际 id + hash + 文件名（热路径） |
| GET | `/current/tree` | 当前 harness 全文 |
| GET | `/generations` | 全部代际 + refs |
| GET | `/generations/{id}` | 单代际 + lineage |
| GET | `/events?since=N` | SSE 事件流，可从 seq 重放 |
| GET | `/verify` | 完整性校验 |
| GET | `/settings/providers` | 供应商列表（不含凭据），契约见 [RSI-PROVIDERS-API.md](RSI-PROVIDERS-API.md) |
| PATCH | `/settings/providers/{id}` | 改一个供应商的 base_url / wire_api / 凭据 |
| POST | `/adopt` | 门禁 → 通过才提交 |
| POST | `/rollback` | 移动指针 |

**为什么用标准库而不是 FastAPI**：本机没有该依赖；上游本身就是 `dependencies = []`；
一个"必须先装点什么才能启动"的服务，作为第一步不如朴素但立刻能跑的。

---

## 六、模块职责速查

| 文件 | 行数 | 一句话 |
|---|---|---|
| `rsi/store.py` | 507 | 不可变代际、谱系、原子指针、swap、完整性校验 |
| `rsi/gate.py` | 318 | 四级门禁，便宜的先跑，第一级失败即停 |
| `rsi/golden.py` | 176 | 两个可判定的 golden task + 跨平台进程组 kill |
| `rsi/server.py` | 415 | HTTP + SSE，两把锁，缓存 |
| `rsi/stress.py` | 328 | 两种并发场景 + 一致性断言 |
| `rsi/agent.py` | 436 | 真 Agent 循环：读 harness 树，调工具，写工作区 |
| `rsi/sessions.py` | 370 | 会话与运行归档。声明 `Runner`/`RunResult` 协议，执行器由外部注入；运行态（token、停止原因）进索引 |
| `rsi/client.py` | 585 | Tkinter 桌面客户端。不是网页，不是 Electron |
| `rsi/taskset.py` | 549 | 40 个可判定任务，8 个领域；`BenchmarkAdapter` 实现 + 确定性判分 |
| `rsi/improve.py` | 311 | 自我改进闭环：提案 → 门禁 → train/held-out 双测 → 接受或拒绝 |
| `rsi/cli.py` | 439 | 子命令，ui 打开桌面客户端，runset 跑任务集 |
| `rsi/__init__.py` | 21 | 公开 API |

### CLI

```
rsi init      创建 store 与首个代际
rsi list      显示谱系与 refs
rsi show      查看某个 ref 指向的代际详情
rsi promote   把一个 harness 目录提交为新代际
rsi gate      跑门禁，不写入（dry run）
rsi adopt     门禁通过才提交
rsi serve     启动 HTTP 服务（给门禁和热切换用，不是界面）
rsi ui        打开 Tkinter 桌面客户端
rsi tasks     列出任务集（--domain 过滤）
rsi runset    用某个 harness 跑任务集，可导出 JSON
rsi compare   对比两份 runset 汇总，看净增/净减
rsi stress    跑并发压测
rsi rollback  移动指针
rsi verify    校验完整性
rsi unlock    解除只读（为了能删除）
```

---

## 七、测试结构

```
116 个测试（43s）
├── test_store.py    25 个   不可变、指纹、谱系、指针、swap、校验、跨进程写入
├── test_gate.py     26 个   L1–L4 各自拒绝、执行顺序、零写入
├── test_server.py   23 个   路由、事件、并发快照一致性
├── test_sessions.py 12 个   存储与执行分离、运行归档、路径围栏、运行态索引
├── test_taskset.py  25 个   确定性、答案由代码算出、判分严格性、adapter 符合协议
├── test_improve.py  13 个   不泄漏答案与任务 id、划分不重叠且稳定、提案解析
└── test_workflow.py  5 个   上游原有，未改
```

### 三条被测试守住的不变式

| 不变式 | 由谁守 |
|---|---|
| `rsi gate` 一个字节都不写 | `test_gate_and_promote_writes_nothing_on_rejection` |
| 快照的 id 与 tree 必须匹配 | `test_concurrent_resolve_never_sees_a_torn_harness` |
| 采纳期间读者不被饿死 | `test_adoption_does_not_block_readers` |

---

## 八、与上游的边界

```
rsi/ 不 import          harness2.core.recursion
                        harness2.core.selection
                        harness2.core.prompts
                        harness2.core.library
```

这是刻意的。搜索算法是上游的核心资产，我们只在**它产出的树**之上加身份与生命周期。

### 我们对上游的改动（全部 5 处，均为可移植性）

| 文件 | 改动 | 原因 |
|---|---|---|
| `core/lock.py` | **新增** | POSIX 用 `fcntl`，Windows 用 `msvcrt` |
| `core/schedule.py` | 改用上述锁 | 原来函数体内 `import fcntl` |
| `core/tree.py` | `.as_posix()` ×2 | 反斜杠导致桩文件误判 |
| `core/runmark.py` | `.as_posix()` | 跨平台指纹不一致 |
| `core/proposer.py` | `.as_posix()` | 同上 |

**没有改任何算法逻辑。** 合并上游更新时冲突面很小。

---

## 九、当前状态（诚实版）

### 已完成

| 能力 | 状态 | 证据 |
|---|---|---|
| 代际存储与回滚 | ✅ | 21 测试；实测切换改变输出 105.25→85.15 |
| 四级采纳门禁 | ✅ | 26 测试；四种坏候选各自被对应级别拦下 |
| HTTP 服务 + 热切换 | ✅ | 23 测试；压测 3,244 rps、零不一致读 |
| Windows 原生运行 | ✅ | demo 2/2、测试 77/77 |
| 跨平台进程组 kill | ✅ | `golden.kill_group` |
| 桌面客户端 | ✅ | Tkinter，三栏：会话 / 对话 / 工作区。已在本机窗口跑通一次真实任务 |

### 未完成

| 缺口 | 影响 |
|---|---|
| **进化对比界面** | 会话客户端有了，但还不能并排看新旧 harness、点采纳或回滚 |
| **运行态只进索引，未进树** | token 用量已入 `RunRecord`，但仍是「树外的事实」；将来若让成本参与采纳决策，需要显式的证据通道 |
| **任务集未接入门禁** | `taskset` 有 40 个任务但门禁仍只用 2 个 golden task；接进去会让 L2/L3 变慢且更不确定，属于待定的设计取舍 |
| **真实任务集** | golden task 只有 2 个，不足以支撑实验 |
| **实验与论文数据** | 无对照组、无统计 |
| **鉴权/限流/TLS** | 只能绑 loopback |
| **多进程部署** | 每个进程各一份缓存 |
| **L3 应对照固定基准** | 当前对照 live，live 本身坏了会退化 |

### 性能（实测，不是估计）

Windows 11、Python 3.12、本机 SSD。`p50`，单位微秒。

| 操作 | 31 代时 | 说明 |
|---|---|---|
| `current('stable')` | 251µs | 读指针 + 读 manifest |
| `get_ref()` | 120µs | 一次小文件读 |
| `content_hash(tree)` | 26µs | 纯哈希，无 IO |
| `tree_of()` | 1,216µs | 读回整棵树，随文件数线性 |
| `generations()` | 38,512µs | **全量列举，随代际数线性** |
| `verify()` | 314,396µs | 每代重算哈希，故意的 |

**提交一次代际（`commit`）的变化：**

| 代际数 | 改动前 p50 | 改动后 p50 |
|---|---|---|
| 2 | 16.7ms | 4.5ms |
| 73 | 41.2ms | 4.5ms |
| 155 | 66.7ms | 4.5ms |

原来 `_write` 一次提交要全量列举两遍（`_by_hash` 查重 + `_next_id` 取号），
每次列举都重读所有 manifest，于是提交成本随代际数线性增长。现在每进程只列举
一次，之后靠两个只增不减的索引（最大 id、content_hash → id）。

代价与边界：索引假设**代际目录不可变、id 单调递增**——这两条本来就是存储层的
不变量，`test_a_second_store_does_not_reuse_an_id` 与
`test_a_second_store_does_not_rewrite_existing_content` 把跨进程的情况钉住了。

**没动的地方**：`generations()` 仍是全量列举，`verify()` 仍是每代重算。前者是
`rsi list` 的语义（要显示全部谱系），后者是完整性校验的意义所在（不能信缓存）。
热路径 `current()` 251µs 里没有这两者。

### 运行态：`Tree` 之外的那一半

`Tree = dict[str, str]` 能表达 harness 的内容，表达不了**一次运行**发生过什么：
token 用量、停止原因、工具调用序列。这是一条已知的抽象边界，不是疏忽。

处理方式是把它放进**索引**而不是树：`RunRecord` 增加 `prompt_tokens`、
`completion_tokens`、`stop_reason`，随 `session.json` 一起保存。

改动前后，「这个会话花了多少 token」的代价：

| 读法 | 耗时 | 随运行数增长 |
|---|---|---|
| 逐个打开 `runs/*/meta.json` | 0.487ms | 是 |
| 读 `session.json` 索引 | 0.001ms | 否（一次 JSON 解析） |

两者对同一份真实数据算出同一个数（25,807 tokens），差别只在代价。

**为什么不放进树**：树是 harness 的内容，会参与哈希、代际比较和门禁；运行态是
一次执行的观察值，属于会话而不属于 harness。混进去会让「同一个 harness 因为跑了
不同任务而有不同哈希」。

**遗留缺口**：运行态目前只用于展示与统计，还没进入采纳决策。若将来要让「成本」
参与判断某个 harness 改得好不好，需要一条显式的证据通道（例如写进 `evidence/`），
而不是让门禁去读会话目录。

### 一句话

> **核心机制已闭环并可验证，缺的是「给人看」和「给论文用」这两层。**

---

## 十、下一步该做什么

按依赖顺序：

1. **真实任务集**（1–2 周）—— 这是论文的地基。20–40 个同领域任务，
   分 2–3 个 domain。没有它，实验无从谈起。
2. **实验矩阵**（2 周）—— base / 人工改写 / k=1 / k=3 四组对照，成本归一。
3. **进化对比栏** —— 会话客户端已经是 Tkinter 桌面窗口，不再做网页。
   缺的是同一任务下 old vs new 的并排结果，以及采纳 / 回滚按钮。

会话窗口已经能发任务、看工作区。
## 十一、任务集（论文的地基）

### 为什么需要它

门禁只有 2 个 golden task。它足够回答「这个候选还能不能跑」，
远不够回答「这个候选是不是更好」。没有任务集，
「改了 harness 之后效果如何」这个问题无法被证伪。

### 形态

8 个领域 × 5 个任务 = **40 个任务**，全部可确定性判分：

| 领域 | 考什么 | 例子 |
|---|---|---|
| arithmetic | 带符号金额求和、两位小数 | `csv-sum-0` |
| parsing | 嵌套 JSON 按路径取值 | `json-extract-100` |
| text | 词频统计、大小写与标点归一 | `text-count-200` |
| structure | 按表头定位列求最大 | `table-max-300` |
| dates | 跨月跨年的日期间隔 | `date-gap-400` |
| sets | 去重计数 | `dedupe-500` |
| statistics | 偶数长度中位数 | `median-600` |
| logic | 运算优先级 | `precedence-700` |

**答案不写死。** 每个任务的期望值由该任务输入经代码算出，
所以任务与答案不可能漂移。`test_taskset.py` 逐个重算验证这一点。

### 判分契约

一行：`ANSWER: <value>`。判分逐字符比对，不用模型评审。

这么严是刻意的：**格式漂移和数值错误都是失败，但它们是不同的失败**。
`grade()` 因此返回三个状态：`ok` / `value_only` / `wrong`。
把「算对了但格式错」和「算错了」混成一个布尔值，
就分不清一次 harness 改动到底修好了哪个。

### 第一份实验证据

同一批任务、同一模型、温度 0，只换 harness 的 systemprompt 措辞：

| 集合 | base | improved | 净变化 | 耗时 | token |
|---|---|---|---|---|---|
| 40 个全量 | 28/40 | **40/40** | **+12** | 298s / 288s | 289,756 / 286,948 |
| 12 个前缀子集 | 8/12 | 12/12 | +4 | — | — |

分领域看，提升不是均匀的：

| 领域 | base | improved |
|---|---|---|
| structure | 0/5 | 5/5 |
| text | 1/5 | 5/5 |
| dates / logic / statistics | 4/5 | 5/5 |
| arithmetic / parsing / sets | 5/5 | 5/5 |

**关键观察：base 的 value_ok 是 40/40。** 也就是说模型把每一道题都算对了，
28 个失败**全部**是 `value_only`——数对了，但只回裸值、不带 `ANSWER:` 前缀。

两点结论：

1. **差别完全来自 harness 的措辞，而不是模型能力。**
   这正是自我改进系统最需要能观测到的差异：同一模型、同样的题、
   只改 harness 就改变结果。
2. **提升高度集中在「短答案」领域。** structure 和 text 的答案是一个词，
   模型最容易只吐那个词；arithmetic 的数字本来就带小数点，反而稳定符合格式。
   如果把结果说成「harness 改进让效果提升 43%」，那是把格式遵从度包装成了能力。

**代价几乎为零**：改进版 token 少 2,808、耗时少 10s。
这排除了「靠啰嗦换正确率」这个解释。

### 设计上避开的三个坑

1. **不设稻草人 baseline。** 最初版本的 base 提示词太弱（0/6），
   那样任何候选都像改进。已改成「一个有能力的工程师第一次就会写的样子」：
   它仍然可被超越，但不是靠耍赖。
2. **不让答案可猜。** `date-gap` 最初是固定 +17 天偏移，
   答案呈 417、418、419 递增，模型可能顺着规律猜。已改成随机区间。
3. **不用模型当裁判。** 判分只比对字符串。
   一个会漂移的裁判会让下游所有数字都不可证伪。


## 十二、自我改进闭环（主命题）

`rsi/improve.py`：Agent 观察自己的失败 → 自己改 harness → 门禁裁决。

### 一轮的流程

```
live harness (g0001)
   │
   ├─ 1. 在 train 的 30 个任务上跑，得到失败清单
   ├─ 2. 把「失败长什么样 + 当前 harness」交给 Agent，要求一处最小改动
   │     └─ 期望答案不给、任务 id 不给
   ├─ 3. 读回工作区 → 候选树；改动为空则直接拒绝（不花测试的钱）
   ├─ 4. 门禁 L1 静态 + L4 预算（免费，先跑）
   ├─ 5. 候选在 train 上跑；净增 ≤ 0 则拒绝
   ├─ 6. 候选在 held-out 10 个上跑；净减则拒绝（过拟合）
   └─ 7. 接受 → 提交为新代际，stable 指针移动
```

### 实测结果（2026-10-21）

| 项 | 值 |
|---|---|
| 轮次 | 1 |
| Agent 的提案 | 「要求最后一行必须以 `ANSWER: ` 开头，裸值不接受」 |
| 改动 | 1 个文件（`systemprompt.md`），+117 字符 |
| train | 26/30 → 30/30（+4） |
| held-out | 0/10 → 10/10（+10） |
| 丢失 | 0 |
| 门禁 | L1/L4 通过，接受为 **g0002** |
| 耗时 | 580s（约 9.7 分钟） |

**独立复核**（全新目录、复现同一划分、重跑 held-out）：
g0001 **1/10** → g0002 **10/10**，净 +9，零丢失。
与原始结果一致（1/10 与 0/10 的差别是单任务波动）。

### 为什么这次结果站得住

1. **train 与 held-out 的增益任务不重叠。** train 涨的是 `csv-sum-3`、
   `date-gap-401/403`、`dedupe-500`；held-out 涨的是 `table-max-*` 和
   `text-count-*`。**没有见过**的任务也涨了，这才是泛化，而不是背答案。
2. **零丢失。** 没有任何任务从通过变成不通过。
3. **两轮独立运行同向。** 原始运行与复核运行结论一致。
4. **改动很小。** 没有重写提示词，只加了两句话。

### 过程中的两次真实失败

**第一次：Agent 拒绝改动。**
它说「六个失败是形状混杂的裸数字，没有共同点」。
这是**我的设计缺陷**：我只给它「产出了什么」，没给「错在哪一类」。
加上失败形态提示后，它立刻定位到共同原因。
这个失败值得写进论文：**给 Agent 的诊断信息不足时，它会做出正确的拒绝**，
而拒绝不该被误读为「Agent 无能」。

**第二次：我自己的复核脚本错了。**
第一版复核手写了 train 集，得到 31/9 的划分，与程序的 30/10 不符，
跑出来的不是同一次对照。已改为调用同一个划分函数。

### 边界（必须说清楚）

- **只有一轮，只有一次接受。** 这证明「机制能承载一次从观察→改动→裁决的完整闭环」，
  不证明「自我改进稳定有效」。要后者需要多轮、多次、多模型。
- **进步的是格式遵从度，不是解题能力。** g0001 的 value_ok 本来就是 30/30，
  Agent 修的是「怎么说」而不是「算什么」。
- **held-out 只有 10 个任务**，且集中在两个领域（text、structure），
  统计功效很弱。
- **没有成本归一。** g0002 在 held-out 上 token 略多（73,642 vs 72,603），
  这里只是记录，未进入裁决。
- **一轮 580 秒**，其中大部分是跑 80 次真实模型调用；轮数一多成本非线性上升。

### 任务集的边界（诚实版）

- 任务都是**单步数据处理**，不测长程规划、多轮协作、工具编排。
- 只有 8 个领域，且都偏「有唯一答案」的类型，
  不覆盖开放写作、设计、调试这类无标准解的工作。
- 判分只看最终答案，不看过程质量。
- token 与耗时会被记录，但**还没有成本归一化**：
  一个靠啰嗦换正确率的改动，在这里看起来是纯收益。
