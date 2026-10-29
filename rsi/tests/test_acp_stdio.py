"""The stdio transport, and the contracts that keep it usable.

`rsi.acp_stdio` carries ACP over a process's two pipes instead of a WebSocket,
for a client that spawns the agent as a child process. It holds no protocol
logic: every method and every answer belongs to `acp_server` and is tested
there. What is proven here is the transport, and the four properties a client
would notice if any of them broke:

- one frame in becomes one frame out, exactly one line each;
- a malformed line is reported without dropping the connection;
- a request that answers slowly does not block the next one, because the
  client's cancel arrives on the same pipe;
- end of input stops the runs that were still going.

The last case in this file starts a real process and speaks to it over its real
pipes. Everything before it runs in-process against a stand-in, which is exactly
the kind of test that stayed green while the WebSocket path dropped its first
live connection, so the gate is a spawned child and not another fake.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from rsi import acp_stdio

REPO_ROOT = Path(__file__).resolve().parent.parent


class _FakeServer:
    """Stands in for `AcpServer` without starting an engine."""

    def __init__(self) -> None:
        self.seen: list[dict] = []
        self.connections: list[str | None] = []
        self.closed = False
        self.abandoned: list[str] = []

    async def _serve_frame(self, frame: dict, send, connection=None) -> None:
        self.seen.append(frame)
        self.connections.append(connection)
        method = frame.get("method")
        if method == "echo":
            await send({"jsonrpc": "2.0", "id": frame.get("id"), "result": frame.get("params")})
            return
        if method == "stream":
            # Two frames from one request: the reason a request may not hold the
            # reader while it runs.
            await send({"jsonrpc": "2.0", "method": "session/update", "params": {"n": 1}})
            await asyncio.sleep(0)
            await send({"jsonrpc": "2.0", "method": "session/update", "params": {"n": 2}})
            await send({"jsonrpc": "2.0", "id": frame.get("id"), "result": {"ok": True}})
            return
        if method == "slow":
            await asyncio.sleep(0.05)
            await send({"jsonrpc": "2.0", "id": frame.get("id"), "result": {"slow": True}})
            return
        if method == "boom":
            raise RuntimeError("handler blew up")
        await send({"jsonrpc": "2.0", "id": frame.get("id"), "result": {}})

    async def aclose(self) -> None:
        self.closed = True

    async def _abandon(self, session) -> None:
        self.abandoned.append(session.session_id)


class _InterruptibleServer(_FakeServer):
    """A server whose prompt never finishes on its own, so EOF has to stop it.

    Models the case the WebSocket path was fixed for: the client goes away while
    a run is still working. `aclose` mirrors the real one -- it walks the live
    sessions and abandons each -- and the two facts it records are deliberately
    separate:

    * `interrupted` is set only by `_abandon`, which is the executor being told to
      stop. That path exists only because `aclose` reaches it.
    * `run_stopped` is set by the run task itself when it is cancelled.

    Keeping them apart is what makes the test mean something: cancelling the
    wrapper alone leaves a `to_thread` run going, so "the task was cancelled" is
    not the same claim as "the executor was told".
    """

    def __init__(self) -> None:
        super().__init__()
        self.sessions: list[object] = []
        self.interrupted = False
        self.run_stopped = False
        self.started = False

    async def _serve_frame(self, frame: dict, send, connection=None) -> None:
        if frame.get("method") != "prompt-forever":
            await super()._serve_frame(frame, send, connection)
            return
        session = type("S", (), {"session_id": "s-1", "tasks": []})()
        self.sessions.append(session)
        self.started = True
        task = asyncio.current_task()
        if task is not None:
            session.tasks.append(task)
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            self.run_stopped = True
            raise

    async def _abandon(self, session) -> None:
        self.interrupted = True
        await super()._abandon(session)

    async def aclose(self) -> None:
        # What the real server does: abandon every live session, then report
        # closed. It does not touch the transport's task list.
        for session in list(self.sessions):
            await self._abandon(session)
        self.closed = True


def _run(
    frames: list[bytes],
    server: _FakeServer | None = None,
    *,
    linger: float = 0.0,
) -> tuple[list[dict], _FakeServer]:
    """Feed `frames` through the transport and return what it wrote.

    `linger` keeps the input open after the last frame. End of input means the
    client is gone and cancels everything in flight, so a test about a slow
    request finishing has to model a client that is still there. The wait is
    bounded by the same deadline whether or not anything arrives, so a run with
    no slow request is not held up by it.
    """
    server = server or _FakeServer()
    lines: list[bytes] = []
    queue: list[bytes] = list(frames)
    deadline = time.monotonic() + linger

    def read_line() -> bytes | None:
        if not queue:
            remaining = deadline - time.monotonic()
            if remaining > 0:
                time.sleep(remaining)
            return None
        return queue.pop(0)

    def write_line(payload: bytes) -> None:
        lines.append(payload)

    asyncio.run(acp_stdio.StdioServer(server, read_line, write_line).serve())
    return ([json.loads(line.decode("utf-8")) for line in lines], server)


def _frame(obj: dict) -> bytes:
    return (json.dumps(obj) + "\n").encode("utf-8")


class FramingTests(unittest.TestCase):
    def test_one_request_becomes_one_line(self) -> None:
        wrote, server = _run([_frame({"jsonrpc": "2.0", "id": 1, "method": "echo",
                                      "params": {"a": 1}})])
        self.assertEqual(wrote, [{"jsonrpc": "2.0", "id": 1, "result": {"a": 1}}])
        self.assertEqual(len(server.seen), 1)

    def test_every_written_frame_ends_with_exactly_one_newline(self) -> None:
        """The client frames on newline; a missing one is an answer that never
        arrives, and two objects on one line is an answer it cannot parse."""
        lines: list[bytes] = []

        def read_line() -> bytes | None:
            return None

        def write_line(payload: bytes) -> None:
            lines.append(payload)

        server = _FakeServer()

        async def drive() -> None:
            transport = acp_stdio.StdioServer(server, read_line, write_line)
            await transport._emit({"jsonrpc": "2.0", "id": 9, "result": {}})

        asyncio.run(drive())
        self.assertEqual(len(lines), 1)
        self.assertTrue(lines[0].endswith(b"\n"))
        self.assertEqual(lines[0].count(b"\n"), 1)

    def test_a_blank_line_is_skipped_without_an_answer(self) -> None:
        """A trailing newline at exit is not a request."""
        wrote, server = _run([b"\n", b"   \n"])
        self.assertEqual(wrote, [])
        self.assertEqual(server.seen, [])

    def test_the_frames_arrive_in_the_order_they_were_read(self) -> None:
        wrote, _ = _run([
            _frame({"jsonrpc": "2.0", "id": 1, "method": "echo", "params": {"n": 1}}),
            _frame({"jsonrpc": "2.0", "id": 2, "method": "echo", "params": {"n": 2}}),
            _frame({"jsonrpc": "2.0", "id": 3, "method": "echo", "params": {"n": 3}}),
        ])
        self.assertEqual([item["id"] for item in wrote], [1, 2, 3])


class EncodingTests(unittest.TestCase):
    def test_non_ascii_survives_the_pipe(self) -> None:
        """The measured stdout encoding on this machine is gbk.

        Writing through `sys.stdout` would encode in that locale and the first
        Chinese character would produce bytes the client cannot decode -- while
        every in-process test stayed green. The transport therefore takes bytes.
        """
        wrote, _ = _run([_frame({"jsonrpc": "2.0", "id": 1, "method": "echo",
                                 "params": {"text": "中文回答 · 已完成"}})])
        self.assertEqual(wrote[0]["result"]["text"], "中文回答 · 已完成")

    def test_the_bytes_on_the_wire_are_utf8(self) -> None:
        lines: list[bytes] = []
        server = _FakeServer()

        def read_line() -> bytes | None:
            return None

        def write_line(payload: bytes) -> None:
            lines.append(payload)

        async def drive() -> None:
            transport = acp_stdio.StdioServer(server, read_line, write_line)
            await transport._emit({"jsonrpc": "2.0", "id": 1, "result": {"text": "汉"}})

        asyncio.run(drive())
        self.assertIn("汉".encode("utf-8"), lines[0])
        # Not the gbk byte sequence, which is what a text stream would have made.
        self.assertNotIn("汉".encode("gbk"), lines[0])


class RobustnessTests(unittest.TestCase):
    def test_malformed_json_is_refused_and_the_connection_continues(self) -> None:
        wrote, server = _run([
            b"this is not json\n",
            _frame({"jsonrpc": "2.0", "id": 2, "method": "echo", "params": {}}),
        ])
        self.assertEqual(wrote[0]["error"]["code"], -32700)
        self.assertEqual(wrote[1]["id"], 2)
        self.assertEqual(len(server.seen), 1)

    def test_a_non_object_frame_is_refused_rather_than_dispatched(self) -> None:
        wrote, server = _run([b"[1, 2, 3]\n"])
        self.assertEqual(wrote[0]["error"]["code"], -32600)
        self.assertEqual(server.seen, [])

    def test_a_handler_that_raises_does_not_kill_the_process(self) -> None:
        wrote, _ = _run([
            _frame({"jsonrpc": "2.0", "id": 1, "method": "boom"}),
            _frame({"jsonrpc": "2.0", "id": 2, "method": "echo", "params": {}}),
        ])
        # The failing frame produced no answer of its own; the next one still did.
        self.assertEqual([item.get("id") for item in wrote if "error" not in item], [2])

class EndOfInputTests(unittest.TestCase):
    """What happens to a run in flight when the client closes the pipe.

    The WebSocket path stops a disconnecting client's runs, because otherwise the
    executor keeps calling tools and billing tokens for a window that is gone.
    Stdin closing is the same event in this transport, and the mechanism has to
    be the same one: `aclose`, which abandons every session. A test that only
    asserted "the process exited" would pass even if nothing was stopped, because
    the process ends either way.
    """

    def test_end_of_input_closes_the_server(self) -> None:
        _wrote, server = _run([])
        self.assertTrue(server.closed)

    def test_end_of_input_stops_a_run_still_in_flight(self) -> None:
        server = _InterruptibleServer()
        wrote, _ = _run([_frame({"jsonrpc": "2.0", "id": 1, "method": "prompt-forever"})],
                        server)
        # The request never got an answer, because it never finished.
        self.assertEqual(wrote, [])
        self.assertTrue(server.started, "the prompt never started, so nothing was tested")
        self.assertTrue(server.interrupted, "shutdown did not interrupt the executor")
        self.assertTrue(server.run_stopped, "the run was still going after shutdown")

    def test_shutdown_waits_for_the_run_to_stop(self) -> None:
        """`aclose` awaits, so the executor is released after nothing is running.

        A shutdown that only queued the cancellation would return while the run
        was still producing output, and the executor would be stopped underneath
        a thread that had not noticed.
        """
        server = _InterruptibleServer()
        _run([_frame({"jsonrpc": "2.0", "id": 1, "method": "prompt-forever"})], server)
        self.assertTrue(server.run_stopped)

    def test_a_client_that_sends_nothing_still_shuts_down_cleanly(self) -> None:
        _wrote, server = _run([])
        self.assertTrue(server.closed)
        self.assertEqual(server.abandoned, [])


class ConcurrencyTests(unittest.TestCase):
    def test_a_slow_request_does_not_block_the_next_one(self) -> None:
        """The client's cancel arrives on the same pipe as everything else.

        A reader that waited for a prompt to finish would never reach it, so the
        cancel could never take effect -- the failure is silent and looks like a
        stop button that does nothing.

        The input lingers after the last frame because end of input means the
        client has gone, and leaving cancels every run still going. What is being
        measured here is that the second request is answered while the first is
        still in flight, which needs a client that is still attached.
        """
        wrote, _ = _run(
            [
                _frame({"jsonrpc": "2.0", "id": 1, "method": "slow"}),
                _frame({"jsonrpc": "2.0", "id": 2, "method": "echo", "params": {}}),
            ],
            linger=0.4,
        )
        ids = [item.get("id") for item in wrote]
        self.assertIn(1, ids)
        self.assertIn(2, ids)
        # The quick one is answered first: that is the whole point.
        self.assertEqual(ids, [2, 1])

    def test_one_request_may_produce_several_frames(self) -> None:
        wrote, _ = _run([_frame({"jsonrpc": "2.0", "id": 5, "method": "stream"})])
        self.assertEqual([item.get("method") for item in wrote[:2]], ["session/update"] * 2)
        self.assertEqual(wrote[2]["id"], 5)

    def test_writes_from_two_requests_do_not_interleave(self) -> None:
        """Two prompts writing at once must not weave their bytes into one line."""
        lines: list[bytes] = []
        server = _FakeServer()

        def read_line() -> bytes | None:
            return None

        def write_line(payload: bytes) -> None:
            # A byte-at-a-time sink: interleaving would show up as a broken line.
            for index in range(0, len(payload), 7):
                lines.append(payload[index:index + 7])

        async def drive() -> None:
            transport = acp_stdio.StdioServer(server, read_line, write_line)
            await asyncio.gather(
                transport._emit({"jsonrpc": "2.0", "method": "u", "params": {"n": 1}}),
                transport._emit({"jsonrpc": "2.0", "method": "u", "params": {"n": 2}}),
            )

        asyncio.run(drive())
        whole = b"".join(lines)
        self.assertEqual(whole.count(b"\n"), 2)
        for line in whole.split(b"\n"):
            if line:
                json.loads(line.decode("utf-8"))

    def test_the_connection_token_reaches_the_dispatch(self) -> None:
        _wrote, server = _run([_frame({"jsonrpc": "2.0", "id": 1, "method": "echo"})])
        self.assertEqual(server.connections, [acp_stdio.CONNECTION])


class HomeTests(unittest.TestCase):
    def test_an_explicit_home_wins(self) -> None:
        self.assertEqual(acp_stdio.engine_home(Path("/tmp/home")), Path("/tmp/home"))

    def test_the_home_falls_back_to_the_store(self) -> None:
        """A client's `env` can name the store, so `args` need not hardcode a path."""
        with tempfile.TemporaryDirectory() as tmp:
            store = Path(tmp) / "store"
            (Path(tmp) / "engine-home").mkdir()
            self.assertEqual(acp_stdio.engine_home(store=store), Path(tmp) / "engine-home")

    def test_the_store_defaults_to_the_environment(self) -> None:
        import os

        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "engine-home").mkdir()
            old = os.environ.get("RSI_STORE")
            os.environ["RSI_STORE"] = str(Path(tmp) / "store")
            try:
                self.assertEqual(acp_stdio.engine_home(), Path(tmp) / "engine-home")
            finally:
                if old is None:
                    os.environ.pop("RSI_STORE", None)
                else:
                    os.environ["RSI_STORE"] = old


