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

"""An empty log must not turn the event stream into a spin loop.

/events writes a keepalive whenever a poll comes back empty. That is correct
only if an empty poll actually waits. When since() returned immediately on an
empty log, the SSE loop never slept: one connection wrote 451,787 bytes in half
a second, on a server thread, burning CPU for as long as the client stayed
connected. It happens naturally in the window between the server starting and
its first event, and whenever a service is freshly attached.

The bound here is deliberately loose. What matters is that the number is
proportional to elapsed time, not to how fast the CPU can spin.
"""

from __future__ import annotations

import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from harness2.substrate.opencode import OPENCODE_SURFACE
from rsi.server import EventLog, serve
from rsi.store import open_store

SURF = OPENCODE_SURFACE


class EmptyLogStreamTests(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name) / "store"
        store = open_store(root, SURF)
        store.init(tree={"systemprompt.md": "x\n"})
        store.set_ref("stable", "g0001")
        self.httpd, self.app, _ = serve(root, SURF, store=store)
        self.addCleanup(
            lambda: (self.app.events.close(), self.httpd.shutdown(), self.httpd.server_close())
        )
        self.base = "http://127.0.0.1:" + str(self.httpd.server_address[1])

    def test_an_empty_log_does_not_flood_the_socket(self):
        # Replace the log with a fresh, empty one: the state that spun.
        self.app.events = EventLog()

        got = {"bytes": 0}
        stop = threading.Event()

        def reader():
            try:
                with urllib.request.urlopen(self.base + "/events?since=0", timeout=2) as r:
                    while not stop.is_set():
                        chunk = r.read1(4096)
                        if not chunk:
                            break
                        got["bytes"] += len(chunk)
            except Exception:
                pass

        t = threading.Thread(target=reader, daemon=True)
        t.start()
        time.sleep(0.5)
        stop.set()
        t.join(timeout=3)

        self.assertLess(
            got["bytes"], 5000, "the stream is spinning: %d bytes in 0.5s" % got["bytes"]
        )

    def test_an_empty_log_still_gets_keepalives(self):
        """Not spinning must not mean going silent: the stream must stay open."""
        self.app.events = EventLog()

        got = {"bytes": 0}
        stop = threading.Event()

        def reader():
            try:
                with urllib.request.urlopen(self.base + "/events?since=0", timeout=2) as r:
                    while not stop.is_set():
                        chunk = r.read1(4096)
                        if not chunk:
                            break
                        got["bytes"] += len(chunk)
            except Exception:
                pass

        t = threading.Thread(target=reader, daemon=True)
        t.start()
        time.sleep(2.5)
        stop.set()
        t.join(timeout=3)

        self.assertGreater(got["bytes"], 10, "the stream went silent instead of pacing itself")

    def test_a_poll_on_an_empty_log_returns_at_once(self):
        """The snapshot route is the opposite case: it must never wait.

        /events/since answers with what exists now. Blocking there would
        freeze the poller, which is why it asks for a zero timeout rather
        than relying on the log's own default.
        """
        import json

        self.app.events = EventLog()
        began = time.monotonic()
        with urllib.request.urlopen(self.base + "/events/since?after=0", timeout=5) as r:
            body = json.loads(r.read())
        elapsed = time.monotonic() - began
        self.assertEqual(body["events"], [])
        self.assertLess(elapsed, 0.5, "the snapshot route blocked for %.2fs" % elapsed)


if __name__ == "__main__":
    unittest.main()
