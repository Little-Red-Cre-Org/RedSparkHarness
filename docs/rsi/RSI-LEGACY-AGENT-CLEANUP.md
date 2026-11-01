---
description: "RSI Harness 里旧 Agent 适配器的清理清单：删什么、为什么、影响哪些 import，以及替代方案。"
kind: "guide"
---

# 旧 Agent 清理清单

本文是**待批准的方案**，不是已执行的清理。所有行号与引用数都是实测。

## 判断依据

RSI Harness 的 rsi/ 引擎不实现 Agent，它优化的是「一代 harness 如何变成下一代」。
真正执行任务的 Agent 由一层**适配器**提供，这一层就是 `harness2/substrate/`。

我们现在用 RedSpark Harness 做 Agent，所以对 Codex 与 OpenCode 的适配器属于旧 Agent。

## 一、必须删的：Codex 适配器

| 文件 | 行数 | 说明 |
|---|---|---|
| `harness2/substrate/codex.py` | 480 | 对接 codex-cli，定义 `CODEX_SURFACE` 与 `CodexSubstrate` |

**rsi/ 对它的引用：零。** 只有 `harness2/benchmarks/` 的三个基准在用它：

```
harness2/benchmarks/jobbench.py:42,639
harness2/benchmarks/lab.py:39,526,841,887
harness2/benchmarks/workbuddy.py:45,688,912
harness2/substrate/__init__.py:22,32,33
```

因此**删 codex.py 必须连同这三个基准一起处理**，否则 import 立刻失败。

## 二、需要保留但要去 Agent 化的：OpenCode 适配器

`harness2/substrate/opencode.py`（395 行）有两个身份，必须分开看：

| 内容 | 用途 | 结论 |
|---|---|---|
| `OpencodeSubstrate` 类 | 启动 opencode 进程干活 | **这是旧 Agent，应删** |
| `OPENCODE_SURFACE` 常量 | 一份纯数据：哪些文件 always_on、上限多少、技能目录叫什么 | **数据本身要留，只是改名** |

rsi/ 只用后者，共 4 处：

```
rsi/cli.py:30
rsi/desktop.py:1712
rsi/stress.py:37
rsi/taskset.py:52
```

测试里另有 **14 个文件**引用 `OPENCODE_SURFACE`。

`OPENCODE_SURFACE` 的类型是 `SurfaceSpec`（`harness2/core/tree.py:41`），它描述「一个 harness 的可编辑表面」，与哪个 Agent 执行无关。

## 三、要做的事，分三步

### 第一步：把表面数据从旧 Agent 里拆出来（不改行为）

新建 `harness2/core/surfaces.py`，把 `OPENCODE_SURFACE` 的值搬过去，改名为 `REDSPARK_SURFACE`，
字段逐个对齐 RSH 的真实布局（`rsh/Docs/architecture.md` 的预设与技能目录）。

同时保留一个 `OPENCODE_SURFACE = REDSPARK_SURFACE` 的别名，让 14 个测试文件与 rsi 的 4 处引用
**先不用改**。这一步跑完测试必须全绿，证明只是搬家。

### 第二步：删 Codex 适配器与它的三个基准

| 删除项 | 行数 | 前置条件 |
|---|---|---|
| `harness2/substrate/codex.py` | 480 | 先确认没有测试依赖 `CODEX_SURFACE` |
| `harness2/benchmarks/lab.py` | 1005 | 只用 Codex 与 OpenCode 两个旧 Agent |
| `harness2/benchmarks/workbuddy.py` | 1029 | 同上 |
| `harness2/benchmarks/jobbench.py` | 1175 | 同上 |
| `harness2/benchmarks/jb_opencode_runner.py` | 281 | jobbench 的进程外壳 |
| `harness2/benchmarks/wb_render.py` | 577 | workbuddy 的渲染 |
| `harness2/benchmarks/tasks.py` | 88 | 基准任务集 |

连带要改：`harness2/cli/_common.py:56,62,65` 里对这三个适配器的选择、`harness2/substrate/__init__.py` 的导出。

**风险**：`harness2/benchmarks/` 共 4170 行，是上游的评测基准。删掉之后 RSI 就只剩
`rsi/taskset.py` 那套 40 任务的自带评测。这是产品决策，不是技术判断，需要官家点头。

### 第三步：把 rsi 里的引用改成新名字

第二步完成后，`OPENCODE_SURFACE` 的反向别名可以撤掉：

```
rsi/cli.py              30
rsi/desktop.py          1712
rsi/stress.py           37
rsi/taskset.py          52
tests/*.py              14 个文件
```

全改成 `REDSPARK_SURFACE`，然后删掉别名。

## 四、建议的取舍

**先做第一步，第二、三步等官家定。**

理由：

1. 第一步是纯搬家，行为不变，测试能立刻证明没坏；
2. 第二步删掉 4170 行上游基准，等于放弃与上游 benchmark 的可比性，这个代价值得单独确认；
3. 第三步是改名，机械操作，等前两步定了再做最省事。

## 五、一处容易误判：`rsi/backend.py` 的 `CodexBackend`

名字里带 Codex，但它**不是旧 Agent 适配器**，不要删。

实测（`rsi/backend.py:763-782`）：它实际执行的是 `rsi.engine.AgentRunner`，
只是沿用 codex 的对话语义（step 顺序、线程复用、prompt 组装顺序）作为行为参照。
它不启动任何外部 codex-cli 进程。

真正对接 codex-cli 的是 `harness2/substrate/codex.py` 的 `CodexSubstrate`（480 行），
两者不是同一个东西。

## 六、明确不删的

| 内容 | 理由 |
|---|---|
| `harness2/core/`（15 文件） | rsi 的基石：树、递归、选择、库，全部依赖它 |
| `harness2/substrate/base.py`（83 行） | 适配器的接口定义，新 Agent 适配器要按它写 |
| `rsi/`（29 文件） | 引擎本体 |
| `NOTICE` / 许可证头 | 上游版权，法律义务 |

## 七、RSH 侧需要补的

清理完不等于能用：RSH 要能被这层适配器启动，还需要一个 `RedsparkSubstrate`——
按 `harness2/substrate/base.py` 的接口，把「启动 RSH、给它一份编辑后的 harness 树、跑一轮、取回结果」
实现出来。这一层目前**不存在**，也不在本清单范围内，需要单独立项。
