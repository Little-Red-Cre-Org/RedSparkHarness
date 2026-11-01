# RSI Harness 实施路线

> 面向的是**毕业设计**的时间预算，不是产品排期。
> 原则：**每一步都产出可演示、可写进论文的东西；宁可少做，不可做假。**

原构想给的是 9–12 周。本文按**依赖关系**重排，而不是按周数硬切。
每阶段末尾有 `✅ 完成判据`，达不到就不进下一阶段。

---

## 阶段 0：地基与决策（约 3–5 天）

这一步不写功能代码，只解决三个会**决定后续一切**的问题。

### 0.1 环境决策（必须先定，否则后面全白干）

上游要求 **Linux + Python 3.12**。而 `harness2/core/` 本身是纯 Python，
真正 POSIX-only 的地方集中在三个 benchmark 适配器：
`benchmarks/lab.py`、`benchmarks/jobbench.py`、`benchmarks/workbuddy.py`
（`os.killpg` + `start_new_session=True`）。

**二选一，现在就定：**

| 方案 | 优点 | 缺点 | 建议 |
|---|---|---|---|
| **A. WSL2 开发** | 与上游环境完全一致，benchmark 可用，少踩坑 | 文件系统跨层较慢，IDE 体验略降 | **推荐** |
| B. Windows 原生 | IDE 顺手，路径短 | benchmark 适配器要改，且**改了就偏离上游基线** | 仅当确定不用真实 benchmark |

> **推荐 A**。理由：我们的增量（代际/门禁/服务）不依赖平台，但**门禁 L2/L3 需要真跑
> 执行器**，而执行器的上游实现是 POSIX 的。为了省这点事去改 benchmark 适配器，
> 会导致「我们的结果和上游不可比」，得不偿失。

### 0.2 跑通上游 demo（验证继承来的东西真的能用）

```bash
uv venv --python 3.12 .venv && source .venv/bin/activate
uv pip install -e '.[render]'
harness2-demo --output runs/demo --k 2
python -m pytest tests -x -q
```

demo 不需要任何模型凭据（`DemoProposer` 是脚本化的），**必须跑出结果**。
如果 demo 跑不起来，说明环境有问题，**不要往下走**。

### 0.3 确认我们不重复造轮子

重读 [ARCHITECTURE.md](ARCHITECTURE.md) 第 2、4 节，确认理解：
影子工作区、证据树、泄漏防护、幂等续跑 **上游都已有**。

`✅ 完成判据`：`harness2-demo` 成功产出 `runs/demo/`，
`pytest tests` 全绿，环境方案 A/B 已书面确定。

---

## 阶段 1：代际存储（增量 A）—— 一切的底座（约 1 周）

> **状态：已完成。** `rsi/store.py` + `rsi/cli.py` + `tests/test_store.py`（21 个测试）。
> 实现细节与实测输出见文末「阶段 1 交付记录」。

**为什么先做这个**：没有代际，就没有回滚；没有回滚，热更新就是一锤子买卖。

### 交付物

```
rsi/
  __init__.py
  store.py        # Generation / Ref / 原子指针切换
  cli.py          # rsi-init / rsi-import / rsi-list / rsi-promote / rsi-rollback
tests/
  test_store.py
```

### 要做的事

1. **`Generation` 与 `Ref` 数据模型**（见 [RSI-DESIGN.md](RSI-DESIGN.md) 第 6 节）
2. **`import_from_harness2()`**：把上游 `runs/.../harnesses/<label>/` 的一个树
   导入成 g0001-base。复用 `harness2.core.tree.read_tree()`。
3. **`promote(parent, tree, kind)`**：写入新代际目录（只读），更新谱系。
4. **`set_ref("stable", gen_id)`**：原子写指针（`os.replace` 到临时文件再换名）。
5. **`rollback(target)`**：改指针，不复制目录。

### 关键实现约束

- `content_hash` 用 `hashlib.sha1` 对 `sorted(tree.items())` 摘要，
  **与上游 `runmark.fingerprint()` 保持同一算法**，两边指纹可互相比对。
- 代际目录写入后**立即只读化**，且写保护要能被验证。
- 指针切换必须**原子**：先写 `refs/stable.json.tmp`，再 `os.replace()`。

### `✅ 完成判据`

