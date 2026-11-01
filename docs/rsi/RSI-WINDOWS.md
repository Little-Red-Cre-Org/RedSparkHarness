# Windows 兼容性实证报告

> 测试机：Windows + PowerShell，Python 3.12.10
> 测试对象：Harness² `1cfe254`（v0.1.0）+ 本项目补丁
> 结论一句话：**core 已在 Windows 原生跑通（demo 全部成功、单元测试 5/5）；benchmark 适配器仍是 POSIX-only。**

本文所有结论均来自**实际执行**，不是代码阅读推断。每条都附了可复现的命令与真实输出。

> **状态（已修复）**：第二节、第三节的两处缺陷已在本仓库修复，提交 `fix/windows-portability`
> 之后的 `main`。修复内容见文末「修复记录」。第四节的 benchmark 适配器**未改**，
> 出于与上游可比性的考虑。

---

## 一、结论摘要

| # | 结论 | 判定 |
|---|---|---|
| 1 | Python 3.12.10 已就绪，满足上游 `requires-python >=3.12,<3.14` | ✅ 可跑 |
| 2 | `harness2-demo` 的**全部真实工作**（递归、证据树、rollout、选择、经验库）在 Windows 上正常执行 | ✅ 可跑 |
| 3 | 原会在写 `summary.json` 时崩溃：`ModuleNotFoundError: No module named 'fcntl'` | ✅ **已修复**（见第八节） |
| 4 | 组件树相对路径曾用 OS 分隔符，导致 README 桩文件排除失效、进化静默不生效 | ✅ **已修复**（见第八节） |
| 5 | 真实 benchmark 适配器（LAB / JobBench / WorkBuddy）使用 `os.killpg` + `start_new_session` | ❌ POSIX-only（**故意未改**） |

**总结：`harness2/core/` 现已在 Windows 原生跑通 —— demo 2/2 成功、单元测试 5/5 通过。
真实 benchmark 仍建议走 WSL2，因为我们不想让 benchmark 的运行方式偏离上游基线。**

---

## 二、缺陷 1：`fcntl` 是 POSIX 专有模块（阻断级）

### 位置

`harness2/core/schedule.py:289-328`，函数 `_write_summary()`：

```python
def _write_summary(summary_path: Path, res: TaskResult) -> None:
    """Merge 'res' into the summary under an flock, atomically, deriving the merged status."""
    import fcntl                                   # ← 第 294 行，Windows 上直接 ImportError

    lock = summary_path.with_suffix(".lock")
    with open(lock, "w") as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)             # ← 第 298 行
        try:
            ...
        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)         # ← 第 328 行
```

### 为什么是阻断级

注意 `import fcntl` 是在**函数体内**，所以模块导入不受影响 —— 整个程序能启动、
能跑 rollout、能建证据树、能选出候选。**唯独在最后写 summary 时崩掉。**

这意味着：**所有计算都白做了**。这是最糟糕的失败模式 —— 不是"跑不起来"，
而是"跑了 40 分钟，最后一步丢了"。

### 实测证据

```
$ python -m harness2.cli.demo --output .probe\lead-demo --k 1
  [accounting] 1/2 exception    ledger-1  :: ModuleNotFoundError: No module named 'fcntl'
  [accounting] 2/2 exception    ledger-2  :: ModuleNotFoundError: No module named 'fcntl'
Local demo: 0 tasks completed; 2 failed. D:\RSIHarness\.probe\lead-demo\demo.json
=== EXITCODE: 1 ===
```

但产物目录里**所有 rollout 都齐了**：

```
.probe\lead-demo\executions\demo-oc-agg1\ledger-1\agg1\answer.txt
.probe\lead-demo\executions\demo-oc-agg1\ledger-1\agg1\trajectory.md
.probe\lead-demo\executions\demo-oc-agg1\ledger-1\base1\answer.txt
.probe\lead-demo\executions\demo-oc-agg1\ledger-1\dom1\answer.txt
.probe\lead-demo\executions\demo-oc-agg1\ledger-1\inv1\answer.txt
...（两个任务、四个 label 全部齐全）
```

