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

"""The adoption gate: what a harness must survive before it can become live.

A harness that fails to load, fails to run, or runs worse than the one it replaces should
never move the `stable` pointer. Harness2 validates a proposed tree (`core.tree.validate`)
but it does that inside the *search*, as feedback to a proposer -- nothing stops a harness
that validates from reaching production there, because there is no production there.

Four levels, cheapest first, and the first failure stops the run:

    L1  static    paths, always-on cap, skill shape, script references, py_compile
    L2  smoke     run the candidate on a golden task; it must exit 0 and produce output
    L3  parity    the candidate's answer must be no worse than the live harness's answer
    L4  budget    the diff must stay inside configured limits

**What this is not.** L2 runs the candidate's script in a subprocess with a timeout. That
stops a hang or a crash; it does not stop malicious code, and it is not a sandbox. Nothing
here defends against a harness written to exfiltrate or destroy -- that needs real
isolation (a container or a VM), which is out of scope. Say so in the write-up rather than
implying sandboxing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

from harness2.core import tree as harness_tree
from harness2.core.tree import SurfaceSpec, Tree

from .golden import GoldenResult, GoldenTask, default_tasks

LEVELS = ("L1", "L2", "L3", "L4")


@dataclass(frozen=True)
class Limits:
    """L4 thresholds. Defaults are deliberately tight: a small harness should change a
    little, and a proposal that rewrites half the tree is more likely to be a rewrite of
    something it does not understand than an improvement."""

    max_changed_files: int = 6
    max_always_on_delta: int = 4000
    max_added_skills: int = 3
    max_removed_files: int = 2
    max_scripts_added: int = 3

    def to_dict(self) -> dict:
        return {
            "max_changed_files": self.max_changed_files,
            "max_always_on_delta": self.max_always_on_delta,
            "max_added_skills": self.max_added_skills,
            "max_removed_files": self.max_removed_files,
            "max_scripts_added": self.max_scripts_added,
        }


@dataclass
class GateResult:
    """The verdict, the level that produced it, and the evidence behind it."""

    ok: bool
    level: str = ""
    reason: str = ""
    delta: dict = field(default_factory=dict)
    census: dict = field(default_factory=dict)
    golden: dict[str, str] = field(default_factory=dict)
    baseline: dict[str, str] = field(default_factory=dict)

    @property
    def rejected_by(self) -> str:
        return "" if self.ok else self.level

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "level": self.level,
            "reason": self.reason,
            "delta": self.delta,
            "census": self.census,
            "golden": self.golden,
            "baseline": self.baseline,
        }

    def explain(self) -> str:
        if self.ok:
            changed = (
                len(self.delta.get("added", []))
                + len(self.delta.get("removed", []))
                + len(self.delta.get("modified", []))
            )
            return f"accepted: {changed} file(s) changed, golden tasks passed"
        return f"rejected at {self.level}: {self.reason}"


def _reject(level: str, reason: str, **kw) -> GateResult:
    return GateResult(ok=False, level=level, reason=reason, **kw)


def check_static(surface: SurfaceSpec, candidate: Tree, *, allow_subagents: bool) -> GateResult:
    """L1: the upstream validator, plus a syntax check of every script it would run."""
    if not candidate:
        return _reject("L1", "the candidate tree is empty")
    try:
        census = harness_tree.validate(surface, candidate, allow_subagents=allow_subagents)
    except ValueError as exc:
        return _reject("L1", str(exc)[:900])
    for rel, body in candidate.items():
        if rel.endswith(".py"):
            try:
                compile(str(body), rel, "exec")
            except (SyntaxError, ValueError) as exc:
                msg = getattr(exc, "msg", str(exc))
                line = getattr(exc, "lineno", "?")
                return _reject("L1", f"{rel} does not compile: {msg} (line {line})")
    return GateResult(ok=True, level="L1", census=census)


def check_budget(surface: SurfaceSpec, live: Tree, candidate: Tree, limits: Limits) -> GateResult:
    """L4: how much did it change? Run before the expensive levels so a rewrite is cheap
    to refuse."""
    delta = harness_tree.diff_summary(surface, live, candidate)
    changed = len(delta["added"]) + len(delta["removed"]) + len(delta["modified"])
    problems: list[str] = []

    if changed > limits.max_changed_files:
        problems.append(
            f"{changed} files changed, over the {limits.max_changed_files} limit "
            f"(changed: {', '.join((delta['added'] + delta['removed'] + delta['modified'])[:8])})"
        )
    if abs(delta["always_on_char_delta"]) > limits.max_always_on_delta:
        problems.append(
            f"always-on text moved {delta['always_on_char_delta']:+d} chars, over the "
            f"{limits.max_always_on_delta} limit"
        )
    if len(delta["removed"]) > limits.max_removed_files:
        problems.append(
            f"{len(delta['removed'])} files removed, over the {limits.max_removed_files} "
            f"limit ({', '.join(delta['removed'][:6])})"
        )

    def skills(tree: Tree) -> set[str]:
        return set(harness_tree.skill_names(surface, tree))

    added_skills = skills(candidate) - skills(live)
    if len(added_skills) > limits.max_added_skills:
        problems.append(
            f"{len(added_skills)} skills added, over the {limits.max_added_skills} limit"
        )
    added_scripts = [
        rel
        for rel in delta["added"]
        if rel.startswith("scripts/") and rel.endswith(".py")
    ]
    if len(added_scripts) > limits.max_scripts_added:
        problems.append(
            f"{len(added_scripts)} scripts added, over the {limits.max_scripts_added} limit"
        )

    if problems:
        return _reject("L4", " | ".join(problems), delta=delta)
    return GateResult(ok=True, level="L4", delta=delta)


def check_smoke(
    surface: SurfaceSpec, candidate: Tree, tasks: Sequence[GoldenTask]
) -> GateResult:
    """L2: every golden task must run to completion with output."""
    ran: dict[str, str] = {}
    for task in tasks:
        result = task.run(surface, candidate)
        ran[task.task_id] = result.summary
        if not result.ok:
            return _reject(
                "L2",
                f"golden task {task.task_id} failed: {result.summary}",
                golden=ran,
            )
        if not result.stdout.strip():
            return _reject(
                "L2",
                f"golden task {task.task_id} produced no output",
                golden=ran,
            )
    return GateResult(ok=True, level="L2", golden=ran)


def check_parity(
    surface: SurfaceSpec,
    live: Tree,
    candidate: Tree,
    tasks: Sequence[GoldenTask],
) -> GateResult:
    """L3: the candidate must not be worse than the live harness on the golden tasks.

    Two kinds of failure are distinguished, and conflating them is how this level would
    quietly wave bad candidates through:

    * **Regression** -- the live harness answers a task correctly and the candidate does
      not. This is the obvious case.
    * **Neither answers** -- if the live harness is itself wrong on a task, "no worse than
      live" must not be read as "anything goes". A candidate that also fails that task is
      required to fail *no worse*: it must still run and print a total-shaped answer. A
      candidate that prints garbage is refused, which is what stops a real regression from
      hiding behind a baseline that was already broken.

    A task neither harness answers *correctly* is therefore not a pass by default; only a
    candidate that at least produces parseable output for it is.
    """
    evidence_golden: dict[str, str] = {}
    evidence_live: dict[str, str] = {}
    regressions: list[str] = []

    for task in tasks:
        live_result = task.run(surface, live)
        cand_result = task.run(surface, candidate)
        live_ok = task.matches(live_result)
        cand_ok = task.matches(cand_result)
        evidence_live[task.task_id] = f"{'ok' if live_ok else 'fail'}: {live_result.summary}"
        evidence_golden[task.task_id] = f"{'ok' if cand_ok else 'fail'}: {cand_result.summary}"

        if live_ok and not cand_ok:
            regressions.append(
                f"{task.task_id}: live produced {task.expected!r}, candidate produced "
                f"{cand_result.summary!r} (regression)"
            )
        elif not live_ok and not cand_ok and not task.looks_like_answer(cand_result):
            regressions.append(
                f"{task.task_id}: live is already wrong ({live_result.summary!r}) and the "
                f"candidate does not even produce a total-shaped answer "
                f"({cand_result.summary!r}); refusing rather than accepting a change that "
                f"only adds noise"
            )

    if regressions:
        return _reject("L3", " | ".join(regressions), golden=evidence_golden, baseline=evidence_live)
    return GateResult(ok=True, level="L3", golden=evidence_golden, baseline=evidence_live)


def gate(
    surface: SurfaceSpec,
    live: Tree,
    candidate: Tree,
    *,
    tasks: Sequence[GoldenTask] | None = None,
    limits: Limits | None = None,
    allow_subagents: bool = True,
    levels: Sequence[str] = LEVELS,
) -> GateResult:
    """Run the configured levels in order and stop at the first rejection.

    `levels` exists so a caller can run a subset: the roadmap says L3 may be dropped if time
    is short, and L2/L3 are the only levels that execute anything.
    """
    tasks = list(tasks if tasks is not None else default_tasks())
    limits = limits or Limits()
    level_set = set(levels)
    for name in level_set:
        if name not in LEVELS:
            raise ValueError(f"unknown level {name!r}; expected a subset of {LEVELS}")

    result = check_static(surface, candidate, allow_subagents=allow_subagents)
    if not result.ok:
        return result
    census = result.census

    if "L4" in level_set:
        budget = check_budget(surface, live, candidate, limits)
        if not budget.ok:
            budget.census = census
            return budget
        delta = budget.delta
    else:
        delta = harness_tree.diff_summary(surface, live, candidate)

    if "L2" in level_set:
        smoke = check_smoke(surface, candidate, tasks)
        if not smoke.ok:
            smoke.census, smoke.delta = census, delta
            return smoke

    if "L3" in level_set:
        parity = check_parity(surface, live, candidate, tasks)
        if not parity.ok:
            parity.census, parity.delta = census, delta
            return parity
        return GateResult(
            ok=True,
            level="L3",
            delta=delta,
            census=census,
            golden=parity.golden,
            baseline=parity.baseline,
        )

    return GateResult(
        ok=True,
        level="L4" if "L4" in level_set else "L1",
        delta=delta,
        census=census,
    )


def gate_and_promote(
    store,
    candidate: Tree,
    *,
    tasks: Sequence[GoldenTask] | None = None,
    limits: Limits | None = None,
    levels: Sequence[str] = LEVELS,
    ref: str = "stable",
    kind: str = "auto",
    note: str = "",
):
    """Gate a candidate against the live generation, and commit it only if it passes.

    Returns `(verdict, generation_or_None)`. A rejection writes nothing: the lineage only
    ever grows on acceptance, so "the store is the history of accepted harnesses" stays
    true.
    """
    live = store.current(ref)
    live_tree = store.tree_of(live.id)
    verdict = gate(
        store.surface,
        live_tree,
        candidate,
        tasks=tasks,
        limits=limits,
        levels=levels,
    )
    if not verdict.ok:
        return verdict, None
    gen = store.commit(
        live.id,
        candidate,
        kind=kind,
        note=note or verdict.explain(),
        ref=ref,
        evidence={"gate.json": _json(verdict.to_dict())},
    )
    return verdict, gen


def _json(obj) -> str:
    import json

    return json.dumps(obj, indent=2, ensure_ascii=False)


__all__ = [
    "GateResult",
    "Limits",
    "LEVELS",
    "check_budget",
    "check_parity",
    "check_smoke",
    "check_static",
    "gate",
    "gate_and_promote",
]
