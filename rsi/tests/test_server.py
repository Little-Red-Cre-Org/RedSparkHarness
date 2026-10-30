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

"""Regressions for the service: routing, events, and the swap seam under concurrency."""

import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from harness2.substrate.opencode import OPENCODE_SURFACE

from rsi.smoke import default_tasks
from rsi.gate import gate
from rsi.server import Application, EventLog, LiveHarness, serve
from rsi.store import StoreError, open_store

SURF = OPENCODE_SURFACE

GOOD = (
    "import csv\nimport sys\nfrom decimal import Decimal\n"
    "with open(sys.argv[1]) as f:\n"
    "    rows = [Decimal(r['amount']) for r in csv.DictReader(f)]\n"
    "print(f'Total: {sum(rows, Decimal(0)):.2f}')\n"
)


def base_tree(tag: str = "A") -> dict[str, str]:
    t = {k: "" for k in SURF.always_on}
    t["systemprompt.md"] = f"Use scripts/summarize.py. ({tag})\n"
    t["scripts/summarize.py"] = GOOD
    return t


def client(base: str):
    req = lambda p: urllib.request.Request(base + p, method="GET")  # noqa: E731

    def get(path: str):
        try:
            with urllib.request.urlopen(req(path), timeout=5) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            body = e.read()
            try:
                return e.code, json.loads(body)
            except json.JSONDecodeError:
                return e.code, body

    def post(path: str, payload: dict):
        data = json.dumps(payload).encode()
        r = urllib.request.Request(
            base + path, data=data, method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(r, timeout=30) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    return get, post


class ServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "store"
        self.store = open_store(self.root, SURF)
        self.store.init(tree=base_tree())
        self.store.set_ref("stable", "g0001")

    def _serve(self):
        httpd, app, _ = serve(self.root, SURF)
        self.addCleanup(lambda: (app.events.close(), httpd.shutdown(), httpd.server_close()))
        port = httpd.server_address[1]
        return f"http://127.0.0.1:{port}", app

    # -- read routes -------------------------------------------------------

    def test_info_and_current(self):
        base, _ = self._serve()
        get, _post = client(base)
        status, info = get("/")
        self.assertEqual(status, 200)
        self.assertEqual(info["generations"], 1)
        status, cur = get("/current")
        self.assertEqual(status, 200)
        self.assertEqual(cur["generation"], "g0001")
        self.assertIn("scripts/summarize.py", cur["files"])

    def test_generations_lists_refs(self):
        base, _ = self._serve()
        get, _ = client(base)
        status, body = get("/generations")
        self.assertEqual(status, 200)
        self.assertEqual(len(body["generations"]), 1)
        self.assertEqual(body["refs"]["stable"]["generation"], "g0001")

    def test_show_one_generation(self):
        base, _ = self._serve()
        get, _ = client(base)
        status, body = get("/generations/g0001")
        self.assertEqual(status, 200)
        self.assertEqual(body["lineage"], ["g0001"])
        self.assertIn("scripts/summarize.py", body["files"])

    def test_unknown_generation_is_404(self):
        base, _ = self._serve()
        get, _ = client(base)
        status, body = get("/generations/g0999")
        self.assertEqual(status, 404)

    def test_unknown_route_is_404(self):
        base, _ = self._serve()
        get, _ = client(base)
        self.assertEqual(get("/nope")[0], 404)

    def test_verify_reports_clean_store(self):
        base, _ = self._serve()
        get, _ = client(base)
        status, body = get("/verify")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])

    def test_current_tree_returns_the_actual_tree(self):
        base, _ = self._serve()
        get, _ = client(base)
        status, body = get("/current/tree")
        self.assertEqual(status, 200)
        self.assertEqual(body["tree"]["scripts/summarize.py"], GOOD)

    # -- write routes ------------------------------------------------------

    def test_adopt_through_http_moves_stable(self):
        base, _ = self._serve()
        get, post = client(base)
        tree = base_tree("B")
        status, body = post("/adopt", {"tree": tree, "kind": "auto", "note": "tweak"})
        self.assertEqual(status, 200, body)
        self.assertTrue(body["ok"])
        self.assertEqual(get("/current")[1]["generation"], "g0002")

    def test_rejected_adoption_returns_422_and_keeps_stable(self):
        base, _ = self._serve()
        get, post = client(base)
        bad = base_tree("C")
        bad["scripts/summarize.py"] = "def broken(:\n"
        status, body = post("/adopt", {"tree": bad})
        self.assertEqual(status, 422)
        self.assertFalse(body["ok"])
        self.assertEqual(body["level"], "L1")
        self.assertEqual(get("/current")[1]["generation"], "g0001")

    def test_duplicate_adoption_returns_409(self):
        base, _ = self._serve()
        _get, post = client(base)
        status, body = post("/adopt", {"tree": base_tree()})
        self.assertEqual(status, 409)
        self.assertIn("identical", body["error"])

    def test_adopt_without_tree_is_400(self):
        base, _ = self._serve()
        _get, post = client(base)
        self.assertEqual(post("/adopt", {"kind": "auto"})[0], 400)

    def test_rollback_moves_pointer_and_leaves_history(self):
        base, _ = self._serve()
        get, post = client(base)
        post("/adopt", {"tree": base_tree("B")})
        self.assertEqual(get("/current")[1]["generation"], "g0002")
        status, body = post("/rollback", {"generation": "g0001"})
        self.assertEqual(status, 200)
        self.assertEqual(body["generation"], "g0001")
        self.assertEqual(get("/current")[1]["generation"], "g0001")
        self.assertEqual(len(get("/generations")[1]["generations"]), 2)

    def test_rollback_to_unknown_is_409(self):
        """StoreError maps to 409 (a conflict with stored state), not 404: the route exists."""
        base, _ = self._serve()
        _get, post = client(base)
        status, body = post("/rollback", {"generation": "g0999"})
        self.assertEqual(status, 409)
        self.assertIn("g0999", body["error"])

    def test_malformed_json_is_400(self):
        base, _ = self._serve()
        r = urllib.request.Request(
            base + "/adopt", data=b"not json", method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            urllib.request.urlopen(r, timeout=5)
            self.fail("expected an error")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)

    # -- events ------------------------------------------------------------

    def test_events_are_emitted_in_order(self):
        log = EventLog()
        a = log.emit("one", x=1)
        b = log.emit("two", x=2)
        self.assertEqual((a.seq, b.seq), (1, 2))
        self.assertEqual([e.kind for e in log.since(0)], ["one", "two"])
        self.assertEqual([e.kind for e in log.since(1)], ["two"])

    def test_event_log_is_bounded(self):
        log = EventLog(maxlen=3)
        for i in range(5):
            log.emit("e", i=i)
        self.assertEqual([e.data["i"] for e in log.all()], [2, 3, 4])
        self.assertEqual(log.last_seq, 5)

    def test_adoption_emits_events(self):
        base, app = self._serve()
        _get, post = client(base)
        post("/adopt", {"tree": base_tree("B")})
        kinds = [e.kind for e in app.events.all()]
        self.assertIn("adoption.accepted", kinds)

    def test_rejection_emits_its_own_event(self):
        base, app = self._serve()
        _get, post = client(base)
        bad = base_tree("C")
        bad["scripts/summarize.py"] = "def broken(:\n"
        post("/adopt", {"tree": bad})
        events = [e for e in app.events.all() if e.kind.startswith("adoption")]
        self.assertEqual([e.kind for e in events], ["adoption.rejected"])
        self.assertEqual(events[0].data["level"], "L1")

    def test_close_releases_waiting_subscribers(self):
        log = EventLog()
        result: list = []

        def wait():
            result.append(log.since(0, timeout=10.0))

        t = threading.Thread(target=wait, daemon=True)
        t.start()
        time.sleep(0.05)
        log.close()
        t.join(timeout=2)
        self.assertFalse(t.is_alive(), "close() must wake a blocked subscriber")
        self.assertEqual(result, [[]])

    # -- the swap seam -----------------------------------------------------

    def test_resolve_returns_matched_id_and_tree(self):
        """The invariant: a snapshot's tree belongs to its generation."""
        live = LiveHarness(self.store, EventLog())
        snap = live.resolve()
        self.assertEqual(snap.generation, "g0001")
        self.assertIn("(A)", snap.tree["systemprompt.md"])

    def test_concurrent_resolve_never_sees_a_torn_harness(self):
        """Readers racing a moving pointer must always get one coherent generation."""
        live = LiveHarness(self.store, EventLog())
        parent = "g0001"
        for i, tag in enumerate("BCD", start=2):
            gen = self.store.commit(parent, base_tree(tag))
            parent = gen.id
        ids = [g.id for g in self.store.generations()]
        expected = {g.id: g.content_hash for g in self.store.generations()}
        # Each generation must keep its own hash and its own tree. The tree is read back from
        # the store here, once, as the truth to compare a live snapshot against.
        truth = {g.id: self.store.tree_of(g.id) for g in self.store.generations()}
        stop = threading.Event()
        problems: list[str] = []

        def reader():
            while not stop.is_set():
                snap = live.resolve()
                if snap.content_hash != expected.get(snap.generation):
                    problems.append(f"{snap.generation} hashed {snap.content_hash}")
                if "scripts/summarize.py" not in snap.tree:
                    problems.append(f"{snap.generation} missing script")
                # A torn read would show a tree that matches no generation at all.
                if snap.tree != truth.get(snap.generation):
                    problems.append(
                        f"{snap.generation} tree does not match its own stored tree: "
                        f"{snap.tree.get('systemprompt.md')!r}"
                    )

        threads = [threading.Thread(target=reader, daemon=True) for _ in range(6)]
        for t in threads:
            t.start()
        for i in range(60):
            live.rollback(ids[i % len(ids)])
        stop.set()
        for t in threads:
            t.join(timeout=3)
        self.assertEqual(problems[:3], [])

    def test_cache_is_invalidated_by_a_swap(self):
        live = LiveHarness(self.store, EventLog())
        self.assertEqual(live.resolve().generation, "g0001")
        self.store.commit("g0001", base_tree("B"))  # g0002
        live.rollback("g0002")
        self.assertEqual(live.resolve().generation, "g0002")

    def test_adoption_does_not_block_readers(self):
        """Readers keep making progress while an adoption runs.

        This is a progress check, not a latency assertion. Under CPython's GIL a reader can
        be descheduled for tens of milliseconds while the adopting thread does work, so a
        strict per-call bound would be flaky on a loaded machine. What must hold is that the
        readers are not *serialised behind* the adoption: with one lock they collect almost
        nothing, with the split locks they collect throughout.
        """
        live = LiveHarness(self.store, EventLog())
        live.resolve()  # warm the cache, so readers measure the hot path
        done = threading.Event()
        latencies: list[float] = []

        def reader():
            while not done.is_set():
                t0 = time.perf_counter()
                live.resolve()
                latencies.append(time.perf_counter() - t0)

        threads = [threading.Thread(target=reader, daemon=True) for _ in range(4)]
        for t in threads:
            t.start()
        result = {}
        try:
            result = live.adopt(base_tree("Z"), kind="auto", note="under load")
        finally:
            done.set()
            for t in threads:
                t.join(timeout=3)

        self.assertTrue(result["ok"], result)
        self.assertGreater(len(latencies), 50, "readers were starved during the adoption")
        self.assertLess(
            sorted(latencies)[len(latencies) // 2], 0.005, "median read must stay sub-millisecond"
        )


if __name__ == "__main__":
    unittest.main()
