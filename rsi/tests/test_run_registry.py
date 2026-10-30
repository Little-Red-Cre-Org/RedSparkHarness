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

"""The run registry must not grow forever.

The service is meant to be left running. A dict of every run it has ever
started is a leak with a friendly name, and it leaks fastest in the case that
matters: a long session with many short runs. The bound has to shed settled
runs only -- dropping one still in flight would make a watcher's /runs/{id}
fail for a run that is happening right now.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from harness2.substrate.opencode import OPENCODE_SURFACE
from rsi.server import Application
from rsi.store import open_store

SURF = OPENCODE_SURFACE


class RunRegistryTests(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.store = open_store(Path(tmp.name) / "store", SURF)
        self.store.init(tree={"systemprompt.md": "x\n"})
        self.store.set_ref("stable", "g0001")
        self.app = Application(self.store)
        self.app.max_runs = 5
        # These tests are about the bound itself, so they age records on
        # purpose rather than waiting out the grace window that spares a
        # run its watcher has not polled for yet.
        self.app.run_grace = 0.0

    def _settle(self, run_id: str) -> None:
        self.app._finish_run(run_id)

    def test_settled_runs_are_shed_once_over_the_bound(self):
        for i in range(12):
            rid = "run%02d" % i
            self.app.runs[rid] = {"state": "running"}
            self._settle(rid)
        self.assertLessEqual(len(self.app.runs), 5, "the registry must stay bounded")

    def test_the_newest_runs_are_the_ones_kept(self):
        for i in range(10):
            rid = "run%02d" % i
            self.app.runs[rid] = {"state": "running"}
            self._settle(rid)
            self.app.runs[rid]["finished"] = 0.0  # settled long ago
        self.assertIn("run09", self.app.runs, "the newest run must not be shed by its own prune")
        self.assertNotIn("run00", self.app.runs, "the oldest is the one to shed")

    def test_a_run_in_flight_is_never_dropped(self):
        self.app.runs["live"] = {"state": "running"}
        for i in range(20):
            rid = "done%02d" % i
            self.app.runs[rid] = {"state": "running"}
            self._settle(rid)
        self.assertIn("live", self.app.runs, "a running run must survive the prune")
        self.assertLessEqual(len(self.app.runs), 5)


if __name__ == "__main__":
    unittest.main()
