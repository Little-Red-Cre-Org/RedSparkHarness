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

"""Regressions for the adoption gate: each level refuses the failure it exists for."""

import tempfile
import unittest
from pathlib import Path

from harness2.substrate.opencode import OPENCODE_SURFACE

from rsi.gate import (
    Limits,
    check_budget,
    check_parity,
    check_smoke,
    check_static,
    gate,
    gate_and_promote,
)
from rsi.smoke import SmokeTask, default_tasks
from rsi.store import open_store

SURF = OPENCODE_SURFACE

GOOD_SCRIPT = """import csv
import sys
from decimal import Decimal

with open(sys.argv[1]) as source:
    amounts = [Decimal(row['amount']) for row in csv.DictReader(source)]
total = sum((amount for amount in amounts), Decimal(0))
print(f'Total: {total:.2f}')
"""

BAD_SCRIPT = GOOD_SCRIPT.replace(
    "sum((amount for amount in amounts)",
    "sum((amount for amount in amounts if amount > 0)",
)


def tree(script: str = GOOD_SCRIPT, prompt: str = "Use scripts/summarize.py.\n") -> dict:
    return {
        "systemprompt.md": prompt,
        "guardrails.md": "",
        "LongTermMEMORY.md": "",
        "tool_descriptions/tool_guidance.md": "",
        "scripts/summarize.py": script,
    }


