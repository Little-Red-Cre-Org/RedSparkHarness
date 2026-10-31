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

"""A run that just succeeded must still be there when its watcher looks.

A follower polls every 150ms. So the terminal state of a run is, by
construction, the thing nobody has read yet at the moment it becomes true --
and that is exactly the record a naive bound on the registry would evict first.
The user then sees "no such run" for a run that finished successfully a moment
ago, which reads as a failure and loses the transcript.

The bound may shed old runs. It may not shed the one that just settled, or any
that settled too recently to have been read.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from harness2.substrate.opencode import OPENCODE_SURFACE
from rsi.server import Application, StoreError
from rsi.store import open_store

SURF = OPENCODE_SURFACE


class _Result:
    id = "session-run-1"
    final = "ok"
    ok = True


class PruneGraceTests(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        store = open_store(Path(tmp.name) / "store", SURF)
        store.init(tree={"systemprompt.md": "x\n"})
        store.set_ref("stable", "g0001")
        self.app = Application(store)
        self.app.max_runs = 2

    def _run(self, rid: str) -> None:
        self.app.runs[rid] = {"state": "running"}
        self.app._finish_run(rid, result=_Result())

    def test_the_run_that_just_settled_is_never_dropped(self):
        """The bound must not evict the record it was just given.

        The case that bites: a long run is the oldest record, short runs
        settled under it in the meantime, and it settles last. Its watcher
        has not polled yet, so dropping it here is exactly the failure the
        run registry's bound must not cause.
        """
        self.app.run_grace = 0.0  # so the keep rule must do the work alone
        self.app.runs["long"] = {"state": "running"}
        self.app.runs["old1"] = {"state": "done", "finished": 0.0}
        self.app.runs["old2"] = {"state": "done", "finished": 0.0}
        self.assertGreater(len(self.app.runs), self.app.max_runs, 'the prune must trigger')

        self.app._finish_run("long", result=_Result())

        self.assertIn(
            "long", self.app.runs, "the run that just settled must survive its own prune"
        )
        self.assertEqual(self.app.run_state("long")["state"], "done")
        self.assertLessEqual(len(self.app.runs), self.app.max_runs, "it must still shed")

    def test_a_recently_settled_run_is_spared(self):
        """Everything settles inside the grace window here, so nothing is shed."""
        for rid in ("a", "b", "c", "d", "e"):
            self._run(rid)
        for rid in ("a", "b", "c", "d", "e"):
            self.assertIn(rid, self.app.runs, "a run settled a moment ago may still be polled for")

    def test_old_settled_runs_are_still_shed(self):
        """The bound has to do its job: these are old, and the index has them."""
        for rid in ("a", "b", "c", "d", "e"):
            self.app.runs[rid] = {"state": "running"}
            self.app._finish_run(rid, result=_Result())
            # Pretend each settled long ago.
            self.app.runs[rid]["finished"] = 0.0
        self.assertLessEqual(len(self.app.runs), 2, "old settled runs must still be shed")

    def test_a_running_run_is_never_dropped(self):
        self.app.runs["live"] = {"state": "running"}
        for i in range(10):
            rid = "old%d" % i
            self.app.runs[rid] = {"state": "running"}
            self.app._finish_run(rid, result=_Result())
            self.app.runs[rid]["finished"] = 0.0
        self.assertIn("live", self.app.runs)

    def test_an_unknown_run_still_raises(self):
        with self.assertRaises(StoreError):
            self.app.run_state("never-existed")


if __name__ == "__main__":
    unittest.main()
