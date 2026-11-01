# RSI Harness 设计说明

> **RSI** = *Recursive Self-Improvement*。本文描述 RSIHarness 在
> [Harness²](https://github.com/google-research/harness2) 之上**加什么、为什么加、怎么加**，
> 以及**明确不做什么**。
>
> 上游剖析见 [ARCHITECTURE.md](ARCHITECTURE.md)；实施顺序见 [RSI-ROADMAP.md](RSI-ROADMAP.md)。

---

## 1. 起点：把三个需求翻译成工程问题

原始构想（见仓库议题）提出三个需求。第一步是把它们从「话术」翻译成**可验收的工程问题**。

| 原始需求 | 工程化表述 | 验收句 |
|---|---|---|
| 实验区跑崩不影响现在的 | 让**所有**由 agent 产生的改动都在一个**可丢弃、可超时、可杀死**的沙箱里执行；稳定区进程零暴露 | 实验区任意崩溃/死循环/写坏文件，稳定区仍能正常服务下一个请求 |
| 修改配置 / Skill 直接改 | 让 c1..c8 的每次修改都经过**校验 + 冒烟执行**，通过才允许采纳 | 采纳门禁能拦住语法错误、越权路径、超预算改动 |
| 热更新，用户无感 | 采纳后**不重启进程**即可切换到新代际；失败可**一键回滚** | 采纳前后 WebSocket 连接不断，p95 卡顿 < 500ms |

这三条**都建立在同一个地基上**：harness 必须是**有身份的、可寻址的、可回滚的对象**。

---

## 2. 最重要的一个结论：不要重复造影子工作区

原始构想里「影子工作区（Shadow Workspace）」被列为亮点 1。需要指出：

> **Harness² 已经实现了它，而且实现得比构想更严谨。**

`harness2/core/recursion.py` 的 `_roll()` 每个候选写入独立目录：

```python
hdir = harness_tree.write_tree(surface, tree, work_dir / "harnesses" / label)
rd = adapter.execute(task_id, hdir, run_id)
```

`harness2/core/context.py` 里 `assert_no_leak_paths()` 与
`assert_no_grader_verdicts()` 已经在证据进入模型上下文之前拦截答案泄漏。

`harness2/core/runmark.py` 用 `.adapt_complete` 标记 + harness 指纹保证幂等续跑。

因此本项目的**核心声明必须改写**。如果把「影子工作区」当创新点，评审只要打开上游仓库
三分钟就能证伪。这是我们最该避免的错误。

### 正确的定位

> **Harness² 优化的是 harness 的「内容」，RSI Harness 补齐的是它的「生命周期」。**

H² 回答「改成什么样」，把改好的树写进 `runs/` 目录就结束了。
它不回答：

- 这棵树是**第几代**？从哪一代来的？
- 线上正在跑的是哪一代？怎么**原子切换**过去？
- 采纳之后发现变差了，怎么**一键回滚**？
- 这次改动**为什么**被采纳？证据链在哪？

这四个问题，就是 RSI Harness 的全部工作范围。

---

## 3. 五项真正的增量

下面每一项都对应上游的一个**具体空白**，都可以被独立验收。

### 增量 A：Harness 代际（generation）与谱系

**现状**：H² 的产物是 `runs/<bench>-<substrate>-<mode><k>/<task>/harnesses/<label>/`，
靠目录名区分。没有代际概念，没有父子关系，没有「当前指向哪一代」。

**设计**：引入不可变的 **Generation 对象** + 一个可变的 **指针**。

```
store/
  generations/
    g0001-base/
      manifest.json          # id, parent, created_at, content_hash, kind
      tree/                  # c1..c8 完整树（不可变）
      evidence/              # 采纳依据：selection.json、任务、对比记录
      metrics/               # 冒烟测试结果、耗时、成本
    g0002-<parent=g0001>/
    ...
  refs/
    stable.json              # {"generation": "g0007", "updated_at": ..., "by": ...}
```

规则：

- **generation 目录一经写入即只读**。任何修改都产生新代际。
- `content_hash` = 对 tree 做稳定摘要（复用 `runmark.fingerprint()` 的算法即可）。
- `parent` 构成一棵**谱系树**，天然支持「回滚到任意祖先」。
- 切换线上版本 = **改一个指针文件**（原子 `os.replace`），不是复制目录。

**为什么这是真增量**：上游的 `write_tree()` 会就地删除并重写目录，
不存在任何「旧版本还在」的可能。代际化把 H² 的单次实验升级成了可持续演进的资产。

---

### 增量 B：双通道采纳（自动 + 人工）

**现状**：H² 里「采纳」= 被 selector 选中，然后写入领域经验库。
没有人工介入点，也没有「暂存待审」状态。

**设计**：采纳拆成两条通道，共用同一套校验。

```
候选 harness
   │
   ├─ 通道 1（自动）：证据充分 → 自动晋升 stable
   │      条件：冒烟测试全绿 ∧ 相对基线无回归 ∧ 改动量在阈值内
   │
   └─ 通道 2（人工）：证据不足或改动过大 → 进入 review 队列
          人在 GUI 里看新旧对比，点「采纳」或「放弃」
```

**关键**：两条通道走**完全相同的门禁**（见增量 C）。人工通道不是「绕过校验」，
而是「在通过校验的候选里做价值判断」。

**为什么这是真增量**：这对应构想里的「一键采纳 / 放弃」按钮，但把它的语义做成了
一个**状态机**，而不是两个 UI 事件。评审问「人和 Agent 谁说了算」时有明确答案。

---

### 增量 C：采纳门禁（Adoption Gate）

这是整个系统**安全性的落点**，也是构想里「语法预检」的正确定位——
语法预检只是门禁的**第一级**，不是全部。

四级门禁，**由便宜到贵**逐级执行，任一级失败即终止：

| 级别 | 检查 | 实现 | 成本 |
|---|---|---|---|
| L1 静态 | 复用 `tree.validate()`：路径合法性、always-on 上限、skill 命名、脚本引用完整性、`py_compile` | 直接调用上游 | 毫秒 |
| L2 冒烟 | 用**真实**执行器跑一个最小任务（golden task），验证 harness 能跑完且产出非空 | 复用 `adapter.execute()` | 分钟 |
| L3 回归 | 对 L2 的产出与当前 stable 代际的产出做对比，检测**倒退** | 需要 `BenchSpec` 级别的基准 | 分钟级 |
| L4 预算 | 改动行数、always-on 字符增量、新增组件数是否超阈值 | 复用 `tree.diff_summary()` | 毫秒 |

```python
# 门禁的伪代码：注意它返回的是「可读的拒绝理由」，不是布尔值
def gate(candidate: Tree, stable: Tree, surface, adapter) -> GateResult:
    errs = tree.validate(surface, candidate)       # L1：上游直接给
    if errs: return Reject("L1", errs)
    smoke = adapter.execute(golden_task, candidate)  # L2：真跑
    if not smoke.ok: return Reject("L2", smoke.error)
    delta = tree.diff_summary(surface, stable, candidate)
    if exceeds_budget(delta): return Reject("L4", delta)
    return Accept(delta)
```

**为什么这是真增量**：构想里只提到 `py_compile`。但语法正确 ≠ 能跑通 ≠ 不比现在差。
三级递进才是工程上站得住的「安全阀」。

---

### 增量 D：热切换（Hot Swap）——在正确的层做对的事

**现状**：H² 每次运行都启动新的子进程，不存在「在线切换」的需求。

**对构想里技术方案的修正**：

> 构想建议用 `importlib.reload()` 重载模块，或让 FastAPI 平滑重启。
> **这两条都不该用于 harness 切换。**

理由：harness 的 c1..c8 **不是 Python 模块**，而是提示词、JSON、Markdown、TypeScript 插件、
Python 脚本。`importlib.reload()` 对它完全无效。而重启整个服务进程，会让正在进行的
rollout 全部丢失。

**正确做法：在「harness 装填」这一层做原子切换。**

```
请求到来
   → 读取 refs/stable.json（一次原子读）
   → 若 generation 变化，materialise 新代际到临时目录
   → 原子替换 workspace 中的 harness 目录（exchange 或 rename）
   → 后续请求直接使用新代际
```

关键性质：

- **进程不重启**——FastAPI/WebSocket 连接不受影响
- **在途请求不受影响**——它们持有旧代际的路径句柄
- **切换是原子的**——不会出现「半个新 harness + 半个旧 harness」
- **可回滚**——把指针改回去即可，无需重新构建

**为什么这是真增量**：它把「热更新」从一句口号变成了一个**有明确语义边界的操作**，
并且诚实地说明了它不解决什么（比如：已发出的模型请求无法撤回）。

---

### 增量 E：在线闭环服务化

**现状**：H² 的形态是 `sweep → judge → report` 批处理，不是常驻服务。
唯一的自包含 demo 用的是**脚本化的假 proposer**（`DemoProposer` 直接写死要改哪一行）。

**设计**：一个 HTTP + WebSocket 服务，把进化流程暴露成可交互的状态机。

```
POST /runs              提交一次进化实验（任务、k、mode）
GET  /runs/{id}         查询状态与进度（SSE/WebSocket 推送）
GET  /generations       列出所有代际及其谱系
POST /generate/{id}/promote   采纳并晋升 stable
POST /generate/{id}/reject    放弃
POST /rollback          回滚到指定代际
WS   /events            实时事件流（proposal / probe / gate / adoption）
```

**实现约束（重要）**：

- **不修改 `harness2/core/`**。服务层作为独立的 `rsi/` 包，通过调用 core 的公开函数集成。
  这样上游更新可以无冲突合并。
- 长任务放**独立进程**（`subprocess` + 超时 + 进程组），不用线程池。这对应构想里
  「subprocess 隔离 + 30 秒超时 + kill」的正确部分。
- 事件流用**单调递增的 seq**，支持断线重放。

---

## 4. 明确不做什么（同样重要）

论文的可信度有一半来自**诚实地划边界**。

| 不做 | 理由 |
|---|---|
| **容器级隔离** | 构想里说「坚决不搞容器隔离」，这个判断是对的。H² 的 rollout 本身就在子进程里跑，加容器会让调试成本剧增。但要在文档里说清楚：**我们提供的是进程级 + 目录级隔离，不是安全沙箱**，对抗不可信代码不成立 |
| **运行时自适应当前任务** | 会让「同一任务内 harness 变化」成为混淆变量，直接污染实验对比。H² 不做是有道理的 |
| **模型权重更新** | RSI 的 "self-improvement" 指 harness 层，不是权重层。必须在 README 第一屏说明 |
| **重新实现 Propose–Probe–Compose** | 上游实现质量很高，重写只会引入 bug |
| **自建 benchmark** | 第一版复用 H² 的 demo adapter + 一个自建 golden task，不承诺大规模评测 |

---

## 5. 与上游的兼容策略

这是工程上最实际的问题：**怎么在跟进上游的同时加东西？**

```
方式：只增不改（additive-only）
```

| 我们改动的 | 上游改动的 | 冲突概率 |
|---|---|---|
| 新增 `rsi/` 包 | `harness2/core/*` | **零**（目录不相交） |
| 新增 `docs/RSI-*.md` | `docs/*.md` | 零 |
| 改写 `README.md` | `README.md` | **高**（必然冲突） |
| 新增 `.gitignore` / `NOTICE` | — | 零 |
| 可能微调 `pyproject.toml` | `pyproject.toml` | 中 |

结论：

- **`README.md` 接受冲突**——它是我们的门面，必须写自己的故事。合并上游时手动处理。
- **其余一律新增文件**。绝不为了「看起来融合」而去改 core。
- 需要改 core 的地方，先问「能否用包装/子类/适配器解决」。

上游追踪：

```bash
git remote add upstream https://github.com/google-research/harness2.git
git fetch upstream
git log --oneline upstream/main ^main    # 看上游有什么新东西
```

---

## 6. 数据模型速查

```python
# rsi/store.py 的核心类型（示意）

@dataclass(frozen=True)
class Generation:
    id: str              # "g0007"
    parent: str | None   # "g0006"
    content_hash: str    # 16 hex，复用 runmark.fingerprint 算法
    kind: str            # "base" | "auto" | "manual"
    tree_dir: Path       # 不可变
    evidence_dir: Path
    created_at: float

@dataclass
class Ref:
    generation: str      # 当前指向
    updated_at: float
    by: str              # "auto-gate" | "human:<name>"
    reason: str

@dataclass(frozen=True)
class GateResult:
    ok: bool
    level: str           # "L1" | "L2" | "L3" | "L4"
    reason: str          # 人类可读，直接进日志
    delta: dict          # 来自 tree.diff_summary
```

---

## 7. 可验收的标准

设计好不好，看它能不能被证伪。每项增量给一条**可执行的验收**：

| 增量 | 验收方式 |
|---|---|
| A 代际 | 连做 3 次采纳，`GET /generations` 能画出 4 节点的谱系树，每代 `content_hash` 互不相同 |
| B 双通道 | 构造一个「通过门禁但 evidence 不足」的候选，断言它进 review 队列而不自动晋升 |
| C 门禁 | 构造 `syntax_error` / `跑不通` / `改动超预算` 三种坏候选，断言分别在 L1/L2/L4 被拒 |
| D 热切换 | 采纳期间持续发请求，断言零连接中断、零 5xx；`stable.json` 前后内容不同 |
| E 服务化 | 一次完整流程（提交→进化→门禁→采纳→回滚）全程可通过 HTTP 完成，无 CLI 介入 |

这五条就是论文里「工程贡献」那一节该写的东西——**每条都是可复现的实验，不是形容词**。

---

## 8. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 上游 core 变更导致集成破裂 | 中 | 高 | additive-only；集成点集中在 `rsi/adapter.py` |
| 无 benchmark 时无法验证门禁 L2/L3 | **高** | 高 | 先做一个 20 行代码的 golden task adapter，不等真实 benchmark |
| 「能跑」与「真好用」的落差 | 中 | 中 | 先做端到端最薄链路，再加功能 |
| 论文写作时过度承诺 | 中 | **高** | 本文档第 4 节就是为对抗这个风险而写 |
| Windows 开发 / Linux 运行不一致 | 中 | 中 | 见 ROADMAP 第 0 周的环境决策 |

---

## 9. 与原始构想的逐条对照

| 原始构想 | 判断 | 处理 |
|---|---|---|
| 100% Python + FastAPI + Gradio | 采纳（框架选择留待第 0 周定） | 见 ROADMAP |
| 直接 clone Harness² 源码并复用 PPC 逻辑 | **采纳，且是核心** | 见 ARCHITECTURE |
| 两个文件夹 `stable/` `experiment/` | 采纳但升级为**代际 store** | 增量 A |
| subprocess + 超时 + kill | 采纳，但只用于**执行隔离**，不宣称是安全边界 | 增量 C / 第 4 节 |
| `py_compile` 语法预检 | 采纳为**门禁 L1**，但明确它只是一级 | 增量 C |
| WebSocket 保活 + 后台平滑重启 | **修正**：不重启进程，改为原子指针切换 | 增量 D |
| `importlib.reload()` 热加载 | **否决**：harness 不是 Python 模块 | 增量 D |
| 三栏 GUI（对话 / 监控 / 对比） | 采纳，但列为**最后**做 | ROADMAP 阶段 4 |
| 亮点 1「影子工作区」 | **否决**：上游已实现 | 第 2 节 |
| 亮点 2「文件级隔离 + 热加载」 | **保留但重新表述**为代际 + 门禁 | 增量 A/C/D |
| 亮点 3「无标准答案场景下的优越性」 | **需重写**：这是实验设计问题，见 ROADMAP 阶段 5 | — |
