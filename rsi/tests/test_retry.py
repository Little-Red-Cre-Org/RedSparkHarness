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

"""A retry belongs to the network, not to the request.

Posting a chat completion can fail in two ways that look alike from the caller
and must be handled oppositely: the network dropped the call (retrying the same
bytes is likely to work) or the request was refused (retrying spends the wait
twice and still fails). These tests pin the difference down with a local server,
so the rule is enforced without a model endpoint.
"""

from __future__ import annotations

import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rsi.agent import Agent, _Transient


class _Scripted(BaseHTTPRequestHandler):
    """Answers with whatever the test queued, and counts the attempts."""

    codes: list[int] = []
    seen = 0
    payload = {"choices": [{"message": {"content": "ok"}}]}
    lock = threading.Lock()

    def do_POST(self):  # noqa: N802 - the name is fixed by http.server
        length = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(length)
        with _Scripted.lock:
            _Scripted.seen += 1
            code = _Scripted.codes[min(_Scripted.seen - 1, len(_Scripted.codes) - 1)]
        body = json.dumps(_Scripted.payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


class RetryTests(unittest.TestCase):
    def setUp(self) -> None:
        _Scripted.codes = [200]
        _Scripted.seen = 0
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Scripted)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.thread.join, 3)
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)
        self.url = "http://127.0.0.1:" + str(self.httpd.server_address[1])

    def agent(self, retries: int = 2) -> Agent:
        # No sleeping between attempts: the backoff is real behaviour, but
        # waiting it out makes the suite slower without testing anything more.
        a = Agent(base_url=self.url, model="fake/model", retries=retries)
        a._sleep = lambda _s: None
        return a

    def test_a_5xx_is_retried_until_it_works(self):
        _Scripted.codes = [500, 503, 200]
        a = self.agent()
        a._post({"model": "m", "messages": []})
        self.assertEqual(_Scripted.seen, 3)

    def test_a_429_is_retried(self):
        _Scripted.codes = [429, 200]
        a = self.agent()
        a._post({"model": "m", "messages": []})
        self.assertEqual(_Scripted.seen, 2)

    def test_a_4xx_is_not_retried(self):
        _Scripted.codes = [400]
        a = self.agent()
        with self.assertRaises(RuntimeError) as ctx:
            a._post({"model": "m", "messages": []})
        self.assertEqual(_Scripted.seen, 1, "a 400 is the request's fault, not the network's")
        self.assertNotIsInstance(ctx.exception, _Transient)

    def test_retries_are_bounded(self):
        _Scripted.codes = [500]
        a = self.agent(retries=2)
        with self.assertRaises(RuntimeError):
            a._post({"model": "m", "messages": []})
        self.assertEqual(_Scripted.seen, 3, "two retries means three attempts, then stop")

    def test_retries_can_be_turned_off(self):
        _Scripted.codes = [500]
        a = self.agent(retries=0)
        with self.assertRaises(RuntimeError):
            a._post({"model": "m", "messages": []})
        self.assertEqual(_Scripted.seen, 1)

    def test_every_retry_is_announced(self):
        _Scripted.codes = [500, 502, 200]
        a = self.agent()
        heard: list[tuple[int, int]] = []
        a._on_retry = lambda n, total, _why: heard.append((n, total))
        a._post({"model": "m", "messages": []})
        self.assertEqual(heard, [(1, 3), (2, 3)])

    def test_an_unreachable_service_is_transient(self):
        """Nothing listening must be classified as the network, not the request.

        Asserting only "it raises" would pass just as well if an unreachable
        port were treated as permanent, because retries=1 gives up either way.
        The retry notice is what distinguishes them: it fires only when the
        failure was judged worth retrying.
        """
        a = Agent(base_url="http://127.0.0.1:9", model="fake/model", retries=1)
        a._sleep = lambda _s: None
        heard: list[tuple[int, int]] = []
        a._on_retry = lambda n, total, _why: heard.append((n, total))
        with self.assertRaises(RuntimeError):
            a._post({"model": "m", "messages": []})
        self.assertEqual(heard, [(1, 2)], "an unreachable endpoint must be retried once")


if __name__ == "__main__":
    unittest.main()