```bash
rsi-init
rsi-import runs/demo --as g0001-base
rsi-list                              # 1 个代际
rsi-promote g0001-base --tree .../c1  # 产生 g0002
rsi-list                              # 谱系 g0001 -> g0002
rsi-rollback g0001-base
rsi-list --ref stable                 # 指回 g0001
```

全部成功，且 `tests/test_store.py` 覆盖：指针原子性、回滚、hash 稳定性。

---

## 阶段 2：采纳门禁（增量 C）—— 系统的安全阀（约 1.5 周）

> **状态：已完成。** `rsi/gate.py` + `rsi/golden.py` + `tests/test_gate.py`（26 个测试）。
> 实现细节与实测输出见文末「阶段 2 交付记录」。

### 交付物

```
rsi/
  gate.py         # 四级门禁
  golden.py       # golden task 的最小 adapter
tests/test_gate.py
```

### 要做的事

1. **L1 静态**：直接调 `harness2.core.tree.validate()`。**不要重写**。
2. **L4 预算**：调 `tree.diff_summary()`，阈值可配置
   （建议：改动文件数 ≤ 6、always-on 字符增量 ≤ 4000、新增 skill ≤ 3）。
3. **L2 冒烟**：**这是最难也最值钱的一步**。需要一个小 adapter：
   - 复刻 `harness2/demo.py::DemoAdapter` 的结构（约 120 行，是最好的模板）
   - 换成我们自己的领域任务（建议：一个**真实但小**的文书/数据处理任务）
   - `execute()` 用 `subprocess` 跑，带超时与进程组 kill
4. **L3 回归**：对同一 golden task 分别用 candidate 和 stable 跑，对比产出。

### L2 的取舍（重要）

不要一开始就接真实 benchmark（LAB 有 1143 个任务、需要 Docker/Pandoc）。
**先用 20 行代码的 golden task 打通链路**，真实 benchmark 留到阶段 5。

### ⚠️ 一个必须写进论文的诚实声明

`subprocess` + 超时 + kill **不是安全沙箱**。它能防死循环、防意外崩溃，
但**不能防恶意代码**。如果 agent 写出了 `rm -rf ~`，子进程照样会执行。
真正的隔离需要容器。这条必须写在论文的 limitations 里，不能含糊。

### `✅ 完成判据`

- 语法错误候选 → L1 拒绝，错误信息可读
- 能编译但跑不通的候选 → L2 拒绝，附执行器 stderr
- 比 stable 更差的候选 → L3 拒绝，附对比
- 一次改了 30 个文件的候选 → L4 拒绝，附 diff 统计
- 好候选 → Accept，返回 delta

---

## 阶段 3：服务化 + 热切换（增量 D、E）（约 2 周）

> **状态：已完成（服务 + 热切换 + 压测）。** `rsi/server.py` + `rsi/stress.py` +
> `tests/test_server.py`（23 个测试）。实现与压测数据见文末「阶段 3 交付记录」。

### 3.1 服务骨架

**框架选型建议**：FastAPI（构想里已选，理由充分：WebSocket 原生、异步、生态好）。

```
rsi/
  server/
    app.py         # FastAPI 实例 + 路由
    events.py      # 事件流（seq 单调递增，支持重放）
    runner.py      # 长任务执行器（独立进程 + 超时 + kill）
    state.py       # 运行状态机
```

端点见 [RSI-DESIGN.md](RSI-DESIGN.md) 增量 E。

### 3.2 热切换（**这是最容易做错的地方**）

**不要**：

- ❌ `importlib.reload()` —— harness 不是 Python 模块，无效
- ❌ 重启 uvicorn worker —— 在途 rollout 全丢
- ❌ 复制文件覆盖 —— 会出现「半个新半个旧」的非原子状态

**要**：

```python
def swap_harness(store, workspace: Path) -> None:
    gen = store.current("stable")
    staging = workspace.parent / f".harness.staging-{gen.id}"
    materialise(gen, staging)             # 先在新目录建好
    target = workspace / "harness"
    old = staging.parent / ".harness.old"
    if target.exists():
        os.rename(target, old)            # 摘旧
    os.rename(staging, target)            # 挂新
    shutil.rmtree(old, ignore_errors=True)
```

