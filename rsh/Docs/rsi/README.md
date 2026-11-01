---
description: "RSI Harness 并入本仓库后的文档入口：这批文档从哪来、与代码怎么对应、以及哪些还成立。"
kind: "guide"
---

# RSI Harness 文档

本目录是原 **RSI Harness** 仓库（`github.com/Little-Red-Cre-Org/RSI-Harness`）的文档，
已并入本仓库。代码在同一检出里：`harness2/`（底座）与 `rsi/`（引擎，含 `rsi/tests/`）。

## 合并意味着什么

两个仓库原本各自维护一份 `harness2/` 与 `rsi/`。实测它们是同一套代码：

| 内容 | 原 RSI 仓库 | 本仓库 | 差异 |
|---|---|---|---|
| `harness2/` | 40 个 py | 40 个 py | 逐字节相同，仅换行符（CRLF → LF） |
| `rsi/` 引擎 | 29 个 py | 29 个 py | 仅 `golden.py` → `smoke.py` 一处改名 |
| 测试 | 35 个 py | `rsi/tests/` 35 个 | 同上 |

所以合并不是搬代码，而是确认单一来源：**本仓库是唯一主库**，原仓库归档。

## 文档清单

| 文件 | 讲什么 | 现状 |
|---|---|---|
| `RSI-ARCHITECTURE.md` | 引擎的分层与数据流 | 成立 |
| `ARCHITECTURE.md` | 底座 Harness² 的架构 | 成立 |
| `RSI-DESIGN.md` | 设计取舍与理由 | 成立 |
| `RSI-ROADMAP.md` | 路线图 | 需按合并后的状态重看 |
| `SETUP.md` | 环境与安装 | 见下方「怎么跑」 |
| `RSI-WINDOWS.md` | Windows 上的实测 | 成立 |
| `RSI-PROVIDERS-API.md` | 提供方接口 | 成立 |
| `RSI-ACP-BRIDGE.md` | ACP 桥 | 成立 |
| `RSI-ACP-EVENT-MATRIX.md` | ACP 事件矩阵 | 成立 |
| `BENCHMARKS.md` | 基准说明 | 成立；`cx` 与 `oc` 是并列对照组 |
| `EXPERIMENTS.md` | 实验记录 | 成立 |
| `RSI-OPENBITFUN-VERDICT.md` | 对另一项目的核查结论 | 成立 |
| `RSI-LEGACY-AGENT-CLEANUP.md` | 旧 Agent 清理方案 | **方案，未执行** |
| `NOTICE` | Google 对底座的版权声明 | 必须保留 |
| `pyproject.toml` | 原仓库的 Python 包定义 | 参考；比对本仓库实际用法 |
| `shots/` | 文档配图 | — |

## 怎么跑

引擎不装也能跑：它从仓库根按模块路径解析。

```bash
python -m pytest rsi/tests/ -q
```

实测 `rsi/tests/` 共 35 个文件，**624 passed / 12 failed / 3 skipped**（2026-11-01）。

12 条失败集中在两处，都是**子进程找不到 `rsi` 模块**，不是逻辑错误：

- `test_acp_stdio.py` 有 6 条，它启动真实子进程跑 ACP 往返；
- `test_layers.py` 与 `test_desktop_reasoning.py` 共 6 条，同样经由子进程 import。

修法是让子进程能解析到仓库根（例如导出 `PYTHONPATH=<repo root>`），尚未做。

## 与本仓库其他部分的关系

- 本目录只放**文档**；代码在 `harness2/` 与 `rsi/`。
- 本仓库的 `pytest.ini` 目前只收集 `python/sdk/tests`，**不包含 `rsi/tests`**，CI 也不跑它。
  要让这 624 条测试成为真正的门禁，需要把 `rsi/tests` 加入 `testpaths` 并接进 CI。
