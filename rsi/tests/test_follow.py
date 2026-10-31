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

"""A follower must not walk away from a run with events still unread.

The client watches a run by polling a cursor forward and asking whether the run
has settled. Those are two different reads, and the order of events makes the
gap real: a run emits its last events and only then marks itself done. A poll
that sees "done" and stops therefore stops exactly when there may still be
events newer than its cursor -- the tail of every run, which is the part the
user most wants to see.

These tests pin down the two halves: the log answers an empty-log poll without
blocking, and the follower drains what is left before it reports the run done.
"""

from __future__ import annotations

import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from harness2.substrate.opencode import OPENCODE_SURFACE
from rsi.server import EventLog, serve
from rsi.sessions import SessionStore
from rsi.store import open_store

SURF = OPENCODE_SURFACE


class EventLogSinceTests(unittest.TestCase):
    def test_a_poll_answers_at_once_but_a_stream_waits(self):
        """The two callers want opposite things from the same log.

        A poll asks what exists now and must return; a stream waits for the
        next event and must not. since() defaults to the poll's behaviour,
        and a caller that wants to wait asks for it. Making the empty log
        return immediately regardless satisfied the poll and broke the
        stream, which then spun writing keepalives into a socket.
        """
        log = EventLog()
        began = time.monotonic()
        self.assertEqual(log.since(0), [])
        self.assertLess(time.monotonic() - began, 0.1, "a poll must not wait")

        began = time.monotonic()
        self.assertEqual(log.since(0, timeout=0.3), [])
        self.assertGreaterEqual(time.monotonic() - began, 0.25, "a stream must wait")

    def test_a_timeout_still_expires_once_there_is_history(self):
        log = EventLog()
        log.emit("first", n=1)
        self.assertEqual([e.kind for e in log.since(1)], [])
        began = time.monotonic()
        self.assertEqual(log.since(1, timeout=0.2), [])
        self.assertGreaterEqual(time.monotonic() - began, 0.15)

    def test_events_after_a_cursor_come_back_in_order(self):
        log = EventLog()
        for i in range(5):
            log.emit("e", n=i)
        got = [e.data["n"] for e in log.since(2)]
        self.assertEqual(got, [2, 3, 4])

    def test_first_seq_reports_what_the_log_still_holds(self):
        log = EventLog()
        self.assertEqual(log.first_seq, 1, "an empty log has nothing behind it")
        log.emit("a")
        log.emit("b")
        self.assertEqual(log.first_seq, 1)

    def test_a_bounded_log_makes_the_gap_visible(self):
        """Rolling over must be observable, not a silent skip."""
        log = EventLog(maxlen=3)
        for i in range(6):
            log.emit("e", n=i)
        self.assertEqual(log.first_seq, 4)
        # A cursor at 0 is behind what is held, so events 1..3 are gone.
        self.assertEqual(len(log.since(0)), 3)


class FollowerDrainsTheTailTests(unittest.TestCase):
    """The exact shape Client._follow uses, against a real service."""

    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "store"
        self.store = open_store(self.root, SURF)
        self.store.init(tree={"systemprompt.md": "x\n"})
        self.store.set_ref("stable", "g0001")
        self.sessions = SessionStore(Path(tmp.name))
        httpd, self.app, _ = serve(self.root, SURF, sessions=self.sessions)
        self.addCleanup(lambda: (self.app.events.close(), httpd.shutdown(), httpd.server_close()))
        self.base = "http://127.0.0.1:" + str(httpd.server_address[1])
        # The service refuses a run it has no way to execute, so these tests
        # supply one. What they exercise is the streaming, not the execution.
        self.app.executor = lambda task, emit, session, model: None

    def test_the_last_events_are_not_lost_when_the_run_settles(self):
        from rsi.service import Service

        svc = Service.attach(self.base)
        run_id = svc.start("go", session=None, model="fake")["run"]

        # Emit the run's last three events and only then settle it: this is the
        # order the real worker uses, and the order that loses the tail.
        for n in range(3):
            self.app.events.emit("tool.result", run=run_id, index=n, ok=True, ms=n)
        self.app.events.emit("run.finished", run=run_id, ok=True, steps=3, seconds=0.1)
        self.app._finish_run(run_id, result=None)

        seen = 0
        collected: list[str] = []
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            for ev in svc.since(seen):
                seen = ev.get("seq", seen)
                if ev.get("data", {}).get("run") not in (None, run_id):
                    continue
                collected.append(ev.get("kind", ""))
            state = svc.state(run_id)
            if state.get("state") in ("done", "error"):
                # The same final read the follower does before it leaves.
                for ev in svc.since(seen):
                    if ev.get("data", {}).get("run") not in (None, run_id):
                        continue
                    collected.append(ev.get("kind", ""))
                break
            time.sleep(0.05)

        self.assertEqual(
            collected.count("tool.result"), 3, "the tail of the run must not be dropped"
        )
        self.assertEqual(collected[-1], "run.finished")

    def test_two_followers_on_one_service_see_the_same_run(self):
        """Attaching is not owning: a second viewer reads the same stream."""
        from rsi.service import Service

        a = Service.attach(self.base)
        b = Service.attach(self.base)
        self.assertIsNone(a.app, "an attached handle must not claim ownership")
        self.assertIsNone(b.app)

        run_id = a.start("go", session=None, model="fake")["run"]
        self.app.events.emit("tool.called", run=run_id, index=0, name="write_file")
        self.app._finish_run(run_id, result=None)

        def kinds(svc) -> list[str]:
            return [e["kind"] for e in svc.since(0) if e.get("data", {}).get("run") == run_id]

        self.assertIn("tool.called", kinds(a))
        self.assertEqual(kinds(a), kinds(b), "both viewers must see the same run")

        threads = [
            threading.Thread(target=lambda: kinds(Service.attach(self.base))) for _ in range(3)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=5)
            self.assertFalse(t.is_alive(), "a reader must not block another")

    def test_a_follower_that_fell_behind_is_told_what_it_lost(self):
        """Truncation must be reported over the wire, not silently absorbed."""
        from rsi.server import EventLog
        from rsi.service import Service

        # Model a long run: a small log with far more events pushed through it.
        self.app.events = EventLog(maxlen=5)
        for i in range(20):
            self.app.events.emit("tool.result", run="r1", index=i, ok=True, ms=i)

        svc = Service.attach(self.base)
        kept = svc.since(0)
        self.assertEqual(len(kept), 5)
        self.assertEqual(svc.dropped, 15, "the 15 events that rolled out must be reported")

        # A cursor that is already caught up reports no gap.
        svc2 = Service.attach(self.base)
        svc2.since(kept[-1]["seq"])
        self.assertEqual(svc2.dropped, 0)


if __name__ == "__main__":
    unittest.main()