在请求边界读取指针 + 缓存 generation 对象，让**在途请求持有旧句柄**不受影响。

### 3.3 进程隔离的执行器

```python
proc = subprocess.Popen(cmd, start_new_session=(os.name == "posix"))
try:
    proc.wait(timeout=T)
except subprocess.TimeoutExpired:
    kill_group(proc)   # POSIX: os.killpg；Windows: taskkill /T /F
```

注意要**跨平台分支** —— 这正是上游没解决、而我们必须解决的问题。

### `✅ 完成判据`

- 一次完整进化流程全程 HTTP 完成，无 CLI 介入
- 采纳期间持续压测，**零连接中断、零 5xx**
- 切换后新请求用新代际，在途请求用旧代际，二者不互相污染
- `POST /rollback` 后，下一次请求立即用回旧代际

---

## 阶段 4：GUI（约 1 周）—— 评委看这个，但要最后做

### 技术选型（已定）

桌面客户端用 Tkinter（Python 标准库），入口是 rsi/client.py，命令 rsi ui 打开它。
不做网页，也不用 Electron。会话 / 对话 / 工作区三栏已经能在本机窗口里跑真实任务。
下面说的新旧对比和采纳 / 回滚还没做，那是阶段 4 剩下的部分。

构想里的 Gradio，以及后来考虑过的单个 HTML 页面，都不再作为界面。
服务层的 HTTP 仍在，它给门禁和热切换用，不承担界面。

### 关于 Gradio / Streamlit 的判断（历史，已否决）

构想推荐 Gradio。当时的理由是：

- Gradio 的三栏布局要写大量 hack，其状态管理不适合长任务事件流
- 我们的核心展示物是「**新旧对比**」，本质是 diff 视图 + 事件时间线，不是表单
- 用 `FastAPI + 单个 HTML 页面`（或 HTMX）反而更快

但**如果团队前端能力弱、时间紧，Gradio 仍是合理选择** —— 30 行就能出个能看的东西。
这个取舍在阶段 3 结束时按实际情况定，不要提前锁死。

### 三栏的语义（比技术选型更重要）

| 栏 | 展示什么 | 数据来源 |
|---|---|---|
| 左 · 对话 | 和 agent 正常交互 | 独立于进化流程 |
| 中 · 实验区监控 | **实时**展示进化在干什么：当前阶段、候选、门禁结果 | `/events` WebSocket |
| 右 · 对比与决策 | 同一任务下 old vs new 的产出并排 + 采纳/放弃按钮 | 门禁 L3 的对比结果 |

**关键**：右栏的对比必须是**真实执行结果**，不能是静态 mock。
这是评委唯一会认真看的地方，也是最容易穿帮的地方。

### `✅ 完成判据`

现场演示：提交任务 → 中栏滚出实时事件 → 右栏出现新旧对比 → 点采纳 →
左栏立即用新 harness 回答 → 点回滚 → 立刻恢复。**全程不刷新页面、不重启进程。**

---

## 阶段 5：实验与论文（约 2–3 周）

### 5.1 实验设计（这是最容易做砸的部分）

原构想说「验证 Harness 级递归相比传统 Prompt 迭代的显著优势」。
按这个描述直接做实验会**做不出有效结论**，因为：

- 没有对照组定义（「传统 Prompt 迭代」具体指什么？）
- 没有可复现的任务集
- 没有成本归一的比较（k 越大越贵，收益要除以成本才有意义）

**可执行的最小实验设计**：

```
任务集：N（建议 20–40）个同领域任务，按 domain 分 2–3 组
基线 1：base harness（不进化）
基线 2：一次性人工改写（等价于「传统 prompt 迭代」）
实验：H2 递归 k=1
实验：H2 递归 k=3（parallel）
指标：任务成功率、成本（美元）、耗时、adopted harness 的跨任务迁移收益
```

关键指标：**迁移增益** —— 在 domain 内第 1 个任务学到的 INV 改动，
在第 2、3 个任务上是否还有效。这是 H2 相对 prompt 迭代最本质的优势所在。

### 5.2 论文亮点的重写（必须做）

原构想的三个亮点里，**亮点 1 必须换掉**（理由见 [RSI-DESIGN.md](RSI-DESIGN.md) 第 2 节）。

