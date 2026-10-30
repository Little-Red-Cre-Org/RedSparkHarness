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

"""The proposer must not be able to cheat, and the split must stay honest.

These are the invariants that make a self-improvement run worth reporting. They
are cheap to check and were each written after something concrete went wrong.
"""

from __future__ import annotations

import unittest

from harness2.substrate.opencode import OPENCODE_SURFACE

from rsi import improve


def _live() -> dict:
    tree = {name: "" for name in OPENCODE_SURFACE.always_on}
    tree["systemprompt.md"] = "Do the work carefully.\n"
    return tree


def _summary(rows):
    return {"total": len(rows), "passed": sum(1 for r in rows if r.get("passed")),
            "rows": rows}


class DigestTests(unittest.TestCase):
    def test_it_never_shows_task_ids(self):
        s = _summary([{"task": "table-max-300", "passed": False,
                      "shape": "value_only", "delivered": "S3002"}])
        text = improve.failure_digest(s)
        self.assertNotIn("table-max-300", text)

    def test_it_never_shows_the_expected_answer(self):
        s = _summary([{"task": "t", "passed": False, "shape": "value_only",
                      "delivered": "7", "expected": "ANSWER: 12345"}])
        text = improve.failure_digest(s)
        self.assertNotIn("12345", text)

    def test_it_shows_what_was_delivered(self):
        s = _summary([{"task": "t", "passed": False, "shape": "value_only",
                      "delivered": "gamma"}])
        self.assertIn("gamma", improve.failure_digest(s))

    def test_it_names_the_shared_failure_shape(self):
        """The first real run refused for lack of this: six same-cause failures read
        as six unrelated ones when the shape was withheld."""
        s = _summary([{"task": str(i), "passed": False, "shape": "value_only",
                      "delivered": str(i)} for i in range(6)])
        text = improve.failure_digest(s)
        self.assertIn("6 with value_only", text)
        self.assertIn(improve.SHAPE_HINT["value_only"], text)

    def test_all_passing_says_so(self):
        text = improve.failure_digest(_summary([{"task": "a", "passed": True}]))
        self.assertIn("none", text)


class PromptTests(unittest.TestCase):
    def test_the_prompt_states_the_rules_that_keep_it_honest(self):
        p = improve.build_proposal_prompt(
            _live(), _summary([{"task": "a", "passed": False,
                               "shape": "value_only", "delivered": "1"}]),
            OPENCODE_SURFACE,
        )
        self.assertIn("HARNESS", p)
        self.assertIn("PROPOSAL:", p)
        self.assertIn("withheld", p.lower())

    def test_it_includes_the_current_harness_verbatim(self):
        p = improve.build_proposal_prompt(_live(), _summary([]), OPENCODE_SURFACE)
        self.assertIn("Do the work carefully.", p)


class SplitTests(unittest.TestCase):
    class FakeAdapter:
        def tasks(self):
            return [f"t{i}" for i in range(10)]

        def surface(self):
            return OPENCODE_SURFACE

    def test_overlapping_splits_are_refused_before_any_work(self):
        """Judging on a task the proposer trained on makes every number meaningless."""
        with self.assertRaises(ValueError) as ctx:
            improve.improve(None, self.FakeAdapter(), train=["t1", "t2"],
                            heldout=["t2", "t3"])
        self.assertIn("overlap", str(ctx.exception))

    def test_an_empty_split_is_refused(self):
        with self.assertRaises(ValueError):
            improve.improve(None, self.FakeAdapter(), train=[], heldout=["t1"])

    def test_the_default_split_is_disjoint_and_covers_every_task(self):
        ids = [f"t{i}" for i in range(40)]
        train = improve._default_train(ids)
        held = [t for t in ids if t not in set(train)]
        self.assertFalse(set(train) & set(held))
        self.assertEqual(sorted(train + held), sorted(ids))

    def test_the_default_split_is_stable(self):
        ids = [f"t{i}" for i in range(40)]
        self.assertEqual(improve._default_train(ids), improve._default_train(list(reversed(ids))))


class ProposalLineTests(unittest.TestCase):
    def test_it_reads_the_declared_line(self):
        self.assertEqual(improve._proposal_line("chatty\nPROPOSAL: tightened the form"),
                         "tightened the form")

    def test_it_survives_output_without_the_marker(self):
        self.assertEqual(improve._proposal_line("just one line"), "just one line")
        self.assertEqual(improve._proposal_line(""), "")


if __name__ == "__main__":
    unittest.main()