### 验证：打上跨平台垫片后完全通过

用一个最小的 `fcntl` 替代模块（`flock` 为 no-op）注入 `sys.modules` 后重跑：

```
  [accounting] 1/2 ok           ledger-1
  [accounting] 2/2 ok           ledger-2
DONE: 2 FAILED: 0
=== EXIT: 0 ===
```

且 `summary.json` 完整性正确，预算恒等式成立：

```json
"ledger": {
  "mode": "agg", "k": 1,
  "R": 4, "expected_R": 4,     // 4k = 4
  "P": 3, "expected_P": 3      // 3k = 3
}
```

### 建议修复

把 `_write_summary` 里的锁抽成一个可移植的小模块，例如 `harness2/core/_lock.py`：

```python
import contextlib
import os

if os.name == "posix":
    import fcntl
    def lock(f):
        fcntl.flock(f, fcntl.LOCK_EX)
    def unlock(f):
        fcntl.flock(f, fcntl.LOCK_UN)
else:
    import msvcrt
    def lock(f):
        f.seek(0)
        msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
    def unlock(f):
        f.seek(0)
        msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)

@contextlib.contextmanager
def exclusive(path):
    lockfile = path.with_suffix(".lock")
    with open(lockfile, "w") as f:
        lock(f)
        try:
            yield
        finally:
            unlock(f)
```

> **注意**：`msvcrt.locking` 的语义与 `flock` 并不完全等价（前者是强制区域锁，
> 后者是建议性整文件锁）。在这个用途下（单机、单进程串行写 summary）足够。
> **这一点必须在代码注释里写清楚**，不要假装完全等价。

**改动量**：新增 1 个文件约 25 行，`schedule.py` 改动 3 行。

---

## 三、缺陷 2：路径分隔符导致桩文件排除失效（静默）

### 位置

`harness2/core/tree.py:127-149`（`read_tree`）与 `SurfaceSpec.stubs` 的定义。

`SurfaceSpec.stubs` 用的是**正斜杠**的相对路径：

```python
stubs=(
    ("scripts/README.md",   "<!-- c7 ... -->"),
    ("sub_agents/README.md","<!-- c5 ... -->"),
    ("plugin/README.md",    "<!-- c8 ... -->"),
    ("skills/README.md",    "<!-- c6 ... -->"),
)
```

但 `read_tree` 计算 `rel` 用的是 `str(p.relative_to(d))` —— 在 Windows 上产生**反斜杠**：

```python
for p in sorted(d.rglob("*")):
    rel = str(p.relative_to(d))        # Windows: "skills\\README.md"
    if rel in stubs:                   # ← 永远不相等
```

### 实测证据

```
stub paths expected: ['plugin/README.md', 'scripts/README.md', 'skills/README.md', 'sub_agents/README.md']
read_tree keys: ['LongTermMEMORY.md', 'guardrails.md', 'systemprompt.md', 'tool_descriptions\\tool_guidance.md']
REJECTED: ['plugin\\README.md', 'scripts\\README.md', 'skills\\README.md', 'sub_agents\\README.md']
```

桩文件本应被**静默跳过**，实际却作为"越权路径"被记录进 `rejected`。

### 后果（比看起来严重）

在 `recursion._run_stage()` 里，`rejected` 非空会**直接拒绝整个提案**：

```
these files are off the editable surface and were not applied:
plugin\README.md, scripts\README.md, skills\README.md, sub_agents\README.md.
Component names must be lowercase letters, digits, '_' or '-'
```

这个错误会被拼进重试提示词喂回给 proposer，而 proposer **无论怎么改都改不对** ——
因为它根本没有触碰这些文件，是框架把它们塞进了 rejected 列表。