| 原亮点 | 建议改为 |
|---|---|
| 1. 影子工作区架构 | **代际化 harness store + 谱系**：让 agent 的自我修改成为可回滚的、有历史的资产 |
| 2. 文件级隔离 + 热加载 | **分级采纳门禁 + 原子热切换**：解决自修改 agent 的「采纳风险」与「切换延迟」这对矛盾 |
| 3. 无标准答案场景的优越性 | **迁移增益的实证**：在无 ground-truth 反馈下，harness 级递归比一次性改写有可测量的跨任务收益 |

### 5.3 学术诚信红线

- **不要说「我们提出了影子工作区」** —— 上游已有。可以说「我们把它工程化为可回滚的代际」
- **不要声称子进程隔离是安全沙箱** —— 在 limitations 里如实写
- **不要在没有对照组的情况下声称「优于」**
- 引用上游论文，并在方法章节明确区分「复用」与「新增」

### `✅ 完成判据`

- 一条命令跑完整个实验矩阵，产出 CSV
- 有 5 次以上重复，报告置信区间
- 成本归一后的对比图
- limitations 一节完整

---

## 时间汇总（乐观 / 悲观）

| 阶段 | 内容 | 乐观 | 悲观 |
|---|---|---|---|
| 0 | 环境 + demo | 3 天 | 1 周 |
| 1 | 代际存储 | 4 天 | 1 周 |
| 2 | 采纳门禁 | 1 周 | 2 周 |
| 3 | 服务 + 热切换 | 1.5 周 | 3 周 |
| 4 | GUI | 4 天 | 1.5 周 |
| 5 | 实验 + 论文 | 2 周 | 4 周 |
| **合计** | | **约 7 周** | **约 12.5 周** |

### 如果时间不够，砍什么？

**按这个顺序砍**（从最后往前砍）：

1. **GUI 的三栏 → 单栏对比**（省 3 天，评委仍能看到核心）
2. **真实 benchmark → 保留 golden task**（省 1 周，结论方向不变）
3. **L3 回归门禁 → 只保留 L1/L2/L4**（省 4 天）

**绝不砍**：代际存储、回滚、实验对照组。这三样没了，工作就失去了意义。

---

## 里程碑闸门

每个阶段结束，用一句话回答：**「我现在能演示什么？」**

能演示的必须是**真跑出来的东西**，不是 PPT：

- 阶段 1 后：能演示「改坏了，一条命令回滚」
- 阶段 2 后：能演示「坏候选被挡在门外，且给出了原因」
- 阶段 3 后：能演示「进化期间服务不中断」
- 阶段 4 后：能演示完整的「进化 → 对比 → 采纳 → 回滚」闭环
- 阶段 5 后：能演示「同一张表，跑出来的数字」

如果某一阶段答不上来，就**不要进下一阶段**。

---

## 阶段 1 交付记录

### 实际交付

```
rsi/
  __init__.py      # 包入口，从 store 导出公开 API
  store.py         # Generation / Ref / lineage / 原子指针 / swap / verify
  cli.py           # init / list / show / promote / rollback / verify / unlock
tests/
  test_store.py    # 21 个测试，全部通过
```

`pyproject.toml` 新增 `rsi` 命令入口，`packages.find` 加入 `rsi*`。

### 与设计文档的差异

**两处，都是实测后才发现的**：

1. **`content_hash` 不能按字符串排序**
   设计阶段想当然写的是 `sorted(tree)`。实测发现它和上游 `runmark.fingerprint`
   算不出同一个值——因为上游排序的是 `Path` 对象，`LongTermMEMORY.md`（大写 L）
   在路径排序里排在 `guardrails.md` 之后，但按字符串排序排在前面。
   **修正**：也排序 `Path`，保证代际指纹能直接和 rollout 记录的 harness 指纹比对。

2. **必须显式用 `newline="\n"` 写文件**
   `Path.write_text` 在 Windows 上把 `\n` 转成 `\r\n`。而 `runmark.fingerprint`
   哈希的是**原始字节**。不处理的话，同一棵树在 Windows 和 Linux 上指纹不同。
   **修正**：`rsi.store._write_tree_lf()` 统一以 LF 落盘。

   > 注意：这意味着 `rsi` **不能**直接用 `harness2.core.tree.write_tree()` 落盘。
   > 这是我们有意的偏离，理由写在 `_write_tree_lf` 的 docstring 里。

