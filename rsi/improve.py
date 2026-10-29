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

"""The agent in the loop: an agent proposes an edit to its own harness.

This is the piece every other module was built for. The store makes a change
reversible, the gate makes it refusable, the task set makes it measurable -- and
this module is what actually asks an agent to make one.

Design constraints, each of which costs something:

* The proposer sees only the TRAIN split. The held-out split is evaluated but
  never shown, so a candidate that memorises task ids scores worse, not better.
* The proposer is told which tasks it failed and what the failures looked like,
  but NOT the expected answers: handing over the answer key would make the
  benchmark measure copying.
* A proposal that changes nothing is refused before it costs anything to test.
* Editing the tree is the only mechanism. There is no second channel where the
  agent could rewrite its own scoring, and the gate runs the task set itself.

    from rsi import improve
    rec = improve.improve(store, adapter, rounds=1)

The honest limit: this loop proposes ONE edit per round from a failure summary.
It is not a search over edit space, and one round of it is not evidence that
self-improvement works -- it is evidence that the machinery can carry a
proposal from observation to verdict, which is the thing that has to be true
first.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from harness2.core import tree as harness_tree
from harness2.core.tree import SurfaceSpec, Tree

from . import taskset as TS
from .agent import Workspace
from .gate import GateResult, gate
from .runner import make_runner
from .store import Store, StoreError

PROPOSER_TASK = """# PROPOSE ONE HARNESS EDIT

You are improving the HARNESS (the instruction files), not the task answers.
The harness is a set of text files that an agent reads before working. Your job
is to change those files so that the agent does better on tasks of this shape.

## WHAT YOU ARE GIVEN

- HARNESS: the current harness files, verbatim.
- FAILURES: tasks the agent got WRONG under this harness, with what it actually
  produced. The expected answer is deliberately withheld.
- PASS RATE: how many of these tasks it currently passes.

## WHAT TO DO

1. Read the failures and find the COMMON PATTERN. One example is an anecdote;
   four failures with the same shape is a cause.
2. Write the smallest edit to the harness that would fix that pattern.
3. Save the edited files into your workspace, keeping the same relative paths.
4. Do not delete files. Do not add more than one new file.

## RULES

- Change as little as possible. A rewrite is not an improvement.
- Do not mention specific task ids, numbers from the failures, or the words
  'task set', 'benchmark' or 'grader': the edit must be a general instruction.
- If the failures have no common cause, say so and make no edit. Refusing is a
  valid and expected outcome.

Finish with one line: PROPOSAL: <one sentence describing what you changed>, or
PROPOSAL: none - <why no general fix exists>.
"""


@dataclass
class Proposal:
    """One round's outcome: what was proposed, and what the gate said."""

    round: int
    tree: Tree = field(default_factory=dict)
    changed: list[str] = field(default_factory=list)
    note: str = ""
    agent_output: str = ""
    gate: GateResult | None = None
    accepted: bool = False
    generation: str = ""
    seconds: float = 0.0

    def to_dict(self) -> dict:
        return {
            "round": self.round,
            "note": self.note,
            "changed": list(self.changed),
            "accepted": self.accepted,
            "generation": self.generation,
            "seconds": round(self.seconds, 2),
            "gate": self.gate.to_dict() if self.gate else None,
            "agent_output": self.agent_output[-2000:],
        }


#: How a failure LOOKED. This is diagnosis, not the answer key: it says what went
#: wrong with the delivery, never what the right value was. Without it, the first
#: real run of this loop produced a legitimate refusal -- six failures described as
#: "mixed shapes with no common cause" -- when all six had the same cause and the
#: proposer simply had no way to see it.
SHAPE_HINT = {
    "value_only": "it gave a value but not in the output form the work calls for",
    "wrong": "the delivered text did not contain the expected result",
    "error": "the run failed before delivering anything",
}


def failure_digest(summary: dict, limit: int = 6) -> str:
    """The failures a proposer may see: what it produced and how it went wrong.

    Task ids are replaced by opaque labels. Handing over the id would let a
    proposer special-case this exact task, which scores well on the train split
    and means nothing anywhere else.
    """
    rows = [r for r in summary.get("rows", []) if not r.get("passed")]
    if not rows:
        return "- none: every task in this split currently passes"
    shapes: dict[str, int] = {}
    for r in rows:
        key = r.get("shape", "?")
        shapes[key] = shapes.get(key, 0) + 1
    lines: list[str] = []
    for i, r in enumerate(rows[:limit]):
        got = (r.get("delivered") or r.get("error") or "(nothing)").strip()
        got = got.replace("\n", " ")[:180]
        hint = SHAPE_HINT.get(r.get("shape", ""), "")
        suffix = " -- " + hint if hint else ""
        lines.append(f"- case {i + 1}: the agent delivered {got!r}" + suffix)
    tally = ", ".join(f"{n} with {k}" for k, n in sorted(shapes.items()))
    lines.append("")
    lines.append(f"Across {len(rows)} failures: {tally}.")
    lines.append("A cause shared by most of them is the one worth editing the harness for.")
    return "\n".join(lines)