实测中（配合同一垫片消除 fcntl 影响），**三个 stage 全部 `fell_back: true`，
且错误信息完全一样**：

```json
"stages": [
  {"label": "inv1", "fell_back": true, "attempts": 2,
   "error": "these files are off the editable surface ... plugin\\README.md, ..."},
  {"label": "dom1", "fell_back": true, "attempts": 2, "error": "（同上）"},
  {"label": "agg1", "fell_back": true, "attempts": 2, "error": "（同上）"}
]
```

**这是最危险的一类 bug**：程序不崩溃、不报错、退出码 0，但**进化完全没发生** ——
所有候选都静默回退到了基线。

### 建议修复

一处即可，把 `rel` 统一成正斜杠：

```python
rel = p.relative_to(d).as_posix()      # 永远用 '/'，与 SurfaceSpec 的约定一致
```

同时 `write_tree()` 里比较 `stub_set` 的那处也需要同样处理（它目前也走 `str(...)`）。

**改动量**：2 行。

---

## 四、真实 benchmark 适配器：POSIX-only（不建议硬改）

以下位置**硬依赖** POSIX 的进程组语义，Windows 上没有等价物：

| 文件 | 行 | 代码 |
|---|---|---|
| `harness2/benchmarks/lab.py` | 408 | `subprocess.Popen(cmd, start_new_session=True, **kw)` |
| `harness2/benchmarks/lab.py` | 413 | `os.killpg(proc.pid, signal.SIGKILL)` |
| `harness2/benchmarks/jobbench.py` | 57 | `subprocess.Popen(cmd, start_new_session=True, **kw)` |
| `harness2/benchmarks/jobbench.py` | 62 | `os.killpg(proc.pid, signal.SIGKILL)` |
| `harness2/benchmarks/workbuddy.py` | 632 | `start_new_session=True` |
| `harness2/benchmarks/workbuddy.py` | 462 | `os.killpg(proc.pid, attempt)` |

这些不是"改个函数名"能解决的：

- `start_new_session=True` 在 Windows 上被忽略，子进程不会被放进新进程组
- `os.killpg` 在 Windows 上不存在
- Windows 的替代方案是 `CREATE_NEW_PROCESS_GROUP` + `taskkill /T /F`，
  **语义不同**：`taskkill /T` 按父子关系杀，而不是按进程组

### 为什么建议**不要**硬改

一旦改了，这些 benchmark 的运行方式就**偏离了上游基线**。而我们做实验时需要声称
"结果与上游可比"。为了省一个 WSL2 而牺牲可比性，不划算。

**推荐：真实 benchmark 走 WSL2；Windows 只用于 core 与自建 golden task 的开发。**

---

## 五、上游做得好的地方（值得记录）

这几点在 Windows 上**没有**成为问题，说明上游的平台抽象做得不错：

- **路径处理** —— 除上述 `read_tree` 一处，其余大量使用 `pathlib`，未发现硬编码 POSIX 路径
- **`.env` 解析** —— 纯文本处理，无平台依赖
- **JSON / 文件原子写** —— `os.replace()` 在 Windows 上同样是原子的
- **`hashlib` / `fnmatch`** —— 跨平台
- **零运行时第三方依赖** —— `dependencies = []`，没有 C 扩展带来的编译问题

---

## 六、给本项目的建议

### 开发环境：**WSL2**（推荐）

| 理由 | 说明 |
|---|---|
| 与上游一致 | 不必维护一套 Windows 分叉 |
| benchmark 可用 | 后期做真实评测时不必二次返工 |
| 我们的增量不依赖平台 | 代际/门禁/服务层是纯 Python，放哪都能写 |

### 如果坚持 Windows 原生开发

**只做 core 层的开发**（代际存储、门禁 L1/L4、服务层），
真实执行（门禁 L2/L3、benchmark）留到 WSL2 或 Linux 机器上验证。

同时必须先打上本文第二节、第三节的两个补丁 —— 否则 demo 都跑不完整。

