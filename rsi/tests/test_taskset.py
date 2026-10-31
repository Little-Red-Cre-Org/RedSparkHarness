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

"""A task set is only useful if its answers are unambiguous and reproducible.

These tests hold the task set to exactly that, and to the upstream protocol.
"""

from __future__ import annotations

import tempfile
import unittest
from collections import Counter
from pathlib import Path

from harness2.core.spec import BenchmarkAdapter

from rsi import taskset


class TaskSetTests(unittest.TestCase):
    def test_the_set_is_deterministic(self):
        a = taskset.build_tasks()
        b = taskset.build_tasks()
        self.assertEqual([(t.id, t.expected()) for t in a], [(t.id, t.expected()) for t in b])

    def test_ids_are_unique(self):
        ids = [t.id for t in taskset.TASKS]
        self.assertEqual(len(ids), len(set(ids)))

    def test_every_answer_is_computed_from_the_task_files(self):
        """No answer is a literal: recomputing from files must match."""
        for t in taskset.TASKS:
            with self.subTest(task=t.id):
                self.assertEqual(t.expected(), taskset.format_answer(t.expect(t.files)))

    def test_domains_are_balanced(self):
        counts = Counter(t.domain for t in taskset.TASKS)
        self.assertEqual(len(counts), 8)
        self.assertEqual(len(set(counts.values())), 1)

    def test_the_size_supports_an_experiment(self):
        """A thesis needs enough tasks that one lucky task cannot carry a result."""
        self.assertGreaterEqual(len(taskset.TASKS), 20)

    def test_every_task_declares_input_files(self):
        for t in taskset.TASKS:
            with self.subTest(task=t.id):
                self.assertTrue(t.files, "task has no inputs")
                self.assertTrue(t.prompt.strip())

    def test_checker_accepts_the_exact_line(self):
        t = taskset.TASKS[0]
        self.assertTrue(taskset.check_answer(t, "ANSWER: " + t.expected()))

    def test_checker_tolerates_surrounding_prose_but_not_a_wrong_value(self):
        t = taskset.TASKS[0]
        right = "thinking...\nANSWER: " + t.expected() + "\ndone"
        self.assertTrue(taskset.check_answer(t, right))
        self.assertFalse(taskset.check_answer(t, "ANSWER: not-the-answer"))

    def test_checker_rejects_a_missing_prefix(self):
        """A harness edit that drops the format must be observable."""
        t = taskset.TASKS[0]
        self.assertFalse(taskset.check_answer(t, t.expected()))

    def test_checker_rejects_a_doubled_space(self):
        t = taskset.TASKS[0]
        self.assertFalse(taskset.check_answer(t, "ANSWER:  " + t.expected()))


class AdapterTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.adapter = taskset.TaskSetAdapter(self.root)

    def test_it_satisfies_the_upstream_protocol(self):
        self.assertIsInstance(self.adapter, BenchmarkAdapter)

    def test_tasks_and_splits_match_the_declaration(self):
        self.assertEqual(len(self.adapter.tasks()), len(taskset.TASKS))
        self.assertEqual(len(self.adapter.tasks("dates")), 5)

    def test_domain_and_prompt_come_from_the_task(self):
        tid = self.adapter.tasks()[0]
        self.assertEqual(self.adapter.domain_of(tid), taskset.TASKS_BY_ID[tid].domain)
        self.assertIn("ANSWER:", self.adapter.task_prompt(tid))

    def test_it_writes_the_task_files(self):
        tid = self.adapter.tasks()[0]
        src = self.adapter.task_files(tid)
        self.assertTrue(src.is_dir())
        self.assertEqual(len(list(src.iterdir())), len(taskset.TASKS_BY_ID[tid].files))

    def test_validate_tree_rejects_a_harness_without_an_instruction(self):
        with self.assertRaises(ValueError):
            self.adapter.validate_tree({})
        with self.assertRaises(ValueError):
            self.adapter.validate_tree({"systemprompt.md": "   "})
        self.adapter.validate_tree({"systemprompt.md": "do the work"})

    def test_scoring_is_deterministic_and_needs_no_model(self):
        tid = self.adapter.tasks()[0]
        run = self.root / "runs" / "r-score"
        run.mkdir(parents=True)
        expected = taskset.TASKS_BY_ID[tid].expected()
        (run / taskset.RESULT_FILE).write_text("ANSWER: " + expected + "\n")
        got = self.adapter.score(run, tid)
        self.assertTrue(got["passed"])
        self.assertEqual(self.adapter.score(run, tid), got)

    def test_scoring_a_wrong_answer_fails(self):
        tid = self.adapter.tasks()[0]
        run = self.root / "runs" / "r-bad"
        run.mkdir(parents=True)
        (run / taskset.RESULT_FILE).write_text("ANSWER: 0.00\n")
        self.assertFalse(self.adapter.score(run, tid)["passed"])

    def test_scoring_an_unknown_task_returns_none(self):
        run = self.root / "runs" / "r-x"
        run.mkdir(parents=True)
        self.assertIsNone(self.adapter.score(run, "no-such-task"))

    def test_seed_base_harness_writes_a_valid_tree(self):
        base = taskset.seed_base_harness(self.root / "base")
        self.assertTrue((base / "systemprompt.md").is_file())
        body = (base / "systemprompt.md").read_text(encoding="utf-8")
        self.assertIn(taskset.ANSWER_PREFIX, body)