### 验收结果

```
$ rsi init --from-dir <base> --note "demo base harness"
g0001  base  9a9f036c57bbe21d
ref stable -> g0001

$ rsi promote <agg1> --kind auto --note "drop the positive-only filter"
g0002  parent=g0001  hash=b83f593e789f7be2
ref stable -> g0002

$ rsi list
g0001  base    9a9f036c57bbe21d  just now  demo base harness
  +- g0002  auto  b83f593e789f7be2  just now  drop the positive-only filter  <- stable

$ rsi rollback g0001
ref stable -> g0001  (base, 9a9f036c57bbe21d)
no files were copied or rebuilt; this is a pointer move

$ rsi verify
ok: 2 generations, all digests match
```

**最关键的一条验证**——切换代际后，同一个输入真的算出了不同结果：

```
g0001 (base): Total: 105.25      ← 带 "if amount > 0" 过滤，漏掉负数
g0002 (auto): Total: 85.15       ← 采纳的 harness，正确
```

这条证明的不是「代码能跑」，而是**代际切换确实改变了实际行为**。

### 测试覆盖（21 个）

| 类别 | 覆盖点 |
|---|---|
| 创建 | init 幂等、无树拒绝、重复树拒绝、缺失 parent 拒绝 |
| 不可变 | 代际目录不被改写、同内容拒绝提交 |
| 指纹 | 与上游 `runmark.fingerprint` 完全一致、顺序无关、落盘为 LF |
| 谱系 | 多级 lineage、根/子查询、环检测 |
| 指针 | promote 移动 stable、rollback 移回、悬空指针拒绝、非法 ref 名拒绝、原子写无残留 tmp |
| 物化 | materialise 往返一致、swap 无残留 staging 目录 |
| 校验 | 干净 store 无问题、能抓篡改、能抓悬空 ref |

### 未做（留给后续阶段）

- 代际的**外部证据目录**（`evidence/`）已实现写入，但没有结构化 schema，等门禁阶段确定
- **没有**并发进程同时 promote 的测试；当前假设单写入者，多写入者需要再加锁
- CLI 未接入 `--help` 的完整示例，目前靠 `rsi <cmd> -h`

---

## 阶段 2 交付记录

### 实际交付

```
rsi/
  golden.py        # golden task 执行器（跨平台进程组 kill）
  gate.py          # 四级门禁 + gate_and_promote
tests/
  test_gate.py     # 26 个测试
```

`rsi` CLI 新增：
- `rsi gate <dir>` —— 只跑门禁，不写任何东西（dry run）
- `rsi adopt <dir>` —— 门禁通过才提交为新代际并移动 `stable`

### 四级结构

| 级别 | 做什么 | 复用上游 |
|---|---|---|
| L1 静态 | `tree.validate()` + 对每个 `.py` 做 `compile()` | ✅ |
| L4 预算 | `tree.diff_summary()` 对比阈值 | ✅ |
| L2 冒烟 | 在子进程里真跑 golden task，必须退出码 0 且有输出 | 自建 |
| L3 回归 | 与 live 代际对比，检测倒退 | 自建 |

**执行顺序是 L1 → L4 → L2 → L3**，不是数字顺序。理由：L4 是纯计算，比 L2/L3 快三个数量级；
先做便宜的，一个明显超预算的重写就不必启动任何子进程。

### golden task 的取舍

用了一个 5 行的 CSV 求和任务，不是真实 benchmark。理由：

- 真实 benchmark 要 Docker / Pandoc / 云凭据，且适配器是 POSIX-only
- 用 5 行代码就能得到一个**可判定的真实任务**：harness 里带着 `scripts/summarize.py`，
  改 harness 就改答案，所以「空操作」和「修好了」能被输出区分开
- 两个任务都含负数，专门用来抓「过滤掉负数」这个真实错误

### 实测：每种坏候选都在预期级别被拒

