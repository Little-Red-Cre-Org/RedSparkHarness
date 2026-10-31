# Copyright 2026 Little-Red-Cre-Org
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""A task set with checkable answers, and the adapter the method layer expects.

Two things live here and they are deliberately separate:

* Task and TASKS -- pure data plus one expect() function per task. Every expected
  value is COMPUTED from the task's inputs by code in this file, never typed by
  hand, so a task cannot drift away from its answer.
* TaskSetAdapter -- the BenchmarkAdapter implementation exposing the set to
  harness2.core. The protocol decides the shape; nothing here invents a second one.

Why this exists: the gate had two smoke tasks, enough to answer "does this
candidate still work" and nowhere near enough to answer "is this candidate
better". A benchmark needs tasks whose answers are unambiguous, whose domains
differ, and which re-run cheaply and identically.

The answer contract is one line of stdout, ANSWER: <value>. It is strict on
purpose: the grader must never guess which number in a wall of prose was meant,
and a harness edit that changes the FORMAT is as observable as one that changes
the VALUE.

Tasks are scored by comparing that line, never by an LLM judge: a flaky judge
makes every downstream number unfalsifiable.
"""

from __future__ import annotations

import json
import math
import random
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping

from harness2.core import tree as harness_tree
from harness2.core.spec import BenchPrompts, BenchSpec, ChannelSpec
from harness2.core.tree import SurfaceSpec, Tree
from harness2.substrate.opencode import OPENCODE_SURFACE

ANSWER_PREFIX = "ANSWER:"

#: Files the runner writes that are the agent's product, not its scratch space.
RESULT_FILE = "answer.txt"
TRANSCRIPT_FILE = "trajectory.md"


@dataclass(frozen=True)
class Task:
    """One task: a prompt, some input files, and a computed expected answer."""

    id: str
    domain: str
    prompt: str
    files: Mapping[str, str]
    expect: Callable[[Mapping[str, str]], str]
    note: str = ""

    def expected(self) -> str:
        return format_answer(self.expect(self.files))


def format_answer(value) -> str:
    """The single canonical spelling of an answer.

    Comparing strings means the agent must produce this exact form; comparing
    floats would forgive a format drift that a harness edit is supposed to cause.
    """
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            raise ValueError("answer is not finite: " + repr(value))
        return f"{value:.2f}"
    return str(value)


# -- task definitions ------------------------------------------------------
#
# Eight domains, five tasks each. The domains differ in the KIND of work
# (arithmetic, parsing, text, structure, dates, dedupe, statistics, logic) so a
# harness edit that helps one is not automatically credited in all of them.


def _csv_sum(files: Mapping[str, str]) -> str:
    rows = [r for r in files["amounts.csv"].splitlines()[1:] if r.strip()]
    total = sum((float(r) for r in rows), 0.0)
    return format_answer(round(total, 2))


def _json_path(files: Mapping[str, str]) -> str:
    node = json.loads(files["records.json"])
    for key in files["path.txt"].strip().split("."):
        node = node[int(key)] if key.isdigit() else node[key]
    return format_answer(node)


def _word_count(files: Mapping[str, str]) -> str:
    counts: dict[str, int] = {}
    for word in files["text.txt"].lower().split():
        cleaned = "".join(c for c in word if c.isalnum())
        if cleaned:
            counts[cleaned] = counts.get(cleaned, 0) + 1
    best = max(counts.items(), key=lambda kv: (kv[1], kv[0]))
    return format_answer(best[0])


def _table_order(files: Mapping[str, str]) -> str:
    lines = [row for row in files["sales.csv"].splitlines() if row.strip()]
    header, rows = lines[0].split(","), lines[1:]
    idx = header.index("amount")
    best = max(rows, key=lambda r: float(r.split(",")[idx]))
    return format_answer(best.split(",")[0])


def _date_gap(files: Mapping[str, str]) -> str:
    from datetime import date

    a, b = files["dates.txt"].split()
    return format_answer(abs((date.fromisoformat(b) - date.fromisoformat(a)).days))


def _dedupe(files: Mapping[str, str]) -> str:
    seen, out = set(), []
    for line in files["ids.txt"].splitlines():
        key = line.strip()
        if key and key not in seen:
            seen.add(key)
            out.append(key)
    return format_answer(len(out))


def _median(files: Mapping[str, str]) -> str:
    values = [float(x) for x in files["samples.txt"].split() if x.strip()]
    return format_answer(round(statistics.median(values), 2))


def _logic(files: Mapping[str, str]) -> str:
    """Tiny expression evaluator: + - * with precedence, integers only."""
    expr = files["expr.txt"].strip()
    if not set(expr) <= set("0123456789+-* ()"):
        raise ValueError("unexpected characters in fixture: " + expr)
    return format_answer(int(eval(expr, {"__builtins__": {}}, {})))


def _csv_task(seed: int) -> Task:
    rng = random.Random(seed)
    rows = [round(rng.uniform(-500, 900), 2) for _ in range(rng.randint(5, 9))]
    body = "amount\n" + "\n".join(f"{v:.2f}" for v in rows) + "\n"
    return Task(
        id=f"csv-sum-{seed}",
        domain="arithmetic",
        prompt="Sum every signed amount in amounts.csv and print ANSWER: <total> "
               "with exactly two decimal places.",
        files={"amounts.csv": body},
        expect=_csv_sum,
        note="money rounding plus sign handling",
    )


def _json_task(seed: int) -> Task:
    rng = random.Random(seed)
    records = {
        "meta": {"version": rng.randint(1, 9)},
        "rows": [{"id": f"r{i}", "value": rng.randint(10, 99)} for i in range(3)],
    }
    pick = rng.randint(0, 2)
    return Task(
        id=f"json-extract-{seed}",
        domain="parsing",
        prompt="Read records.json, follow the dotted path in path.txt, and print "
               "ANSWER: <value>. The path looks like rows.<n>.value or meta.<key>.",
        files={"records.json": json.dumps(records, indent=2) + "\n",
               "path.txt": f"rows.{pick}.value\n"},
        expect=_json_path,
        note="nested lookup with numeric and string keys",
    )


def _text_task(seed: int) -> Task:
    rng = random.Random(seed)
    vocab = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]
    words = [rng.choice(vocab) for _ in range(rng.randint(12, 20))]
    counts = {w: words.count(w) for w in set(words)}
    winner = max(counts.items(), key=lambda kv: (kv[1], kv[0]))[0]
    others = [w for w in counts if w != winner]
    # Force a strict winner: ties would make the answer ill-defined.
    target = max(counts.values()) + 1
    while words.count(winner) < target:
        words.append(winner)
    for w in others:
        words = [x for x in words if not (x == w and words.count(w) >= target)]
    body = " ".join(words) + "\n"
    return Task(
        id=f"text-count-{seed}",
        domain="text",
        prompt="Find the most frequent word in text.txt, ignoring case and "
               "punctuation, and print ANSWER: <word> in lower case.",
        files={"text.txt": body},
        expect=_word_count,
        note="normalisation and deterministic tie-breaking",
    )


def _table_task(seed: int) -> Task:
    rng = random.Random(seed)
    rows = [(f"S{seed}{i}", round(rng.uniform(10, 999), 2)) for i in range(4)]
    body = "region,amount\n" + "".join(f"{r[0]},{r[1]:.2f}\n" for r in rows)
    return Task(
        id=f"table-max-{seed}",
        domain="structure",
        prompt="Find the region with the largest amount in sales.csv and print "
               "ANSWER: <region>.",
        files={"sales.csv": body},
        expect=_table_order,
        note="header-driven column lookup",
    )


def _date_task(seed: int) -> Task:
    from datetime import date, timedelta

    # Randomised gaps, not a constant offset: a fixed +17 would make the answers
    # march 417, 418, 419 ... and a model could ride the pattern instead of
    # computing. A defensible benchmark does not invite that.
    rng = random.Random(seed * 7 + 3)
    base = date(2024, 1, 1) + timedelta(days=rng.randint(0, 700))
    other = base + timedelta(days=rng.randint(20, 900))
    if rng.random() < 0.5:
        base, other = other, base
    return Task(
        id=f"date-gap-{seed}",
        domain="dates",
        prompt="dates.txt holds two ISO dates separated by a space. Print the "
               "number of days between them as ANSWER: <days>.",
        files={"dates.txt": f"{base.isoformat()} {other.isoformat()}\n"},
        expect=_date_gap,
        note="absolute gap across months and years, order irrelevant",
    )


def _dedupe_task(seed: int) -> Task:
    rng = random.Random(seed)
    pool = [f"u{rng.randint(100, 999)}" for _ in range(6)]
    lines = [rng.choice(pool) for _ in range(rng.randint(9, 14))]
    return Task(
        id=f"dedupe-{seed}",
        domain="sets",
        prompt="ids.txt has one id per line with duplicates. Print how many "
               "distinct ids it holds as ANSWER: <count>.",
        files={"ids.txt": "\n".join(lines) + "\n"},
        expect=_dedupe,
        note="set semantics, order irrelevant",
    )


def _median_task(seed: int) -> Task:
    rng = random.Random(seed)
    n = 2 * rng.randint(3, 5)
    values = [round(rng.uniform(0, 100), 2) for _ in range(n)]
    body = "\n".join(f"{v:.2f}" for v in values) + "\n"
    return Task(
        id=f"median-{seed}",
        domain="statistics",
        prompt="samples.txt holds one number per line. Print their median with "
               "two decimal places as ANSWER: <median>.",
        files={"samples.txt": body},
        expect=_median,
        note="even-length median averages the middle pair",
    )


def _logic_task(seed: int) -> Task:
    rng = random.Random(seed)
    a, b, c = rng.randint(2, 9), rng.randint(2, 9), rng.randint(2, 9)
    return Task(
        id=f"precedence-{seed}",
        domain="logic",
        prompt="Evaluate the integer expression in expr.txt, honouring operator "
               "precedence, and print ANSWER: <value>.",
        files={"expr.txt": f"{a} + {b} * {c} - {a}\n"},
        expect=_logic,
        note="multiplication before addition",
    )


_BUILDERS: tuple[tuple[str, Callable[[int], Task]], ...] = (
    ("arithmetic", _csv_task),
    ("parsing", _json_task),
    ("text", _text_task),
    ("structure", _table_task),
    ("dates", _date_task),
    ("sets", _dedupe_task),
    ("statistics", _median_task),
    ("logic", _logic_task),
)


def build_tasks(per_domain: int = 5, seed: int = 0) -> list[Task]:
    """The task set: deterministic, reproducible from (per_domain, seed)."""
    out: list[Task] = []
    for i, (_, builder) in enumerate(_BUILDERS):
        for k in range(per_domain):
            out.append(builder(seed * 1000 + i * 100 + k))
    return out


#: Regenerating is a pure function of these constants, so a published number can
#: always be reproduced by checking them into the paper.
TASKS: list[Task] = build_tasks()
TASKS_BY_ID: dict[str, Task] = {t.id: t for t in TASKS}


def check_answer(task: Task, delivered: str) -> bool:
    """Does the delivered text carry exactly the expected answer line?"""
    want = ANSWER_PREFIX + " " + task.expected()
    return any(line.strip() == want for line in delivered.splitlines())


def grade(task: Task, delivered: str) -> dict:
    """Score one delivery, separating a wrong value from a wrong format.

    Measured, not assumed: driving the base harness with a real model produced the
    right number four times out of four and the wrong format every time -- the model
    read the ANSWER: instruction and still finished with the bare value. Collapsing
    both failures into one boolean would hide which one a harness edit fixed.

    value_ok : the expected value appears anywhere in the delivery
    passed   : the full ANSWER: <value> line appears; this is what a run scores
    """
    want = ANSWER_PREFIX + " " + task.expected()
    lines = [line.strip() for line in delivered.splitlines()]
    passed = any(line == want for line in lines)
    value_ok = any(task.expected() in line for line in lines)
    if passed:
        shape = "ok"
    elif value_ok:
        shape = "value_only"
    else:
        shape = "wrong"
    return {"passed": passed, "value_ok": value_ok, "shape": shape}


class TaskSetAdapter:
    """The BenchmarkAdapter implementation for this task set."""

    def __init__(self, root: Path | str, tasks: list[Task] | None = None) -> None:
        self.root = Path(root)
        self.tasks_list = tasks if tasks is not None else TASKS
        self.by_id = {t.id: t for t in self.tasks_list}
        self.substrate = _OpenCodeSubstrateShim()
        # One channel for both roles: this set is run by the local agent loop, and a
        # second channel would imply a second way of reaching a model.
        channel = ChannelSpec("opencode", "local/taskset")
        self.spec = BenchSpec(
            name="taskset",
            runs_root=self.root / "runs",
            install_mode="workspace_agents_md",
            prompts=BenchPrompts(
                work="a small, checkable data task",
                domain_word="domain",
                yardstick="an exact expected answer line",
            ),
            channels={"proposer": channel, "selector": channel},
        )
        self._prepare()

    def _prepare(self) -> None:
        for task in self.tasks_list:
            src = self.task_files(task.id)
            src.mkdir(parents=True, exist_ok=True)
            for name, body in task.files.items():
                p = src / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(body, encoding="utf-8", newline="\n")

    # -- protocol ------------------------------------------------------

    def tasks(self, split: str = "all") -> list[str]:
        if split in ("all", "", None):
            return [t.id for t in self.tasks_list]
        return [t.id for t in self.tasks_list if t.domain == split]

    def domain_of(self, task_id: str) -> str:
        return self.by_id[task_id].domain

    def task_prompt(self, task_id: str) -> str:
        return self.by_id[task_id].prompt

    def task_files(self, task_id: str) -> Path:
        return self.root / "sources" / task_id

    def base_harness(self) -> Path:
        return self.root / "base"

    def validate_tree(self, harness: Tree) -> None:
        if "systemprompt.md" not in harness:
            raise ValueError(
                "The harness needs a systemprompt.md; without it there is no "
                "always-on instruction for the agent to read."
            )
        if not harness["systemprompt.md"].strip():
            raise ValueError("systemprompt.md is empty; the agent gets no instruction.")

    def execute(
        self, task_id: str, harness_dir: Path | None, run_id: str, *, timeout: int | None = None
    ) -> Path:
        """Run the agent on one task.

        This adapter does not embed an agent loop: it drives rsi.agent with the
        harness tree materialised for this run, keeping one agent implementation
        in the repository instead of two that drift apart.
        """
        from .agent import Workspace, harness_system_prompt
        from .runner import make_runner

        run_dir = self.root / "runs" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        out = run_dir / RESULT_FILE
        if out.is_file():
            return run_dir  # idempotent by run_id, as the protocol asks

        work = run_dir / "workspace"
        work.mkdir(parents=True, exist_ok=True)
        for name, body in self.by_id[task_id].files.items():
            p = work / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(body, encoding="utf-8", newline="\n")

        tree = self._harness_tree(harness_dir)
        surface = self.surface()
        prompt = harness_system_prompt(surface, tree)
        # The same engine every other path uses, so a task-set score and a
        # session score are measurements of one actor.
        agent = make_runner(timeout=float(timeout or 120))
        try:
            result = agent.run(self.by_id[task_id].prompt, Workspace(work), tree, surface)
        finally:
            close = getattr(agent, "close", None)
            if close is not None:
                close()
        out.write_text(result.final or "", encoding="utf-8", newline="\n")
        (run_dir / TRANSCRIPT_FILE).write_text(
            result.transcript(), encoding="utf-8", newline="\n"
        )
        (run_dir / "meta.json").write_text(
            json.dumps(
                {
                    "task": task_id,
                    "system_prompt": prompt,
                    "ok": result.ok,
                    "error": result.error,
                    "seconds": round(result.seconds, 2),
                    "steps": len(result.steps),
                    "prompt_tokens": result.prompt_tokens,
                    "completion_tokens": result.completion_tokens,
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        return run_dir

    def _harness_tree(self, harness_dir: Path | None) -> Tree:
        if harness_dir is not None:
            return harness_tree.read_tree(self.surface(), harness_dir)
        base = self.base_harness()
        if not base.is_dir():
            raise FileNotFoundError(
                "no base harness at " + str(base) + "; run seed_base_harness() first"
            )
        return harness_tree.read_tree(self.surface(), base)

    def surface(self) -> SurfaceSpec:
        return OPENCODE_SURFACE

    def delivered(self, run_dir: Path) -> bool:
        p = Path(run_dir) / RESULT_FILE
        return p.is_file() and bool(p.read_text(encoding="utf-8").strip())

    def trajectory(self, run_dir: Path, *, obs_trunc: int) -> str:
        p = Path(run_dir) / TRANSCRIPT_FILE
        if not p.is_file():
            return ""
        text = p.read_text(encoding="utf-8", errors="replace")
        if len(text) > obs_trunc:
            return text[:obs_trunc] + "\n... (" + str(len(text) - obs_trunc) + " chars trimmed)"
        return text

    def deliverable_files(self, run_dir: Path) -> dict[str, str]:
        return {RESULT_FILE: self.deliverable_text(run_dir)}

    def deliverable_text(self, run_dir: Path) -> str:
        p = Path(run_dir) / RESULT_FILE
        return p.read_text(encoding="utf-8", errors="replace") if p.is_file() else ""

    def score(self, run_dir: Path, task_id: str) -> dict | None:
        """Deterministic scoring. There is no model judge, so it cannot drift."""
        task = self.by_id.get(task_id)
        if task is None:
            return None
        delivered = self.deliverable_text(Path(run_dir))
        result = grade(task, delivered)
        return {
            **result,
            "expected": ANSWER_PREFIX + " " + task.expected(),
            "delivered": delivered.strip()[:400],
            "domain": task.domain,
        }


# -- running a set ----------------------------------------------------------


def run_set(
    adapter: "TaskSetAdapter",
    harness_dir: Path | None,
    *,
    task_ids: list[str] | None = None,
    tag: str = "run",
    timeout: int = 120,
    on_result: Callable[[dict], None] | None = None,
) -> dict:
    """Run the adapter over the set and summarise.

    A thin loop on purpose: the adapter already owns execution and scoring, and a
    second scoring path here would be the thing that drifts away from the first.
    """
    ids = task_ids if task_ids is not None else adapter.tasks()
    rows: list[dict] = []
    for tid in ids:
        run_id = f"{tag}-{tid}"
        row: dict = {"task": tid, "domain": adapter.domain_of(tid)}
        try:
            run_dir = adapter.execute(tid, harness_dir, run_id, timeout=timeout)
            verdict = adapter.score(run_dir, tid) or {}
            row.update(verdict)
            meta_path = Path(run_dir) / "meta.json"
            if meta_path.is_file():
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                row["seconds"] = meta.get("seconds", 0.0)
                row["tokens"] = int(meta.get("prompt_tokens", 0)) + int(
                    meta.get("completion_tokens", 0)
                )
        except Exception as exc:
            row.update({"passed": False, "value_ok": False, "shape": "error",
                        "error": f"{type(exc).__name__}: {exc}"})
        rows.append(row)
        if on_result is not None:
            on_result(row)
    return summarise(rows)


def summarise(rows: list[dict]) -> dict:
    by_domain: dict[str, dict] = {}
    for r in rows:
        d = by_domain.setdefault(
            r.get("domain", "?"), {"total": 0, "passed": 0, "value_ok": 0}
        )
        d["total"] += 1
        d["passed"] += 1 if r.get("passed") else 0
        d["value_ok"] += 1 if r.get("value_ok") else 0
    total = len(rows)
    passed = sum(1 for r in rows if r.get("passed"))
    return {
        "total": total,
        "passed": passed,
        "value_ok": sum(1 for r in rows if r.get("value_ok")),
        "pass_rate": round(passed / total, 4) if total else 0.0,
        "tokens": sum(int(r.get("tokens") or 0) for r in rows),
        "seconds": round(sum(float(r.get("seconds") or 0.0) for r in rows), 1),
        "by_domain": by_domain,
        "rows": rows,
    }


def compare(baseline: dict, candidate: dict) -> dict:
    """Per-task delta between two summaries over the same ids.

    Only tasks present in both runs are compared: a candidate scored on a different
    set is not comparable, and pretending otherwise is how a benchmark lies.
    """
    b = {r["task"]: r for r in baseline.get("rows", [])}
    c = {r["task"]: r for r in candidate.get("rows", [])}
    shared = sorted(set(b) & set(c))
    gained = [t for t in shared if c[t].get("passed") and not b[t].get("passed")]
    lost = [t for t in shared if b[t].get("passed") and not c[t].get("passed")]
    return {
        "shared": len(shared),
        "gained": gained,
        "lost": lost,
        "net": len(gained) - len(lost),
        "baseline_pass": sum(1 for t in shared if b[t].get("passed")),
        "candidate_pass": sum(1 for t in shared if c[t].get("passed")),
    }


class _OpenCodeSubstrateShim:
    """The one-method projection of a substrate that core.spec asks for."""

    def surface(self) -> SurfaceSpec:
        return OPENCODE_SURFACE


#: The base harness is deliberately plain, but it must not be a STRAW MAN: a
#: baseline that fails for a silly formatting reason would make every candidate
#: look like an improvement. This version states the contract the way a competent
#: engineer would on the first try -- it says what to produce, not how to beat a
#: grader -- and it is still beatable, which is what the first A/B run showed
#: (bare value on 6/6 tasks).
BASE_SYSTEM_PROMPT = """# ROLE
You are a careful worker completing small data tasks.

