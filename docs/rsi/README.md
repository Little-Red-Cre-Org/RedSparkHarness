---
description: "Where the RSI Harness documentation lives after the merge, which code it describes, and what still holds."
kind: "guide"
---

# RSI Harness documentation

English | [中文](README.zh.md)

This directory holds the documentation of the former **RSI Harness** repository (`github.com/Little-Red-Cre-Org/RSI-Harness`), now merged into this repository. The code sits in the same checkout: `harness2/` (the substrate) and `rsi/` (the engine, including `rsi/tests/`).

## What the merge means

Both repositories maintained their own copy of `harness2/` and `rsi/`. Measured, they are the same code:

| Content | Former RSI repository | This repository | Difference |
|---|---|---|---|
| `harness2/` | 40 py files | 40 py files | Byte-identical except line endings (CRLF → LF) |
| `rsi/` engine | 29 py files | 29 py files | One rename, `golden.py` → `smoke.py` |
| Tests | 35 py files | 35 under `rsi/tests/` | Same |

So the merge moved no code; it confirmed a single source of truth: **this repository is the only home**, and the former repository is archived.

## Document index

| File | Subject | Status |
|---|---|---|
| `RSI-ARCHITECTURE.md` | Engine layering and data flow | Holds |
| `ARCHITECTURE.md` | The Harness² substrate architecture | Holds |
| `RSI-DESIGN.md` | Design trade-offs and their reasons | Holds |
| `RSI-ROADMAP.md` | Roadmap | Needs review against the merged state |
| `SETUP.md` | Environment and installation | See "Running it" below |
| `RSI-WINDOWS.md` | Measurements on Windows | Holds |
| `RSI-PROVIDERS-API.md` | The provider interface | Holds |
| `RSI-ACP-BRIDGE.md` | The ACP bridge | Holds |
| `RSI-ACP-EVENT-MATRIX.md` | ACP event matrix | Holds |
| `BENCHMARKS.md` | Benchmark notes | Holds; `cx` and `oc` are parallel control arms |
| `EXPERIMENTS.md` | Experiment log | Holds |
| `RSI-OPENBITFUN-VERDICT.md` | Review verdict on another project | Holds |
| `RSI-LEGACY-AGENT-CLEANUP.md` | Legacy-Agent cleanup proposal | **Proposal, not executed** |
| `NOTICE` | Google's copyright notice for the substrate | Must be retained |
| `pyproject.toml` | The former repository's Python package definition | Reference; compare against actual usage here |
| `shots/` | Figures used by these documents | — |

## Running it

The engine runs without installation: it resolves by module path from the repository root.

```bash
python -m pytest rsi/tests/ -q
```

Measured on `rsi/tests/`, 35 files: **624 passed / 12 failed / 3 skipped** (2026-11-01).

The 12 failures are all **subprocesses that cannot import the `rsi` module**, not logic errors, in two places:

- `test_acp_stdio.py` contributes 6, because it starts a real subprocess for the ACP round trip;
- `test_layers.py` and `test_desktop_reasoning.py` contribute 6 together, also importing through a subprocess.

The fix is to let the subprocess resolve the repository root (export `PYTHONPATH=<repo root>`, for example); it has not been done.

## Relation to the rest of this repository

- This directory holds **documentation only**; the code is in `harness2/` and `rsi/`.
- This repository's `pytest.ini` collects only `python/sdk/tests` today and **does not include `rsi/tests`**, and CI does not run them. Making those 624 tests an actual gate means adding `rsi/tests` to `testpaths` and wiring it into CI.