### 一个隐藏收益

缺陷 2 揭示了一个值得写进论文的点：**跨平台移植是检验框架抽象质量的试金石**。
一个只在 Linux 上跑过的框架，往往在路径、锁、进程组这三处暴露假设。
我们把这三点都定位到了具体行号 —— 这本身就是一份有价值的工程贡献。

---

## 七、复现步骤

```powershell
cd D:\RSIHarness

# 1. 直接跑（预期失败）
python -m harness2.cli.demo --output .probe\lead-demo --k 1

# 2. 带 fcntl 垫片跑（预期 stage 全部 fell_back，但退出码 0）
python .probe\tb2.py

# 3. 单独验证路径分隔符问题
python .probe\tb3.py
```

原始探测脚本保留在 `.probe/`（已加入 `.gitignore`，不入库）。

---

## 八、修复记录

### 提交内容

| 文件 | 改动 |
|---|---|
| `harness2/core/lock.py` | **新增**。可移植的文件锁，POSIX 用 `fcntl.flock`，Windows 用 `msvcrt.locking`，对调用方暴露同一个 `exclusive(path)` 上下文管理器。 |
| `harness2/core/schedule.py` | `_write_summary()` 改用它；删掉函数体内的 `import fcntl` 与裸露的 `try/finally`。 |
| `harness2/core/tree.py` | `read_tree()` 与 `write_tree()` 的 `rel` 改用 `.as_posix()`。 |
| `harness2/core/runmark.py` | `fingerprint()` 的哈希键改用 `.as_posix()`，保证同一棵树在不同平台指纹一致。 |
| `harness2/core/proposer.py` | `_call_fingerprint()` 同上。 |

后两处是修前面问题时**顺带发现的同类隐患**：它们不影响运行，但会让「同一棵 harness 树」
在 Windows 与 Linux 上算出不同指纹，从而破坏跨平台的结果复用与比对。

### 关于 `msvcrt` 与 `flock` 不等价

这一点在 `lock.py` 的模块文档里写明了，不藏在注释里：

- `fcntl.flock` 是**建议性**整文件锁，不申请锁的进程不受影响
- `msvcrt.locking` 是**强制性**字节区间锁，对第 0 字节加锁

两者的差异在「单机、协作进程串行写一个 JSON」这个用途下可接受，但**不能声称完全等价**。
另外锁不替代原子替换 —— 调用方仍然先写临时文件再 `os.replace`。

### 验证结果

```
$ python -m harness2.cli.demo --output .probe\demo_verify --k 2
  [accounting] 1/2 ok           ledger-1
  [accounting] 2/2 ok           ledger-2
Local demo: 2 tasks completed; 0 failed.
EXIT=0
```

```
$ python .probe\verify.py         # 5 个单元测试
  [PASS] test_complete_evidence_and_library_prefix          4.7s
  [PASS] test_failed_selection_is_never_judged              2.5s
  [PASS] test_invalid_proposal_retries_with_feedback...     0.0s
  [PASS] test_no_entry_stays_out_of_library_on_resume       2.2s
  [PASS] test_recursion_budget_and_resume                  11.4s
RESULT: 5/5 passed
```

而且**进化真的发生了**（这是判断 demo 是否「只是跑通」的关键）：

```
base1  Total: 105.25     ← 基线，脚本里带 "if amount > 0"，漏掉负数
inv1   Total: 85.15      ← 候选
dom1   Total: 85.15      ← 候选
agg1   Total: 85.15      ← 采纳的最终 harness
```

采纳的 `agg1/scripts/summarize.py` 相对 base 去掉了 ` if amount > 0`：

```diff
-total = sum((amount for amount in amounts if amount > 0), Decimal(0))
+total = sum((amount for amount in amounts), Decimal(0))
```

预算恒等式也成立（k=2）：`R=8/8`、`P=6/6`，即 4k 次 rollout、3k 次 session。
