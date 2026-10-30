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

"""The service must not accept work it cannot do.

POST /run answered 202 for any task, in about a millisecond, whether or not the
service had any way to execute one. A service started for reads only -- or an
attached client whose server never installed an executor -- therefore accepted a
run and failed it in a background thread, and the client only found out if it
thought to poll. Accepting work and dropping it is worse than refusing it: the
client can act on a refusal and can only watch a silent failure.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from harness2.substrate.opencode import OPENCODE_SURFACE
from rsi.server import serve
from rsi.store import open_store

SURF = OPENCODE_SURFACE


def post(base: str, path: str, payload: dict):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        base + path, data=data, method="POST", headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, body


class RunAdmissionTests(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "store"
        store = open_store(self.root, SURF)
        store.init(tree={"systemprompt.md": "x\n"})
        store.set_ref("stable", "g0001")
        self.httpd, self.app, _ = serve(self.root, SURF, store=store)
        self.addCleanup(
            lambda: (self.app.events.close(), self.httpd.shutdown(), self.httpd.server_close())
        )
        self.base = "http://127.0.0.1:" + str(self.httpd.server_address[1])

    def test_a_service_without_an_executor_refuses_a_run(self):
        self.assertIsNone(self.app.executor)
        status, body = post(self.base, "/run", {"task": "do something"})
        self.assertEqual(
            status, 409, "a service that cannot run a task must say so, not accept it"
        )
        self.assertIn("executor", str(body))

    def test_a_refused_run_does_not_leave_a_record(self):
        post(self.base, "/run", {"task": "do something"})
        self.assertEqual(self.app.runs, {}, "nothing was started, so nothing is tracked")

    def test_a_service_with_an_executor_accepts_a_run(self):
        self.app.executor = lambda task, emit, session, model: self._done()
        status, body = post(self.base, "/run", {"task": "do something"})
        self.assertEqual(status, 202)
        self.assertIn("run", body)

    def test_an_unknown_session_is_refused_up_front(self):
        from rsi.sessions import SessionStore

        self.app.sessions = SessionStore(Path(tempfile.mkdtemp()))
        self.app.executor = lambda task, emit, session, model: self._done()
        status, body = post(self.base, "/run", {"task": "x", "session": "nope"})
        self.assertEqual(status, 404, "an unknown session must fail now, not in the worker")
        self.assertIn("no such session", str(body))

    def _done(self):
        class R:
            id = "srun1"
            final = "ok"
            ok = True

        return R()


if __name__ == "__main__":
    unittest.main()