# HOW TO ANSWER
Write your working into the workspace and run it to check the numbers, then
finish with one line of the form:

ANSWER: <value>

That single line is the deliverable. State the value exactly as asked for,
with no prose and no units on it.
"""

BASE_GUARDRAILS = """# RULES
- Read the input files before writing anything.
- Prefer a script you can run over arithmetic done in your head.
- Do not invent input you were not given.
"""


def seed_base_harness(dest: Path | str | None = None) -> Path:
    """Write the unmodified harness this task set starts from."""
    target = Path(dest) if dest is not None else Path("taskset_root") / "base"
    tree: Tree = {name: "" for name in OPENCODE_SURFACE.always_on}
    tree["systemprompt.md"] = BASE_SYSTEM_PROMPT
    tree["guardrails.md"] = BASE_GUARDRAILS
    harness_tree.write_tree(OPENCODE_SURFACE, tree, target, stubs=False)
    return target


__all__ = [
    "ANSWER_PREFIX",
    "BASE_GUARDRAILS",
    "BASE_SYSTEM_PROMPT",
    "Task",
    "TaskSetAdapter",
    "TASKS",
    "TASKS_BY_ID",
    "build_tasks",
    "check_answer",
    "compare",
    "format_answer",
    "grade",
    "run_set",
    "summarise",
    "seed_base_harness",
]