```
# 语法错误 -> L1
$ rsi gate cand_syntax
rejected at L1: scripts/summarize.py does not compile: SyntaxError: invalid syntax (line 1)

# 能编译但崩溃 -> L2
$ rsi gate cand_crash
rejected at L2: golden task golden-signed-a failed: exit 7

# 死循环 -> L2（超时，进程组被杀）
$ rsi gate cand_hang
rejected at L2: golden task golden-signed-a failed: timed out after 30.2s

# 能跑但输出是垃圾 -> L3
$ rsi gate cand_noisy
rejected at L3: golden-signed-a: live is already wrong ('Total: 105.25') and the candidate
does not even produce a total-shaped answer ('not a total')

# 真正修好的 -> 采纳
$ rsi adopt cand_good --kind auto --note "drop the positive-only filter"
live   g0001  9a9f036c57bbe21d
  L1 static   ok   {'always_on_chars': 62, 'n_files': 5, 'scripts': 1, ...}
  L2 smoke    ok
                golden-signed-a: ok: Total: 85.15
                golden-signed-b: ok: Total: 20.25
  L3 parity   ok (no regression against live)
  L4 budget   ok   +0 ~1 -0 files, always-on +0

accepted: 1 file(s) changed, golden tasks passed
g0002  parent=g0001  hash=b83f593e789f7be2
ref stable -> g0002
```

### 一个实现中发现并修掉的语义漏洞（重要）

第一版 L3 的规则是「live 答对、candidate 答错 = 回归；两者都答错 = 不算回归」。

**实测发现这条规则会让明显的坏候选通过**：当 live 本身算错时（demo 的 base harness 就是错的，
算出 105.25），一个只会打印 `not a total` 的候选也被判为「平局，放行」。

修正为区分两种失败：

- **回归** —— live 对、candidate 错
- **两者都错** —— candidate 必须至少产出 **total 形状**的输出（`Total: <数字>`），
  否则拒绝。即「不比 live 差」不等于「什么都可以」

这条的教训是：**基线本身有问题时，相对比较会失效**。如果 live 是坏的，L3 就退化成空检查。
真实系统里更稳妥的做法是 L3 始终对照一个**已知正确的基准 harness**，而不是当前的 live——
这个改进记在下方「未做」里。

### 测试覆盖（26 个）

| 级别 | 覆盖点 |
|---|---|
| L1 | 合法树通过、语法错误、空树、超 always-on 上限、skill 无触发行、脚本被引用但未 ship |
| L4 | 小改动通过、大范围重写、always-on 字符超限、删除过多 |
| L2 | 正常通过、崩溃、死循环超时、缺脚本 |
| L3 | 改进通过、倒退拒绝、两者都错但形状正确放行、两者都错且是垃圾拒绝 |
| 顺序 | L1 失败时不启动子进程（`golden == {}`）、L1 优先于 L4 |
| 端到端 | 采纳后 stable 移动且写了 `evidence/gate.json`、拒绝时**一个字节都不写**、空操作候选被 store 拒绝 |

### 未做

- **L3 应对照固定的基准 harness**，而不是当前 live。当前实现是「相对 live 不倒退」，
  当 live 本身有问题时会退化。等有真实任务集后应该改成对照 golden baseline。
- **L2/L3 只在 Windows 上验证过**，Linux 的分支（`start_new_session` + `os.killpg`）
  写了但没跑过。
- **并发**：门禁假设单写入者，没有防止两个进程同时 adopt 的锁。

---

## 阶段 3 交付记录

### 技术选型的一处偏离

**没有用 FastAPI。** 本机没有 FastAPI/uvicorn，且不擅自改全局环境；更重要的是，
上游 Harness2 自己就是 `dependencies = []`（零运行时依赖）。一个"必须先装点什么才能启动"
的服务，比一个"请求处理器朴素但立刻能跑"的服务，作为第一步更差。

所以 `rsi/server.py` 用标准库 `http.server` + `ThreadingHTTPServer`，事件流用 SSE
（`text/event-stream`）而不是 WebSocket。代价是没有异步、没有自动参数校验；
收益是零依赖、可直接 `python -m rsi.cli serve`。

### 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 服务信息 |
| GET | `/current` | 当前代际 id、content_hash、文件名列表（热路径） |
| GET | `/current/tree` | 当前 harness 全文 |
| GET | `/generations` | 全部代际 + refs |
| GET | `/generations/{id}` | 单代际详情 + lineage |
| GET | `/events?since=N` | SSE 事件流，支持从 seq 重放 |
| GET | `/verify` | 完整性校验 |
| POST | `/adopt` | 门禁 → 通过才提交 |
| POST | `/rollback` | 移动指针 |