class GateTests(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "store"
        self.store = open_store(self.root, SURF)

    # -- L1 --------------------------------------------------------------------

    def test_l1_accepts_a_valid_tree(self):
        v = check_static(SURF, tree(), allow_subagents=True)
        self.assertTrue(v.ok, v.reason)
        self.assertEqual(v.census["scripts"], 1)

    def test_l1_rejects_a_syntax_error(self):
        v = check_static(SURF, tree(script="def broken(:\n"), allow_subagents=True)
        self.assertFalse(v.ok)
        self.assertEqual(v.level, "L1")
        self.assertIn("does not compile", v.reason)

    def test_l1_rejects_an_empty_tree(self):
        v = check_static(SURF, {}, allow_subagents=True)
        self.assertFalse(v.ok)
        self.assertIn("empty", v.reason)

    def test_l1_rejects_over_the_always_on_cap(self):
        fat = tree(prompt="x" * (SURF.always_on_max + 100))
        v = check_static(SURF, fat, allow_subagents=True)
        self.assertFalse(v.ok)
        self.assertIn("cap", v.reason)

    def test_l1_rejects_a_skill_without_a_trigger_line(self):
        t = tree()
        t["skills/review/SKILL.md"] = "---\nname: review\ndescription: review a ledger\n---\n"
        v = check_static(SURF, t, allow_subagents=True)
        self.assertFalse(v.ok)
        self.assertIn("never named", v.reason)

    def test_l1_rejects_a_script_invoked_but_not_shipped(self):
        t = tree(prompt="Run python3 scripts/missing.py first.\n")
        v = check_static(SURF, t, allow_subagents=True)
        self.assertFalse(v.ok)
        self.assertIn("not in the harness", v.reason)

    # -- L4 --------------------------------------------------------------------

    def test_l4_accepts_a_small_change(self):
        live, cand = tree(BAD_SCRIPT), tree(GOOD_SCRIPT)
        v = check_budget(SURF, live, cand, Limits())
        self.assertTrue(v.ok, v.reason)
        self.assertEqual(v.delta["modified"], ["scripts/summarize.py"])

    def test_l4_rejects_a_wide_rewrite(self):
        live = tree()
        cand = dict(live)
        for i in range(10):
            cand[f"scripts/h{i}.py"] = "print(%d)\n" % i
        v = check_budget(SURF, live, cand, Limits(max_changed_files=6))
        self.assertFalse(v.ok)
        self.assertEqual(v.level, "L4")
        self.assertIn("files changed", v.reason)

    def test_l4_rejects_a_large_always_on_delta(self):
        live = tree(prompt="short\n")
        cand = tree(prompt="short\n" + "y" * 5000)
        v = check_budget(SURF, live, cand, Limits(max_always_on_delta=4000))
        self.assertFalse(v.ok)
        self.assertIn("always-on text moved", v.reason)

    def test_l4_rejects_too_many_removals(self):
        live = tree()
        live["scripts/a.py"] = "print(1)\n"
        live["scripts/b.py"] = "print(2)\n"
        live["scripts/c.py"] = "print(3)\n"
        v = check_budget(SURF, live, tree(), Limits(max_removed_files=2))
        self.assertFalse(v.ok)
        self.assertIn("files removed", v.reason)

    # -- L2 --------------------------------------------------------------------

    def test_l2_accepts_a_working_harness(self):
        v = check_smoke(SURF, tree(), default_tasks())
        self.assertTrue(v.ok, v.reason)
        self.assertEqual(len(v.smoke), 2)

    def test_l2_rejects_a_harness_that_crashes(self):
        v = check_smoke(SURF, tree(script="raise SystemExit(3)\n"), default_tasks())
        self.assertFalse(v.ok)
        self.assertEqual(v.level, "L2")
        self.assertIn("exit 3", v.reason)

    def test_l2_rejects_a_harness_that_hangs(self):
        task = SmokeTask("slow", "amount\n1\n", "Total: 1.00", timeout=0.6)
        v = check_smoke(SURF, tree(script="while True: pass\n"), [task])
        self.assertFalse(v.ok)
        self.assertIn("timed out", v.reason)

    def test_l2_rejects_missing_script(self):
        t = tree()
        del t["scripts/summarize.py"]
        v = check_smoke(SURF, t, default_tasks())
        self.assertFalse(v.ok)
        self.assertIn("no scripts/summarize.py", v.reason)

    # -- L3 --------------------------------------------------------------------

    def test_l3_accepts_an_improvement(self):
        v = check_parity(SURF, tree(BAD_SCRIPT), tree(GOOD_SCRIPT), default_tasks())
        self.assertTrue(v.ok, v.reason)

    def test_l3_rejects_a_regression(self):
        v = check_parity(SURF, tree(GOOD_SCRIPT), tree(BAD_SCRIPT), default_tasks())
        self.assertFalse(v.ok)
        self.assertEqual(v.level, "L3")
        self.assertIn("live produced", v.reason)

    def test_l3_tolerates_a_change_neither_answers_correctly(self):
        """Both harnesses print a total, so both "tried"; neither matching is not a regression
        when the live one was already wrong."""
        wrong_total = GOOD_SCRIPT.replace("print(f'Total: {total:.2f}')", "print(f'Total: {total + 1:.2f}')")
        other_total = GOOD_SCRIPT.replace("print(f'Total: {total:.2f}')", "print(f'Total: {total + 2:.2f}')")
        v = check_parity(SURF, tree(wrong_total), tree(other_total), default_tasks())
        self.assertTrue(v.ok, v.reason)

    def test_l3_refuses_garbage_when_live_is_already_wrong(self):
        """The hole this test exists for: 'no worse than live' must not mean 'anything goes'.

        With a broken baseline, a candidate that prints unrelated text used to pass L3.
        """
        broken_live = GOOD_SCRIPT.replace("print(f'Total: {total:.2f}')", "raise SystemExit(9)")
        v = check_parity(SURF, tree(broken_live), tree(script="print('not a total')\n"), default_tasks())
        self.assertFalse(v.ok, "a candidate that prints nothing total-shaped must be refused")
        self.assertEqual(v.level, "L3")
        self.assertIn("does not even produce a total-shaped answer", v.reason)

    # -- ordering --------------------------------------------------------------

    def test_cheap_levels_run_before_execution(self):
        """A tree that fails L1 must be refused without ever starting a subprocess."""
        v = gate(SURF, tree(), tree(script="def broken(:\n"))
        self.assertFalse(v.ok)
        self.assertEqual(v.level, "L1")
        self.assertEqual(v.smoke, {})

    def test_gate_reports_the_first_failing_level(self):
        cand = tree(script="def broken(:\n")
        cand.update({f"scripts/x{i}.py": "print(1)\n" for i in range(9)})
        v = gate(SURF, tree(), cand)
        self.assertEqual(v.level, "L1", "L1 must win even when L4 would also fail")

    def test_levels_subset_skips_execution(self):
        v = gate(SURF, tree(BAD_SCRIPT), tree(GOOD_SCRIPT), levels=("L1", "L4"))
        self.assertTrue(v.ok, v.reason)

    def test_unknown_level_is_refused(self):
        with self.assertRaises(ValueError):
            gate(SURF, tree(), tree(), levels=("L9",))

    def test_explain_is_human_readable(self):
        ok = gate(SURF, tree(BAD_SCRIPT), tree(GOOD_SCRIPT))
        self.assertIn("accepted", ok.explain())
        bad = gate(SURF, tree(), tree(script="def broken(:\n"))
        self.assertIn("rejected at L1", bad.explain())

    # -- end to end ------------------------------------------------------------

    def test_gate_and_promote_accepts_and_moves_stable(self):
        self.store.init(tree=tree(BAD_SCRIPT))
        self.store.set_ref("stable", "g0001")
        verdict, gen = gate_and_promote(self.store, tree(GOOD_SCRIPT), note="fix the sign")
        self.assertTrue(verdict.ok, verdict.reason)
        self.assertIsNotNone(gen)
        self.assertEqual(self.store.current().id, gen.id)
        self.assertEqual(self.store.current().parent, "g0001")
        self.assertTrue((self.store.evidence_dir(gen.id) / "gate.json").is_file())

    def test_gate_and_promote_writes_nothing_on_rejection(self):
        self.store.init(tree=tree(BAD_SCRIPT))
        self.store.set_ref("stable", "g0001")
        verdict, gen = gate_and_promote(self.store, tree(script="def broken(:\n"))
        self.assertFalse(verdict.ok)
        self.assertIsNone(gen)
        self.assertEqual(len(self.store.generations()), 1)
        self.assertEqual(self.store.current().id, "g0001")

    def test_no_op_candidate_is_refused_by_the_store_not_the_gate(self):
        self.store.init(tree=tree(GOOD_SCRIPT))
        self.store.set_ref("stable", "g0001")
        from rsi.store import StoreError

        with self.assertRaises(StoreError):
            gate_and_promote(self.store, tree(GOOD_SCRIPT))


if __name__ == "__main__":
    unittest.main()
