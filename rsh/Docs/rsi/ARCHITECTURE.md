# Harness² 架构剖析

本文是对上游 [Harness²](https://github.com/google-research/harness2)（下称 H²）的完整剖析，
目的是回答一个问题：**我们要继承什么、改造什么、不能碰什么。**

分析基于仓库提交 `1cfe254`（v0.1.0）。

---

## 0. 一句话定位

H² 是「**在模型权重冻结的前提下，让 Agent 自己改写自己的 harness**」的框架。

它优化的不是模型，而是模型外面那一圈东西：系统提示、护栏、长期记忆、工具描述、子代理、
技能、脚本、插件。论文里把这八类称为 **c1..c8 组件**。

关键判断：H² 的本质不是「prompt 优化器」，而是**对 harness 空间的一次带证据的搜索**。
理解这一点，才能理解它为什么把「证据」看得比「分数」还重。

---

## 1. 三层正交切分（最值得继承的设计）

整个仓库被切成三个互不依赖的层，契约写在 `harness2/core/spec.py`：

| 层 | 目录 | 职责 | 依赖方向 |
|---|---|---|---|
| **method** | `harness2/core/` | 递归、提示词、选择、经验库 | 不知道任何 benchmark |
| **substrate** | `harness2/substrate/` | 被测 Agent 框架（OpenCode / Codex） | 只知道 surface schema |
| **benchmark** | `harness2/benchmarks/` | `BenchSpec` 值 + `BenchmarkAdapter` 协议 | 依赖上面两层 |

`BenchmarkAdapter` 是一个 `Protocol`（结构化类型，非继承），core 只透过它看 benchmark。
substrate 在 core 眼里退化成 `SubstrateLike`——只需要 `.name` 和 `.surface()`。

**收益**：换 benchmark 不动 core，换 substrate 不动 benchmark。
**代价**：适配新 benchmark 时要实现 12 个方法，粒度相当细。

### 一个刻意的信息屏障

`RunView` 的文档字符串只有一句话：

> ```python
> """What the method knows about one finished rollout. Never carries a score."""
> ```

方法层**看不到分数**。这是整套设计的地基：如果方法层能看到分数，它就会去拟合分数，
适配就退化成作弊。这个约束在代码里是用类型强制执行的——`RunView` 根本没有 score 字段。

---

## 2. 可编辑表面 c1..c8

`SurfaceSpec`（`core/tree.py`）把「哪个文件可编辑」表述成**纯数据**，而不是散落各处的
`if` 判断：

```python
OPENCODE_SURFACE = SurfaceSpec(
    name="opencode",
    always_on=("systemprompt.md", "guardrails.md",
               "LongTermMEMORY.md", "tool_descriptions/tool_guidance.md"),
    always_on_max=24_000,          # 硬上限
    skill_dir="skills",            # skills/<name>/SKILL.md，name 必须与目录一致
    subagent_requires_mode=True,   # sub_agents/<name>/AGENT.md 需要 mode: subagent
    plugin_dir="plugin",           # plugin/<name>.ts
    hooks_file=None,
)
```

``tree.py` 的核心思想是 **省略即继承（omitted-is-inherited）**：一次 proposal 只输出
它改动的文件，其余从基线继承。这既省 token，又让 diff 干净。

### 校验器扮演的是「反馈通道」，不是「守门人」

`validate()` 把**所有**问题合成一个字符串，原样喂回给 proposer 去修：

```python
raise ValueError(" | ".join(errs))   # 这个字符串就是重试的反馈
```

这不是防御性编程，而是**搜索引导**。H² 的收敛质量很大程度上取决于这条通道写得好不好。

几条值得注意的约束：

- **`always_on_max = 24_000`** — 理由写在代码里：`"every token here competes with the
  agent's own output budget"`。always-on 内容不是越多越好。
- **`autotrigger()`** — 新增的 skill 如果没在 always-on 文本里被提及，自动补一行触发语。
  注释说得很直接：`"an untriggered skill is dead weight"`。
- **`_check_script_refs()`** — always-on 文本里 invoke 了 `scripts/x.py` 却没 ship 这个文件，
  直接报错。
- **`skill_name_rule="must_match"`** — frontmatter 的 `name:` 与目录名不一致时，框架会
  **静默丢弃**该 skill。所以校验在这里拦截，错误信息写明 "dropped SILENTLY at load"。
- **`diversity()`** — 两两计算 line-Jaccard。这是用来检测 k 个候选**坍缩成同一个 body** 的
  坍缩指标。

---

## 3. 递归：Propose–Probe–Compose 的两种展开

`core/recursion.py` 定义两种模式，`ledger.py` 用账本硬约束预算：

| 模式 | 磁盘 token | 结构 | rollout 数 | session 数 |
|---|---|---|---|---|
| Parallel | `agg` | 2k 候选（k 个 INV + k 个 DOM）→ k 个独立 composition | `4k` | `3k` |
| Sequential | `seq` | k 轮，每轮 INV+DOM 探针 → 1 个 compose，链式传递 | `4k` | `3k` |

`Ledger.assert_identity()` 强制这两个恒等式成立。这是论文可复现性的硬保障。

### INV 与 DOM 的分解

- **INV（invariant）** — 跨领域普遍成立的结构性改动（例如「先读任务再动手」）
- **DOM（domain）** — 针对当前领域的专项改动（例如「法律文书必须先核对条款编号」）

这个二分是整个方法能泛化的关键：INV 负责迁移，DOM 负责得分。

### 失败语义是最容易被忽略的设计

`_run_stage()` 里，proposal 被拒后：

1. 重试一次（`STAGE_ATTEMPTS = 2`），把校验错误拼成
   `"# YOUR PREVIOUS ATTEMPT WAS REJECTED"` 段塞回 mission
2. 仍然失败 → **回退到 fallback tree 并标记 `fell_back=True`**

注意它没有「放弃这个任务」，而是**回退到基线继续**。失败被记录，但不中断流水线。

---

## 4. Probe 到底怎么实现（最值得学的部分）

这是 H² 和一般「让 LLM 改 prompt」方案的分水岭。

`context.build()` 在磁盘上构造一棵**证据树**：

```
context/<label>/
  task.md                 任务（已剥离判分标准与期望输出）
  source/                 任务原始素材（已剥离答案键）
  harness/                当前 harness 全量快照
  base_harness/           基线 harness（diff 的参照物）
  rollouts/<label>.md     每条 rollout 的完整轨迹
  pool/<label>/           并行模式下其它候选的轨迹 + harness.diff
  decisions/<label>.md    上一阶段每个候选的裁决理由
  library/                同领域的经验库
```

然后 `mission()` 只给一段**指针**，把证据留在磁盘上：

> It is on disk, in `context/`. Read it -- do not answer from this message alone.
> ... Cite the specific trajectory moment behind every change;
> **one you cannot trace to a moment is speculation.**

这个设计有三个后果：

1. **上下文不再被证据量撑爆** — 证据是文件，agent 用 grep/read 按需取
2. **证据完整** — 注释强调 "Every trajectory EVENT is present"，轨迹不被裁剪
3. **可审计** — 每个改动都必须落到一个具体的轨迹时刻

轨迹渲染成统一语法（`substrate/opencode.py::render_events`）：

```
[ACTION] tool_name(args)
[OBSERVATION] result
[OBSERVATION ERROR] err
[ASSISTANT] text
[THINKING] reasoning
```

substrate 之间只差渲染器，语法是共享的。

---

## 5. 反作弊：这套设计的可信度来源

如果 agent 能读到答案或判分标准，实验就一文不值。H² 在四个位置埋了防线：

### 5.1 路径级：`leak_globs`
`assert_no_leak_paths()` 在证据树落地前扫 benchmark 声明的答案键路径，命中即 raise。

### 5.2 内容级：`GRADER_VERDICT_MARKERS`
14 个标记（`deterministic_eval_summary`、`"pass_rate"`、`"judge_scope_and_deterministic_status"`
等）在**文件名与文件内容**双重扫描。命中时抛出的错误信息值得逐字读：

> The tripwire in core.context fired -- **this is a leak, not a false positive to widen
> around. Find the read path that produced it.**

这段话是在防止未来的维护者「顺手把标记删掉让测试通过」。

### 5.3 提示词级：`BenchPrompts.__post_init__`
给 proposer 的 prompt **禁止出现** `benchmark` / `evaluation` / `grader` / `rubric` /
`score`。理由写得很清楚：

> must describe the WORK, not its measurement (found {bad!r}).
> Say what the practitioner needs.

### 5.4 渲染级：`obs_trunc` 下限
`obs_trunc < 10_000` 会被拒绝，因为太短会 **"fabricate defects"**（伪造缺陷）：
截断造成的假象会被 agent 误判为真实 bug。

---

## 6. 选择与经验库

### 6.1 盲选（selection.py）

- **匿名化**：`assign_ids()` 以 `sha1(task_id|k|mode)` 为种子做 shuffle，候选显示为 A/B/C。
  种子固定 ⇒ 跨重跑稳定。
- **池子构造**：`selection_pool()` 只取当前模式的 k 个 final。**base 参考执行不在池子里**，
  所以「弃权」在结构上不可能发生。
- **失败回退**：selector 崩了 → 回退到已交付的 base，并打 `fallback=True`，错误保留。
- **失败不算 0 分**：`test_failed_selection_is_never_judged` 明确断言
  `self.adapter.score.assert_not_called()`。

最后一条尤其重要：**判分失败与得 0 分是两个不同的语义**。混同会让整篇论文的数据失真。

### 6.2 经验库（library.py）

```
<root>/<run-tag>/<mode>/<domain>/INDEX.md
<root>/.../<domain>/harnesses/<task>/harness/<rel>     完整组件树
<root>/.../<domain>/harnesses/<task>/EXPERIENCE.md     cue / lesson / evidence / confidence
```

三个设计点：

- **检索是按构造的**：一个 domain 目录里只可能放同 domain 的条目，不需要相似度搜索
- **整棵树都带**，不做摘要——摘要会丢信息
- **`has_experience()` 要求 cue/lesson/evidence 三者都非空**，否则不写库。
  这条防止空经验污染后续任务。

---

## 7. 状态、幂等与续跑

- `runmark.py` 写 `.adapt_complete` 标记，**记录产生这条 rollout 的 harness 指纹**。
  换配置的 rollout 不会被误复用。`fingerprint(None) == "base"` 是刻意设计。
- `mark_complete()` 只在 runner **正常返回后**调用——「有输出」不等于「完成了」。
- 重复同一条命令 = resume。这是 H² 用起来最舒服的一点。

---

## 8. substrate 的三种安装模式（这是个陷阱）

`substrate/opencode.py` 支持三种把 always-on 文本送进框架的方式：

| 模式 | 使用者 | 做法 |
|---|---|---|
| `workspace_agents_md` | JobBench | 追加 `AGENTS.md` + `.opencode/{skills,agent}` |
| `home_dir_jinja` | WorkBuddy | `_composed/prompt.j2` 模板 |
| `workspace_config` | LAB | 渲染组合 + `ENV_DELTA` + `opencode.json` 工具门 |

源码注释直接警告：

> The install modes are different delivery channels for the always-on text and are
> **not interchangeable**: changing the one a benchmark uses moves that benchmark's baseline.

`assert_jinja_safe()` 强制 `{{ instruction }}` **恰好出现一次且位于最末尾**，
其余位置出现任何 `{{` / `{%` / `{#` 都会让任务在 trial 之前就死掉。

---

## 9. 依赖与数据面

`pyproject.toml` 里 `dependencies = []`——**运行时零第三方依赖**。这是很罕见的克制。
唯一的可选依赖是：

- `[render]` — `openpyxl`、`python-pptx`，用于 WorkBuddy 的 Office 文档渲染
- `[bridge]` — `litellm`/`fastapi`/`google-auth`，用于 `.env` 之外的凭据桥接

benchmark 工具链全部落在 `dependencies/`（git 忽略），版本钉死在 `config.DEPENDENCY_PINS`：

```python
DEPENDENCY_PINS = {
    "job-bench-eval":  "fa03a17f...",
    "workbuddy-bench": "b516950b...",
    "harvey-labs":     "b58a28ae...",
    "opencode":        "23fb5e05...",
}
```

---

## 10. 它的边界（诚实评估）

这一节是我们做 RSIHarness 的直接动机。

| 局限 | 具体情况 | 对我们的影响 |
|---|---|---|
| **强 benchmark 依赖** | 没有 benchmark 就什么都跑不了。唯一自包含路径 `harness2-demo` 用的是**脚本化的假 proposer** | 必须先造自己的任务源 |
| **离线批处理** | 形态是 `sweep → judge → report` 的批任务，不是常驻服务 | 服务化是空白，也是机会 |
| **无回滚** | 采纳后的 harness 落到 `runs/` 目录，靠目录名区分；没有代际、没有指针、没有回滚 | 这是最痛的缺口 |
| **proposer 靠外部 CLI** | `opencode`(bun 子进程) 或 `claude` CLI；无 SDK 级集成、无流式 | 进程边界是稳定的，不必改 |
| **POSIX 假设** | `os.killpg` + `start_new_session=True` 出现在 `lab.py`/`jobbench.py`/`workbuddy.py` | 只影响 benchmark 适配器；core 是纯 Python |
| **无可视化** | 全 CLI，结果靠读 JSON 和 markdown | 空白，也是机会 |
| **无运行时自适应** | 进化出的 harness 只能**下一次**任务用；当前任务内不切换 | 低风险高回报的空白 |

---

## 11. 我们能直接复用什么

| 能力 | 位置 | 复用方式 |
|---|---|---|
| c1..c8 表面定义与校验 | `core/tree.py` | **原样复用**，可扩展新 substrate |
| 证据树构造与泄漏防护 | `core/context.py` | **原样复用** |
| 递归调度与预算账本 | `core/recursion.py`、`core/ledger.py` | **原样复用** |
| 盲选与经验库 | `core/selection.py`、`core/library.py` | 复用 + 扩展双通道采纳 |
| 幂等与续跑 | `core/runmark.py` | **原样复用** |
| 提示词模板 | `core/prompts.py` | 复用，需要重写 `BenchPrompts` 的工作描述 |

**结论**：H² 的 core 是一份质量很高的、可直接继承的资产。我们要补的不是「再发明一遍
影子工作区」，而是它明确**没做**的三件事：代际化与回滚、在线闭环、可视化审计。

具体设计见 [RSI-DESIGN.md](RSI-DESIGN.md)，实施顺序见 [RSI-ROADMAP.md](RSI-ROADMAP.md)。