class RunSetTests(unittest.TestCase):
    """The runner is a thin loop, so it can be tested without a model."""

    class FakeAdapter:
        def __init__(self, outcomes):
            self._outcomes = outcomes  # task_id -> (passed, value_ok)

        def tasks(self):
            return list(self._outcomes)

        def domain_of(self, tid):
            return "d-" + tid

        def execute(self, tid, harness_dir, run_id, *, timeout=None):
            from pathlib import Path as _P
            import tempfile as _t
            root = _P(tempfile.mkdtemp())
            return root

        def score(self, run_dir, tid):
            passed, value_ok = self._outcomes[tid]
            return {"passed": passed, "value_ok": value_ok,
                    "shape": "ok" if passed else ("value_only" if value_ok else "wrong")}

    def test_summary_counts_passes(self):
        ad = self.FakeAdapter({"a": (True, True), "b": (False, True), "c": (False, False)})
        s = taskset.run_set(ad, None)
        self.assertEqual((s["total"], s["passed"], s["value_ok"]), (3, 1, 2))
        self.assertAlmostEqual(s["pass_rate"], 0.3333, places=3)

    def test_summary_groups_by_domain(self):
        ad = self.FakeAdapter({"a": (True, True), "b": (False, False)})
        s = taskset.run_set(ad, None)
        self.assertEqual(set(s["by_domain"]), {"d-a", "d-b"})

    def test_a_failing_task_does_not_abort_the_run(self):
        class Boom(RunSetTests.FakeAdapter):
            def execute(self, tid, harness_dir, run_id, *, timeout=None):
                raise RuntimeError("nope")

        ad = Boom({"a": (True, True), "b": (True, True)})
        s = taskset.run_set(ad, None)
        self.assertEqual(s["total"], 2)
        self.assertEqual(s["passed"], 0)
        self.assertEqual({r["shape"] for r in s["rows"]}, {"error"})

    def test_compare_reports_gains_and_losses(self):
        base = {"rows": [{"task": "a", "passed": False},
                          {"task": "b", "passed": True},
                          {"task": "c", "passed": False}]}
        cand = {"rows": [{"task": "a", "passed": True},
                          {"task": "b", "passed": False},
                          {"task": "c", "passed": False}]}
        d = taskset.compare(base, cand)
        self.assertEqual(d["gained"], ["a"])
        self.assertEqual(d["lost"], ["b"])
        self.assertEqual(d["net"], 0)

    def test_compare_ignores_tasks_only_one_side_ran(self):
        base = {"rows": [{"task": "a", "passed": False}]}
        cand = {"rows": [{"task": "z", "passed": True}]}
        d = taskset.compare(base, cand)
        self.assertEqual(d["shared"], 0)
        self.assertEqual(d["net"], 0)

    def test_compare_counts_an_improvement(self):
        base = {"rows": [{"task": "a", "passed": False}, {"task": "b", "passed": False}]}
        cand = {"rows": [{"task": "a", "passed": True}, {"task": "b", "passed": False}]}
        d = taskset.compare(base, cand)
        self.assertEqual((d["baseline_pass"], d["candidate_pass"], d["net"]), (0, 1, 1))


if __name__ == "__main__":
    unittest.main()