### 两把锁，不是一把

第一版用一把锁包住「读代际」和「采纳」，压测直接暴露问题：一次采纳在门禁里要
150–240ms，**所有读者都堵在后面**。

拆成：

- `_write_lock` —— 串行化采纳（两个门禁不能同时看到同一个 live 基线）
- `_swap_lock` —— 只在「读指针+缓存树」或「写指针+清缓存」这两步持有

**门禁不持有任何锁**。它先取一次快照，然后在子进程里跑测试，最后才回来提交。

### 压测发现并修掉的三个问题

#### 1. 缓存命中仍在读盘（267μs/次）

第一版缓存判断是「先 `store.current()` 看 id 变没变，再决定用不用缓存」。
但 `current()` 本身要 267μs，**缓存等于没生效**。

修正：ref 只会通过本对象（adopt/rollback）改变，两条路径都清缓存，
所以**缓存非空即为答案**，热路径完全不碰磁盘。改后 p50 从 8.2ms 降到 5.1ms。

#### 2. `listen()` backlog 默认 5 → 8 并发时 592ms 停顿

8 个连接同时到达，第 8 个在 listen 队列被拒，客户端重传，Windows 上约 500ms。
**这不是我们的代码问题**——用裸 `ThreadingHTTPServer` + 空 handler 复现了同样的停顿。

修正：`request_queue_size = 128`。实测 max 从 **592ms → 15ms**。

#### 3. 压测客户端耗尽临时端口（假的失败）

64 并发时大量 `WinError 10048`。原因是压测脚本每个请求都新建 TCP 连接，
TIME_WAIT 堆积耗尽临时端口——**服务端是好的**。

修正：每个读线程一条持久 `HTTPConnection`。修正后 64 并发零错误。

> 这条值得单独记：**压测工具的缺陷会被误读成被测系统的缺陷**。
> 第一版报告里那些 "errors" 全是假的。

### 压测数据

| 场景 | 并发 | 请求数 | RPS | 错误 | 不一致读 | p50 | p99 | max |
|---|---|---|---|---|---|---|---|---|
| 指针抖动 | 16 | 20,605 | 3,244 | 0 | 0 | 4.5ms | 15.7ms | **21.7ms** |
| 真实采纳 | 16 | 18,082 | 3,011 | 0 | 0 | 5.1ms | 8.0ms | **38.0ms** |
| 指针抖动 | 64 | 42,690 | 2,970 | 0 | 0 | 20.2ms | 34.1ms | 383ms* |
| 专项测量 | 64 | 15,152 | — | 0 | 0 | 24.1ms | 32.2ms | **36.6ms** |

* 383ms 是首轮建连开销，专项测量（连接预热后）显示 64 并发下
**0 次超过 100ms**，max 仅 36.6ms。

「不一致读」的定义：响应的 `generation` 与其 `tree` 对不上，或脚本/systemprompt 缺失。
**全部为 0** —— 这是热切换正确性的核心指标。

### 测试（23 个）

| 类别 | 覆盖 |
|---|---|
| 读路由 | info/current/current-tree/generations/show/verify、未知路由 404、未知代际 404 |
| 写路由 | 采纳移动指针、拒绝返回 422 且指针不动、重复 409、缺 tree 400、坏 JSON 400 |
| 回滚 | 移动指针且保留历史、回滚到不存在的代际 409 |
| 事件 | 顺序、有界、采纳/拒绝各自事件、`close()` 能唤醒阻塞订阅者 |
| 并发 | 快照 id 与树匹配、缓存被 swap 失效、**采纳期间读者不被饿死** |

### 未做

- **没有鉴权、限流、TLS**。默认绑 `127.0.0.1` 正是因为它会把 agent 写的代码执行掉，
  不该隐式暴露到网络。
- **单进程**。多进程部署会让每个进程各有一份缓存，需要改成基于文件 mtime 或消息的失效。
- **SSE 而非 WebSocket**。单向够用（服务→客户端），双向需求出现再说。
- **多写入者未测**。当前假设一个服务进程独占 store。
