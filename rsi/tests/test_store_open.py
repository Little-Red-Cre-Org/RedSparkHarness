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

"""Regressions for opening a store that has never been written.

A window has no `init` subcommand to run, so opening it is the whole of the
setup. Every read path starts from the "stable" ref, and a store with none
refuses the first run with a message about set_ref that a window cannot show
anywhere useful.
"""

import tempfile
import unittest
from pathlib import Path

from harness2.substrate.opencode import OPENCODE_SURFACE
from rsi.store import ensure_ready, open_store

SURF = OPENCODE_SURFACE


class EnsureReadyTests(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "store"

    def test_a_fresh_directory_opens_with_something_to_read(self):
        store = ensure_ready(self.root, SURF)
        gen = store.current("stable")
        self.assertEqual(gen.id, "g0001")
        # The tree has to be readable, not merely present: an empty generation
        # would satisfy the ref and still leave the run with no prompt.
        tree = store.tree_of(gen.id)
        self.assertIn("systemprompt.md", tree)

    def test_opening_twice_does_not_add_a_second_generation(self):
        ensure_ready(self.root, SURF)
        store = ensure_ready(self.root, SURF)
        self.assertEqual(len(store.generations()), 1)
        self.assertEqual(store.current("stable").id, "g0001")

    def test_generations_without_a_ref_are_pointed_at_rather_than_replaced(self):
        # A commit can name a ref of its own and leave "stable" behind; the
        # newest generation is what a reader means by current, and rewriting
        # it would throw away work that was already measured.
        store = open_store(self.root, SURF)
        store.init(tree={"systemprompt.md": "first\n"}, kind="base")
        second = store.commit("g0001", {"systemprompt.md": "second\n"}, kind="manual")
        self.assertIsNone(store.get_ref("stable"))

        ready = ensure_ready(self.root, SURF)
        self.assertEqual(ready.current("stable").id, second.id)
        self.assertEqual(len(ready.generations()), 2)

    def test_a_store_that_already_has_a_stable_ref_is_left_alone(self):
        store = open_store(self.root, SURF)
        gen = store.init(tree={"systemprompt.md": "kept\n"}, kind="base")
        store.set_ref("stable", gen.id, by="test")
        again = ensure_ready(self.root, SURF)
        self.assertEqual(again.current("stable").id, gen.id)
        self.assertEqual(len(again.generations()), 1)


if __name__ == "__main__":
    unittest.main()
