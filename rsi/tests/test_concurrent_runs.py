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

"""Two ways a finished run could still be reported wrong.

The first is a failure rendered as a success. A run that dies -- the model
endpoint unreachable, say -- still emits run.finished, because the run did
finish; only its ok flag says how. A view that reads the event's shape rather
than its verdict tells the user the opposite of what happened, and after
retries have already burned the wait there is nothing else to correct it.

The second is a record lost to its own storage. session.json is one file
holding every run of a session, so saving it is read-modify-write. Two runs in
one session at once each save a list from before the other finished, and the
later save wins: a run whose transcript is complete on disk disappears from the
index.
"""

from __future__ import annotations

import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from harness2.substrate.opencode import OPENCODE_SURFACE
from rsi.sessions import SessionStore

SURF = OPENCODE_SURFACE


class FakeResult:
    def __init__(self, final: str = "ok") -> None:
        self.model = "fake/model"
        self.final = final
        self.error = ""
        self.seconds = 0.1
        self.steps = [object()]

    @property
    def ok(self) -> bool:
        return True

    def transcript(self) -> str:
        return "[FINAL] " + self.final

    def to_dict(self) -> dict:
        return {}


class FakeRunner:
    def __init__(self, barrier: threading.Barrier | None = None, hold: float = 0.0) -> None:
        self.barrier = barrier
        self.hold = hold

    def run(self, task, workspace, harness, surface, *, on_step=None):
        if self.barrier is not None:
            try:
                self.barrier.wait(timeout=5)
            except threading.BrokenBarrierError:
                pass
        return FakeResult(task)


class ConcurrentRunTests(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.store = SessionStore(self.root)
        self.session = self.store.create(title="t", model="fake/model")

    def test_two_runs_at_once_both_land_in_the_index(self):
        """The failure mode: one of them saves a list that predates the other."""
        barrier = threading.Barrier(2)
        failures: list[BaseException] = []

        def go():
            try:
                self.store.run(
                    self.session.id,
                    "task",
                    {"systemprompt.md": "x\n"},
                    SURF,
                    generation="g0001",
                    agent=FakeRunner(barrier),
                )
            except BaseException as exc:  # noqa: BLE001 - surfaced below
                failures.append(exc)

        threads = [threading.Thread(target=go) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)

        self.assertEqual(failures, [])
        recorded = self.store.get(self.session.id).runs
        self.assertEqual(
            len(recorded), 2, "a run whose transcript is on disk must be in the index"
        )

        # Each record must point at a run directory that really exists.
        for r in recorded:
            self.assertTrue(
                (self.session.runs_dir / r.id / "transcript.md").is_file(),
                "indexed run has no transcript: " + r.id,
            )

    def test_eight_runs_at_once_leave_eight_records(self):
        barrier = threading.Barrier(8)
        failures: list[BaseException] = []

        def go():
            try:
                self.store.run(
                    self.session.id,
                    "t",
                    {"systemprompt.md": "x\n"},
                    SURF,
                    generation="g0001",
                    agent=FakeRunner(barrier),
                )
            except BaseException as exc:  # noqa: BLE001
                failures.append(exc)

        threads = [threading.Thread(target=go) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=15)

        self.assertEqual(failures, [])
        self.assertEqual(len(self.store.get(self.session.id).runs), 8)


if __name__ == "__main__":
    unittest.main()