class SpawnedProcessTests(unittest.TestCase):
    """The gate: a real child process, its real pipes, a whole round trip.

    In-process tests are what stayed green while the WebSocket path dropped its
    first live connection, because they called the dispatch directly and never
    crossed a transport. This case crosses one: it starts the module as a
    program, writes a request into its stdin, and reads what its stdout produces.
    """

    def _spawn(self, home: Path, *, fake: bool = False) -> subprocess.Popen:
        """Start the transport as a program, on real pipes.

        `fake=True` runs `tests/acp_stdio_gate.py`, which calls the same
        `serve_stdio` with a stand-in executor instead of the OpenHands one. The
        production entry point has no hook for that on purpose, so the gate uses
        its own launcher rather than a seam that would ship.
        """
        if fake:
            command = [sys.executable, str(Path(__file__).resolve().parent / "acp_stdio_gate.py"),
                       str(home)]
        else:
            command = [sys.executable, "-m", "rsi.acp_stdio", "--home", str(home)]
        return subprocess.Popen(
            command,
            cwd=str(REPO_ROOT),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def _round_trip(self, proc: subprocess.Popen, requests: list[dict],
                    until_id: object) -> tuple[list[dict], bytes]:
        """Send requests, read frames until the answer to `until_id` arrives."""
        for request in requests:
            assert proc.stdin is not None
            proc.stdin.write((json.dumps(request) + "\n").encode("utf-8"))
            proc.stdin.flush()

        frames: list[dict] = []
        assert proc.stdout is not None
        while True:
            line = proc.stdout.readline()
            if not line:
                break
            frames.append(json.loads(line.decode("utf-8")))
            if any(frame.get("id") == until_id for frame in frames):
                break
        assert proc.stderr is not None
        return frames, proc.stderr.read(0)

    def test_a_child_process_answers_a_whole_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "engine-home"
            home.mkdir()
            proc = self._spawn(home)
            try:
                frames, _ = self._round_trip(
                    proc,
                    [
                        {"jsonrpc": "2.0", "id": 0, "method": "initialize",
                         "params": {"protocolVersion": 1, "clientCapabilities": {},
                                    "clientInfo": {"name": "openbitfun-desktop",
                                                   "version": "0.0.0"}}},
                        {"jsonrpc": "2.0", "id": 1, "method": "session/new",
                         "params": {"cwd": str(Path(tmp) / "work"), "mcpServers": []}},
                    ],
                    until_id=1,
                )
                self.assertEqual(frames[0]["id"], 0)
                self.assertEqual(frames[0]["result"]["protocolVersion"], 1)
                self.assertIn("agentCapabilities", frames[0]["result"])
                self.assertEqual(frames[1]["id"], 1)
                self.assertTrue(frames[1]["result"]["sessionId"])
            finally:
                proc.kill()
                proc.wait(timeout=10)

    def test_the_child_survives_a_malformed_line_and_keeps_answering(self) -> None:
        """A client that sends one bad frame must not lose the agent."""
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "engine-home"
            home.mkdir()
            proc = self._spawn(home)
            try:
                assert proc.stdin is not None
                proc.stdin.write(b"}{ not json\n")
                proc.stdin.flush()
                assert proc.stdout is not None
                first = json.loads(proc.stdout.readline().decode("utf-8"))
                self.assertEqual(first["error"]["code"], -32700)

                frames, _ = self._round_trip(
                    proc,
                    [{"jsonrpc": "2.0", "id": 2, "method": "initialize",
                      "params": {"protocolVersion": 1}}],
                    until_id=2,
                )
                self.assertEqual(frames[0]["id"], 2)
            finally:
                proc.kill()
                proc.wait(timeout=10)

    def test_stdout_carries_frames_and_nothing_else(self) -> None:
        """A banner printed to stdout would be read as a frame by the client."""
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "engine-home"
            home.mkdir()
            proc = self._spawn(home)
            try:
                frames, _ = self._round_trip(
                    proc,
                    [{"jsonrpc": "2.0", "id": 1, "method": "initialize",
                      "params": {"protocolVersion": 1}}],
                    until_id=1,
                )
                self.assertEqual(len(frames), 1)
                self.assertIn("result", frames[0])
            finally:
                proc.kill()
                proc.wait(timeout=10)

    def test_a_child_process_drives_a_whole_prompt(self) -> None:
        """The gate the sibling cases cannot be: a spawned process, one full turn.

        initialize is the easiest thing to get right, so it proves the pipes are
        wired and nothing more. This sends a prompt and reads the whole relayed
        turn back -- thought chunk, tool call, tool result, answer -- from a
        process the test started, over the pipes it owns.
        """
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "engine-home"
            home.mkdir()
            work = Path(tmp) / "work"
            work.mkdir()
            proc = self._spawn(home, fake=True)
            try:
                frames, _ = self._round_trip(
                    proc,
                    [
                        {"jsonrpc": "2.0", "id": 0, "method": "initialize",
                         "params": {"protocolVersion": 1, "clientCapabilities": {},
                                    "clientInfo": {"name": "openbitfun-desktop",
                                                   "version": "0.0.0"}}},
                        {"jsonrpc": "2.0", "id": 1, "method": "session/new",
                         "params": {"cwd": str(work), "mcpServers": []}},
                    ],
                    until_id=1,
                )
                session_id = frames[1]["result"]["sessionId"]

                turn, _ = self._round_trip(
                    proc,
                    [{"jsonrpc": "2.0", "id": 2, "method": "session/prompt",
                      "params": {"sessionId": session_id,
                                 "prompt": [{"type": "text", "text": "hello"}]}}],
                    until_id=2,
                )

                updates = [f["params"]["update"] for f in turn
                           if f.get("method") == "session/update"]
                kinds = [u["sessionUpdate"] for u in updates]
                self.assertEqual(
                    kinds,
                    ["agent_thought_chunk", "tool_call", "tool_call_update",
                     "agent_message_chunk"],
                )
                self.assertEqual(updates[0]["content"]["text"], "considering")
                self.assertEqual(updates[1]["toolCallId"], updates[2]["toolCallId"])
                self.assertEqual(updates[3]["content"]["text"], "FAKE-ANSWER hello")
                # The answer is the last frame on the request, and nothing was
                # sent twice: the relay suppresses a final line already carried
                # by a message chunk.
                self.assertEqual(turn[-1]["id"], 2)
                self.assertEqual(turn[-1]["result"]["stopReason"], "end_turn")
                self.assertEqual(
                    [u["content"]["text"] for u in updates
                     if u["sessionUpdate"] == "agent_message_chunk"],
                    ["FAKE-ANSWER hello"],
                )
            finally:
                proc.kill()
                proc.wait(timeout=10)

    def test_closing_stdin_ends_a_real_child_process_cleanly(self) -> None:
        """The gate for the shutdown path, on a real pipe.

        The in-process cases prove the transport calls `aclose`; this proves a
        spawned child does it and then exits on its own rather than hanging or
        dying with a traceback. A child that needed killing would leave the
        executor's thread behind on a machine where nobody is watching.
        """
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "engine-home"
            home.mkdir()
            proc = self._spawn(home, fake=True)
            try:
                frames, _ = self._round_trip(
                    proc,
                    [{"jsonrpc": "2.0", "id": 1, "method": "initialize",
                      "params": {"protocolVersion": 1}}],
                    until_id=1,
                )
                self.assertEqual(frames[0]["id"], 1)

                assert proc.stdin is not None
                proc.stdin.close()
                code = proc.wait(timeout=20)
                self.assertEqual(code, 0, "the child did not exit cleanly on EOF")
                assert proc.stderr is not None
                noise = proc.stderr.read().decode("utf-8", "replace")
                self.assertNotIn("Traceback", noise)
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait(timeout=10)

    def test_a_prompt_streams_before_the_request_is_answered(self) -> None:
        """Updates arrive while the run is going, not batched after it.

        That is what lets the window draw the agent working. A relay that only
        answered at the end would look identical in a transcript.
        """
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "engine-home"
            home.mkdir()
            work = Path(tmp) / "work"
            work.mkdir()
            proc = self._spawn(home, fake=True)
            try:
                frames, _ = self._round_trip(
                    proc,
                    [{"jsonrpc": "2.0", "id": 0, "method": "initialize",
                      "params": {"protocolVersion": 1}},
                     {"jsonrpc": "2.0", "id": 1, "method": "session/new",
                      "params": {"cwd": str(work), "mcpServers": []}}],
                    until_id=1,
                )
                session_id = frames[1]["result"]["sessionId"]
                turn, _ = self._round_trip(
                    proc,
                    [{"jsonrpc": "2.0", "id": 2, "method": "session/prompt",
                      "params": {"sessionId": session_id,
                                 "prompt": [{"type": "text", "text": "x"}]}}],
                    until_id=2,
                )
                first_update = next(i for i, f in enumerate(turn)
                                    if f.get("method") == "session/update")
                answer = next(i for i, f in enumerate(turn) if f.get("id") == 2)
                self.assertLess(first_update, answer)
                self.assertGreaterEqual(answer, 3)
            finally:
                proc.kill()
                proc.wait(timeout=10)


if __name__ == "__main__":
    unittest.main()