def build_proposal_prompt(harness: Tree, summary: dict, surface: SurfaceSpec) -> str:
    files = "\n\n".join(
        f"### {rel}\n{body}" for rel, body in sorted(harness.items()) if body.strip()
    )
    total = summary.get("total", 0)
    passed = summary.get("passed", 0)
    return (
        PROPOSER_TASK
        + "\n\n## PASS RATE\n\n"
        + f"{passed} of {total} tasks pass under the current harness.\n"
        + "\n## FAILURES\n\n"
        + failure_digest(summary)
        + "\n\n## HARNESS\n\n"
        + (files or "(the harness is empty)")
        + "\n\n## YOUR WORKSPACE\n\nWrite the edited harness files into your "
        "workspace, preserving relative paths. The set of paths you leave behind "
        "becomes the candidate harness."
    )


def read_candidate(workspace: Path, surface: SurfaceSpec) -> Tree:
    """The tree the proposer left behind, read back through the surface.

    Uses the same reader a substrate would, so a file the surface does not allow
    cannot sneak in through this path either.
    """
    return harness_tree.read_tree(surface, workspace)


def improve(
    store: Store,
    adapter: TS.TaskSetAdapter,
    *,
    rounds: int = 1,
    train: list[str] | None = None,
    heldout: list[str] | None = None,
    model: str | None = None,
    timeout: int = 150,
    timeout_per_task: int = 120,
    on_event: Callable[[str], None] | None = None,
    work_root: Path | None = None,
) -> list[Proposal]:
    """Run `rounds` propose -> measure -> gate cycles against the live harness.

    `train` is what the proposer is shown; `heldout` is measured but never
    revealed. If either is omitted the split is derived from the adapter so that
    the two never overlap.
    """
    say = on_event or (lambda msg: None)
    all_ids = adapter.tasks()
    train_ids = list(train) if train else _default_train(all_ids)
    held_ids = list(heldout) if heldout is not None else [
        t for t in all_ids if t not in set(train_ids)
    ]
    # Checked before anything else touches the store or the model: an overlap makes
    # every number this run produces unfalsifiable, so it is refused cheapest-first.
    overlap = set(train_ids) & set(held_ids)
    if overlap:
        raise ValueError(
            "train and heldout overlap on " + ", ".join(sorted(overlap)) +
            "; a candidate tuned on a task it is judged on is not evidence"
        )
    if not train_ids or not held_ids:
        raise ValueError(
            "both splits must be non-empty (train=" + str(len(train_ids)) +
            ", heldout=" + str(len(held_ids)) + ")"
        )
    surface = adapter.surface()

    root = Path(work_root) if work_root else Path(store.root).parent / "improve"
    root.mkdir(parents=True, exist_ok=True)
    out: list[Proposal] = []

    for rnd in range(1, rounds + 1):
        started = time.time()
        gen = store.current("stable")
        live = store.tree_of(gen.id)
        say(f"round {rnd}: live harness {gen.id}")

        # 1. measure the live harness on the train split
        say(f"  measuring live on {len(train_ids)} train tasks")
        before = TS.run_set(adapter, store.materialise(gen.id, root / f"live-{rnd}"),
                            task_ids=train_ids, tag=f"r{rnd}-live",
                            timeout=timeout_per_task)
        say(f"  live: {before['passed']}/{before['total']} on train")

        # 2. ask the agent for one edit
        say("  asking the agent for one harness edit")
        ws_dir = root / f"round-{rnd}" / "propose"
        ws_dir.mkdir(parents=True, exist_ok=True)
        harness_tree.write_tree(surface, live, ws_dir, stubs=False)
        prompt = build_proposal_prompt(live, before, surface)
        # The same engine the desktop client uses. A proposal written by a
        # different actor than the one being measured would make the round
        # unfalsifiable.
        agent = make_runner(model=model, timeout=float(timeout))
        try:
            result = agent.run(prompt, Workspace(ws_dir), live, surface)
        finally:
            close = getattr(agent, "close", None)
            if close is not None:
                close()
        proposal = Proposal(round=rnd, agent_output=result.final or result.error)

        try:
            candidate = read_candidate(ws_dir, surface)
        except Exception as exc:
            proposal.note = f"the workspace could not be read back: {exc}"
            proposal.seconds = time.time() - started
            out.append(proposal)
            say("  -> no usable tree, skipping")
            continue

        delta = harness_tree.diff_summary(surface, live, candidate)
        changed = sorted(
            set(delta.get("added", [])) | set(delta.get("removed", [])) |
            set(delta.get("modified", []))
        )
        proposal.tree = candidate
        proposal.changed = changed
        proposal.note = _proposal_line(result.final)

        if not changed:
            say("  -> proposal changed nothing; refusing before it costs a run")
            proposal.note = proposal.note or "no edit made"
            proposal.seconds = time.time() - started
            out.append(proposal)
            continue

        say(f"  candidate changes {len(changed)} file(s): {', '.join(changed)}")

        # 3. gate it. L1/L4 first: static and budget are free.
        verdict = gate(surface, live, candidate, levels=("L1", "L4"))
        if not verdict.ok:
            proposal.gate = verdict
            proposal.seconds = time.time() - started
            out.append(proposal)
            say(f"  refused at {verdict.level}: {verdict.reason[:160]}")
            continue

        # 4. measure the candidate on the train split, then on held-out
        cand_dir = root / f"round-{rnd}" / "candidate"
        harness_tree.write_tree(surface, candidate, cand_dir, stubs=False)
        say(f"  measuring candidate on {len(train_ids)} train tasks")
        after = TS.run_set(adapter, cand_dir, task_ids=train_ids,
                           tag=f"r{rnd}-cand", timeout=timeout_per_task)
        say(f"  candidate: {after['passed']}/{after['total']} on train")

        train_diff = TS.compare(before, after)
        proposal.gate = verdict
        proposal.gate.delta = {**verdict.delta, "train": train_diff}

        if train_diff["net"] <= 0:
            say(f"  refused: train net {train_diff['net']:+d} (no improvement)")
            proposal.seconds = time.time() - started
            out.append(proposal)
            continue

        # 5. held-out, never shown to the proposer
        say(f"  checking held-out on {len(held_ids)} tasks")
        live_h = TS.run_set(adapter, store.materialise(gen.id, root / f"liveh-{rnd}"),
                            task_ids=held_ids, tag=f"r{rnd}-liveh",
                            timeout=timeout_per_task)
        cand_h = TS.run_set(adapter, cand_dir, task_ids=held_ids,
                            tag=f"r{rnd}-candh", timeout=timeout_per_task)
        held_diff = TS.compare(live_h, cand_h)
        proposal.gate.delta["heldout"] = held_diff
        say(f"  held-out net {held_diff['net']:+d}")

        if held_diff["net"] < 0:
            say("  refused: it overfit the train split")
            proposal.seconds = time.time() - started
            out.append(proposal)
            continue

        # 6. accept
        try:
            new_gen = store.commit(gen.id, candidate, kind="manual", ref="stable",
                                   note=proposal.note[:200] or f"round {rnd}",
                                   evidence={"train.json": json.dumps(train_diff),
                                             "heldout.json": json.dumps(held_diff)})
        except StoreError as exc:
            proposal.note = str(exc)
            proposal.seconds = time.time() - started
            out.append(proposal)
            say(f"  store refused: {exc}")
            continue

        proposal.accepted = True
        proposal.generation = new_gen.id
        proposal.seconds = time.time() - started
        out.append(proposal)
        say(f"  ACCEPTED as {new_gen.id} (train {train_diff['net']:+d}, "
            f"held-out {held_diff['net']:+d})")

    return out


def _proposal_line(text: str) -> str:
    for line in (text or "").splitlines():
        if line.strip().upper().startswith("PROPOSAL:"):
            return line.split(":", 1)[1].strip()[:300]
    return (text or "").strip().splitlines()[-1][:300] if (text or "").strip() else ""


def _default_train(ids: list[str], fraction: float = 0.75) -> list[str]:
    """A stable split: every domain contributes, and the order is reproducible."""
    ordered = sorted(ids)
    cut = max(1, int(len(ordered) * fraction))
    return ordered[:cut]


__all__ = [
    "PROPOSER_TASK",
    "Proposal",
    "build_proposal_prompt",
    "failure_digest",
    "improve",
    "read_candidate",
]
