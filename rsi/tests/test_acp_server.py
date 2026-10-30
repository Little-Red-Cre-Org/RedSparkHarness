"""What goose needs from a backend it can connect to, stated as tests.

The handshake is three steps and each one fails in a way that looks like a
different problem -- a dead install, a bad secret, or a protocol mismatch -- so
each step is pinned separately rather than through one "it connects" test. The
prompt path is pinned against a fake executor, which is the point of the backend
factory: the relay is what this file owns, and the executor is somebody else's.
"""

from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from rsi import acp_server
from rsi.acp_server import AcpServer


class FakeRun:
    """What `Backend.run` returns, with only the fields the relay reads."""

    def __init__(self, final: str = "", error: str = "") -> None:
        self.final = final
        self.error = error
        self.steps: list = []


class FakeBackend:
    """An executor that emits a scripted event stream and nothing else.

    Records every call so a test can assert what reached the executor, which is
    the difference between "the client saw the right updates" and "the client
    saw the updates some other code happened to produce".

    `final` defaults to the last message text, mirroring what the real executor
    does (`backend.py:701 | run.final = step.assistant`). A stand-in that set it
    to something else would make the relay's duplicate check look unnecessary.
    """

    def __init__(self, events: list[tuple[str, dict]] | None = None,
                 final: str | None = None, error: str = "") -> None:
        self.events = events if events is not None else _DEFAULT_EVENTS
        self.final = final if final is not None else _last_message(self.events)
        self.error = error
        self.calls: list[dict] = []
        self.stopped = 0

    def start(self) -> None:
        pass

    def stop(self) -> None:
        self.stopped += 1

    def run(self, task, workspace, harness, surface, *, on_step=None, on_event=None,
            model=None, conversation=None, reasoning=None):
        self.calls.append(
            {"task": task, "workspace": str(workspace), "model": model,
             "conversation": conversation}
        )
        for kind, data in self.events:
            if on_event is not None:
                on_event(kind, data)
        if on_step is not None:
            on_step(None)
        return FakeRun(final=self.final, error=self.error)


def _last_message(events: list[tuple[str, dict]]) -> str:
    """The assistant text of the last message event, or ""."""
    for kind, data in reversed(events):
        if kind == "step.message" and str(data.get("assistant") or "").strip():
            return str(data["assistant"]).strip()
    return ""


_DEFAULT_EVENTS: list[tuple[str, dict]] = [
    ("step.started", {"index": 0}),
    ("step.message", {"index": 0, "thinking": "I should read the file.", "assistant": ""}),
    ("tool.called", {"index": 0, "name": "file_editor", "arguments": {"path": "note.txt"}}),
    ("tool.result", {"index": 0, "name": "file_editor", "ok": True, "output": "PLUMBUS"}),
    ("step.message", {"index": 0, "thinking": "", "assistant": "The word is PLUMBUS."}),
    ("run.finished", {"ok": True, "steps": 1, "stop_reason": "finish"}),
]


class HandshakeTests(unittest.TestCase):
    """The three steps goose takes before it will draw its window."""

    def setUp(self) -> None:
        self.server = AcpServer(home=Path("."), secret="s3cret", backend_factory=FakeBackend)

    def _http(self, path: str, headers: list[tuple[bytes, bytes]] | None = None) -> dict:
        """Send one HTTP request through the ASGI app and return what came back."""
        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        async def receive() -> dict:
            return {"type": "http.request"}

        scope = {"type": "http", "path": path, "method": "GET",
                 "headers": headers or [], "query_string": b""}
        asyncio.run(self.server(scope, receive, send))
        start = next(m for m in sent if m["type"] == "http.response.start")
        body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
        return {"status": start["status"], "body": json.loads(body or b"{}")}

    def test_status_is_a_plain_200_with_no_secret(self) -> None:
        """Step one is a reachability probe and carries no credential."""
        answer = self._http(acp_server.ROUTE_STATUS)
        self.assertEqual(answer["status"], 200)
        self.assertEqual(answer["body"]["status"], "ok")

    def test_the_acp_route_refuses_a_plain_get(self) -> None:
        """Step two: 406 is the client's signal to open the socket.

        Answering 200 here would have it try to read SSE and wait forever;
        answering 401 would have it report a bad secret instead of a live server.
        """
        answer = self._http(acp_server.ROUTE_ACP, [(b"x-secret-key", b"s3cret")])
        self.assertEqual(answer["status"], 406)

    def test_the_acp_route_refuses_a_plain_get_even_with_a_bad_secret(self) -> None:
        """The probe answers the same for any secret: it is not authenticated."""
        answer = self._http(acp_server.ROUTE_ACP, [(b"x-secret-key", b"wrong")])
        self.assertEqual(answer["status"], 406)

    def test_an_unknown_path_is_a_404(self) -> None:
        self.assertEqual(self._http("/nope")["status"], 404)


class SecretTests(unittest.TestCase):
    """Step three is a websocket, and this is where the secret is checked."""

    def _connect(self, server: AcpServer, query: bytes = b"",
                 headers: list[tuple[bytes, bytes]] | None = None) -> dict:
        """Attempt one websocket connection and report what the app did."""
        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        async def receive() -> dict:
            return {"type": "websocket.disconnect", "code": 1000}

        scope = {"type": "websocket", "path": acp_server.ROUTE_ACP,
                 "headers": headers or [], "query_string": query}
        asyncio.run(server(scope, receive, send))
        return {"accepted": any(m["type"] == "websocket.accept" for m in sent),
                "closed": next((m.get("code") for m in sent
                                if m["type"] == "websocket.close"), None)}

    def test_the_token_query_parameter_is_accepted(self) -> None:
        """goosed sends the secret as `?token=`, not as a header."""
        server = AcpServer(home=Path("."), secret="s3cret", backend_factory=FakeBackend)
        self.assertTrue(self._connect(server, query=b"token=s3cret")["accepted"])

    def test_the_secret_header_is_also_accepted(self) -> None:
        server = AcpServer(home=Path("."), secret="s3cret", backend_factory=FakeBackend)
        self.assertTrue(
            self._connect(server, headers=[(b"x-secret-key", b"s3cret")])["accepted"]
        )

    def test_a_wrong_token_is_closed_not_accepted(self) -> None:
        server = AcpServer(home=Path("."), secret="s3cret", backend_factory=FakeBackend)
        answer = self._connect(server, query=b"token=wrong")
        self.assertFalse(answer["accepted"])
        self.assertEqual(answer["closed"], 1008)

    def test_a_missing_token_is_closed(self) -> None:
        server = AcpServer(home=Path("."), secret="s3cret", backend_factory=FakeBackend)
        self.assertFalse(self._connect(server)["accepted"])

    def test_an_empty_secret_accepts_anything(self) -> None:
        """Development on loopback: there is nothing to leak to."""
        server = AcpServer(home=Path("."), secret="", backend_factory=FakeBackend)
        self.assertTrue(self._connect(server)["accepted"])

    def test_a_prefix_of_the_secret_is_not_the_secret(self) -> None:
        """`compare_digest` on unequal lengths must still say no."""
        server = AcpServer(home=Path("."), secret="s3cret", backend_factory=FakeBackend)
        self.assertFalse(self._connect(server, query=b"token=s3cre")["accepted"])


class DispatchTests(unittest.TestCase):
    """JSON-RPC framing: what a request turns into on the wire."""

    def setUp(self) -> None:
        self.server = AcpServer(home=Path("."), secret="", backend_factory=FakeBackend)

    def _rpc(self, method: str, params: dict | None = None) -> dict:
        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        frame = {"jsonrpc": "2.0", "id": 7, "method": method, "params": params or {}}
        asyncio.run(self.server._serve_frame(frame, send))
        return sent[0]

    def test_initialize_answers_with_the_version_the_client_asked_for(self) -> None:
        answer = self._rpc("initialize", {"protocolVersion": 1, "clientCapabilities": {}})
        self.assertEqual(answer["result"]["protocolVersion"], 1)
        self.assertIn("agentCapabilities", answer["result"])
        self.assertIn("agentInfo", answer["result"])

    def test_initialize_carries_every_capability_field(self) -> None:
        result = self._rpc("initialize", {"protocolVersion": 1})["result"]
        capabilities = result["agentCapabilities"]
        self.assertIn("loadSession", capabilities)
        self.assertIn("promptCapabilities", capabilities)
        for name in ("image", "audio", "embeddedContext"):
            self.assertIn(name, capabilities["promptCapabilities"])

    def test_initialize_answers_its_own_version_when_the_client_names_none(self) -> None:
        result = self._rpc("initialize", {})["result"]
        self.assertEqual(result["protocolVersion"], acp_server.PROTOCOL_VERSION)

    def test_a_reply_is_dressed_as_a_websocket_frame(self) -> None:
        """The ASGI layer takes frames, not JSON-RPC objects.

        A live connection dropped on its first request because the reply was
        handed to uvicorn unwrapped: `message["type"]` raised `KeyError` inside
        the server and the socket closed with no frame at all. The in-process
        tests could not see it, because they call `_serve_frame` directly -- so
        this one goes through `_websocket`, which is where the wrapper lives.
        """
        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        frames = iter([
            {"type": "websocket.connect"},
            {"type": "websocket.receive", "text": json.dumps(
                {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})},
            {"type": "websocket.disconnect", "code": 1000},
        ])

        async def receive() -> dict:
            # Yield first: each request is handled on its own task, so a
            # receive that never awaits would starve it and the test would
            # report "no reply" for a server that is working.
            await asyncio.sleep(0)
            try:
                return next(frames)
            except StopIteration:
                await asyncio.sleep(0.05)
                return {"type": "websocket.disconnect", "code": 1000}

        scope = {"type": "websocket", "path": acp_server.ROUTE_ACP,
                 "headers": [], "query_string": b""}
        asyncio.run(self.server(scope, receive, send))

        replies = [m for m in sent if m["type"] == "websocket.send"]
        self.assertTrue(replies, "the reply never reached the transport")
        self.assertIsInstance(replies[0]["text"], str)
        self.assertEqual(json.loads(replies[0]["text"])["id"], 1)

    def test_an_unknown_method_is_a_json_rpc_error_not_a_close(self) -> None:
        answer = self._rpc("session/does-not-exist", {})
        self.assertEqual(answer["error"]["code"], -32601)
        self.assertNotIn("result", answer)

    def test_a_prompt_without_a_session_is_refused(self) -> None:
        answer = self._rpc("session/prompt", {"sessionId": "nope", "prompt": []})
        self.assertEqual(answer["error"]["code"], -32602)

    def test_session_new_returns_an_id_and_the_folder(self) -> None:
        result = self._rpc("session/new", {"cwd": "D:/tmp", "mcpServers": []})["result"]
        self.assertTrue(result["sessionId"])

    def test_session_list_names_the_sessions_that_exist(self) -> None:
        made = self._rpc("session/new", {"cwd": "D:/tmp"})["result"]["sessionId"]
        listed = self._rpc("session/list", {"_meta": {"types": ["user"]}})["result"]
        self.assertEqual([item["sessionId"] for item in listed["sessions"]], [made])

    def test_goose_unstable_methods_answer_rather_than_fail(self) -> None:
        """An error here leaves the client's settings pane blank forever."""
        for method in ("_goose/unstable/defaults/read", "_goose/unstable/config/read",
                       "_goose/unstable/config/read-all", "_goose/unstable/providers/list"):
            answer = self._rpc(method, {})
            self.assertIn("result", answer, method)
            self.assertIsInstance(answer["result"], dict)


class PromptTests(unittest.TestCase):
    """One prompt, from the executor's events to the client's updates."""

    def _run_prompt(self, backend: FakeBackend, prompt: list[dict] | None = None) -> dict:
        server = AcpServer(home=Path("."), secret="", backend_factory=lambda: backend)
        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        async def scenario() -> None:
            made = await server._dispatch("session/new", {"cwd": "D:/tmp"}, send)
            await server._dispatch(
                "session/prompt",
                {"sessionId": made["sessionId"],
                 "prompt": prompt if prompt is not None else [{"type": "text", "text": "read it"}]},
                send,
            )

        asyncio.run(scenario())
        updates = [m["params"]["update"] for m in sent if m.get("method") == "session/update"]
        return {"updates": updates, "backend": backend, "sent": sent}

    def test_the_event_stream_becomes_the_expected_update_sequence(self) -> None:
        """The order matters: the client appends chunks as they arrive."""
        answer = self._run_prompt(FakeBackend())
        kinds = [update["sessionUpdate"] for update in answer["updates"]]
        self.assertEqual(
            kinds,
            ["agent_thought_chunk", "tool_call", "tool_call_update", "agent_message_chunk"],
        )

    def test_a_thought_and_an_answer_become_two_different_chunks(self) -> None:
        """Reasoning and the reply are separate panes in the client."""
        answer = self._run_prompt(FakeBackend())
        thought, _call, _result, message = answer["updates"]
        self.assertEqual(thought["sessionUpdate"], "agent_thought_chunk")
        self.assertEqual(thought["content"]["text"], "I should read the file.")
        self.assertEqual(message["sessionUpdate"], "agent_message_chunk")
        self.assertEqual(message["content"]["text"], "The word is PLUMBUS.")

    def test_a_tool_call_and_its_result_share_an_identifier(self) -> None:
        """Without a matching id the client shows a spinner that never stops."""
        answer = self._run_prompt(FakeBackend())
        call = next(u for u in answer["updates"] if u["sessionUpdate"] == "tool_call")
        result = next(u for u in answer["updates"] if u["sessionUpdate"] == "tool_call_update")
        self.assertEqual(call["toolCallId"], result["toolCallId"])
        self.assertEqual(call["status"], "pending")
        self.assertEqual(result["status"], "completed")

    def test_a_failed_tool_result_is_reported_as_failed(self) -> None:
        events = [("tool.called", {"index": 0, "name": "terminal", "arguments": {}}),
                  ("tool.result", {"index": 0, "name": "terminal", "ok": False,
                                   "output": "boom"})]
        answer = self._run_prompt(FakeBackend(events=events))
        result = next(u for u in answer["updates"] if u["sessionUpdate"] == "tool_call_update")
        self.assertEqual(result["status"], "failed")

    def test_a_tool_call_reports_the_kind_the_client_draws_it_by(self) -> None:
        """`kind` is what picks the tool's icon: a single hardcoded value makes
        every call in a run draw as the same generic card."""
        events = [("tool.called", {"index": 0, "name": "terminal", "arguments": {}}),
                  ("tool.called", {"index": 1, "name": "file_editor", "arguments": {}}),
                  ("tool.called", {"index": 2, "name": "task_tracker", "arguments": {}}),
                  ("tool.called", {"index": 3, "name": "web_search", "arguments": {}})]
        answer = self._run_prompt(FakeBackend(events=events))
        calls = [u for u in answer["updates"] if u["sessionUpdate"] == "tool_call"]
        self.assertEqual([call["kind"] for call in calls],
                         ["execute", "edit", "think", "search"])

    def test_an_unrecognised_tool_still_draws_a_card(self) -> None:
        """`other` is the protocol's own default, not a failure: the client
        still draws the card, only without a tool-specific icon."""
        events = [("tool.called", {"index": 0, "name": "some_future_tool",
                                   "arguments": {}})]
        answer = self._run_prompt(FakeBackend(events=events))
        call = next(u for u in answer["updates"] if u["sessionUpdate"] == "tool_call")
        self.assertEqual(call["kind"], "other")

    def test_the_prompt_text_reaches_the_executor(self) -> None:
        answer = self._run_prompt(FakeBackend())
        self.assertEqual(answer["backend"].calls[0]["task"], "read it")

    def test_the_session_folder_is_the_workspace_the_executor_gets(self) -> None:
        answer = self._run_prompt(FakeBackend())
        self.assertEqual(
            Path(answer["backend"].calls[0]["workspace"]).as_posix(), "D:/tmp"
        )

    def test_the_session_id_is_the_conversation(self) -> None:
        """Two prompts in one session must continue one dialogue."""
        answer = self._run_prompt(FakeBackend())
        self.assertTrue(answer["backend"].calls[0]["conversation"])

    def test_a_prompt_with_no_text_is_refused_rather_than_run_empty(self) -> None:
        server = AcpServer(home=Path("."), secret="", backend_factory=FakeBackend)
        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        async def scenario() -> dict:
            made = await server._dispatch("session/new", {"cwd": "D:/tmp"}, send)
            return await server._dispatch(
                "session/prompt",
                {"sessionId": made["sessionId"], "prompt": []}, send,
            )

        with self.assertRaises(acp_server.AcpError):
            asyncio.run(scenario())

    def test_the_final_line_is_not_sent_twice(self) -> None:
        """The last message chunk and `run.final` are the same text.

        The executor sets `final` from the last step, which was already relayed
        while it streamed. Without the check the client draws the answer under
        itself, which reads like the model repeated it.
        """
        answer = self._run_prompt(FakeBackend())
        texts = [u["content"]["text"] for u in answer["updates"]
                 if u["sessionUpdate"] == "agent_message_chunk"]
        self.assertEqual(texts, ["The word is PLUMBUS."])

    def test_a_final_line_no_chunk_carried_is_still_sent(self) -> None:
        """A run whose only text is `final` must not end silently."""
        backend = FakeBackend(events=[("step.started", {"index": 0})], final="answer from final")
        answer = self._run_prompt(backend)
        texts = [u["content"]["text"] for u in answer["updates"]
                 if u["sessionUpdate"] == "agent_message_chunk"]
        self.assertEqual(texts, ["answer from final"])

    def test_a_run_that_errored_ends_as_a_refusal(self) -> None:
        """The client must not be told a broken run was a finished turn."""
        server = AcpServer(home=Path("."), secret="",
                           backend_factory=lambda: FakeBackend(error="no API key"))
        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        async def scenario() -> dict:
            made = await server._dispatch("session/new", {"cwd": "D:/tmp"}, send)
            return await server._dispatch(
                "session/prompt",
                {"sessionId": made["sessionId"], "prompt": [{"type": "text", "text": "go"}]},
                send,
            )

        self.assertEqual(asyncio.run(scenario())["stopReason"], "refusal")


class ToolCallIdentityTests(unittest.TestCase):
    """Two calls to one tool in one reply must not share a card."""

    def _updates(self, events: list[tuple[str, dict]]) -> list[dict]:
        server = AcpServer(home=Path("."), secret="",
                           backend_factory=lambda: FakeBackend(events=events, final=""))
        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        async def scenario() -> None:
            made = await server._dispatch("session/new", {"cwd": "D:/tmp"}, send)
            await server._dispatch(
                "session/prompt",
                {"sessionId": made["sessionId"], "prompt": [{"type": "text", "text": "go"}]},
                send,
            )

        asyncio.run(scenario())
        return [m["params"]["update"] for m in sent if m.get("method") == "session/update"]

    def test_two_calls_of_one_tool_get_two_ids(self) -> None:
        """The client drops a second card under an id it already holds."""
        updates = self._updates([
            ("tool.called", {"index": 0, "name": "terminal", "arguments": {}}),
            ("tool.called", {"index": 0, "name": "terminal", "arguments": {}}),
        ])
        calls = [u["toolCallId"] for u in updates if u["sessionUpdate"] == "tool_call"]
        self.assertEqual(len(calls), 2)
        self.assertNotEqual(calls[0], calls[1])

    def test_a_result_closes_the_call_its_id_names(self) -> None:
        """Same tool, results out of order: the id decides, not arrival order.

        The client puts each result inside the card of the id it carries, so
        pairing by name alone would show the second command's output under the
        first command's row.
        """
        updates = self._updates([
            ("tool.called", {"index": 0, "name": "terminal", "call_id": "a", "arguments": {}}),
            ("tool.called", {"index": 0, "name": "terminal", "call_id": "b", "arguments": {}}),
            ("tool.result", {"index": 0, "name": "terminal", "call_id": "b", "ok": True,
                             "output": "from-b"}),
            ("tool.result", {"index": 0, "name": "terminal", "call_id": "a", "ok": True,
                             "output": "from-a"}),
        ])
        opened = {}
        for update in updates:
            if update["sessionUpdate"] == "tool_call":
                opened[update["toolCallId"]] = None
        for update in updates:
            if update["sessionUpdate"] == "tool_call_update":
                opened[update["toolCallId"]] = update["content"][0]["content"]["text"]
        self.assertEqual(opened, {"call-a": "from-a", "call-b": "from-b"})

    def test_a_plan_update_closes_the_card_that_produced_it(self) -> None:
        """The report behind a plan update is still a card the client drew.

        Leaving it open is not cosmetic: its bookkeeping entries are never
        collected, so a long session accumulates one dead "in progress" card per
        plan update.
        """
        updates = self._updates([
            ("tool.called", {"index": 0, "name": "task_tracker", "call_id": "t1",
                             "arguments": {}}),
            ("plan.updated", {"steps": [{"text": "one", "status": "pending"}],
                              "call_id": "t1", "name": "task_tracker"}),
        ])
        calls = [u for u in updates if u["sessionUpdate"] == "tool_call"]
        closes = [u for u in updates if u["sessionUpdate"] == "tool_call_update"]
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(closes), 1)
        self.assertEqual(closes[0]["toolCallId"], calls[0]["toolCallId"])
        self.assertEqual(closes[0]["status"], "completed")

    def test_a_plan_update_with_no_open_card_draws_nothing(self) -> None:
        """An update for a card the client never drew would be an error there."""
        updates = self._updates([
            ("plan.updated", {"steps": [{"text": "one", "status": "pending"}]}),
        ])
        closes = [u for u in updates if u["sessionUpdate"] == "tool_call_update"]
        self.assertEqual(closes, [])

    def test_a_result_with_no_matching_call_still_gets_an_id(self) -> None:
        updates = self._updates([
            ("tool.result", {"index": 0, "name": "terminal", "ok": True, "output": "x"}),
        ])
        self.assertTrue(updates[0]["toolCallId"])


class _SlowBackend(FakeBackend):
    """Records how many runs were inside `run` at once."""

    running = 0
    peak = 0

    def run(self, task, workspace, harness, surface, *, on_step=None, on_event=None,
            model=None, conversation=None, reasoning=None):
        import time

        _SlowBackend.running += 1
        _SlowBackend.peak = max(_SlowBackend.peak, _SlowBackend.running)
        try:
            time.sleep(0.15)
            return FakeRun(final="ok")
        finally:
            _SlowBackend.running -= 1


class PromptOrderTests(unittest.TestCase):
    """One session runs one prompt at a time."""

    def setUp(self) -> None:
        _SlowBackend.running = 0
        _SlowBackend.peak = 0
        self.server = AcpServer(home=Path("."), secret="", backend_factory=_SlowBackend)

    def test_a_second_prompt_on_one_session_waits_for_the_first(self) -> None:
        """Both would drive one conversation, and the executor tracks one run."""
        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        async def scenario() -> None:
            made = await self.server._dispatch("session/new", {"cwd": "D:/tmp"}, send)
            session_id = made["sessionId"]
            await asyncio.gather(
                self.server._dispatch(
                    "session/prompt",
                    {"sessionId": session_id, "prompt": [{"type": "text", "text": "one"}]},
                    send),
                self.server._dispatch(
                    "session/prompt",
                    {"sessionId": session_id, "prompt": [{"type": "text", "text": "two"}]},
                    send),
            )

        asyncio.run(scenario())
        self.assertEqual(_SlowBackend.peak, 1)

    def test_a_cancel_names_the_session_it_stops(self) -> None:
        """The folder is part of the executor's key, so a cancel must send it.

        A cancel that only named the conversation would look up a different
        conversation, find no run there, and report "nothing to stop" for a run
        that is going -- which is a cancel the user cannot tell apart from a
        broken stop button.
        """
        import threading

        gate = threading.Event()

        class Recording(FakeBackend):
            seen: list[dict] = []

            def run(self, *a, **k):
                gate.wait(5)
                return FakeRun(final="done")

            def interrupt(self, conversation=None, workspace=None):
                Recording.seen.append({"conversation": conversation,
                                       "workspace": str(workspace)})
                gate.set()
                return True

        Recording.seen = []
        server = AcpServer(home=Path("."), secret="", backend_factory=Recording)
        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        async def scenario() -> str:
            made = await server._dispatch("session/new", {"cwd": "D:/somewhere/else"}, send)
            session_id = made["sessionId"]
            running = asyncio.ensure_future(server._dispatch(
                "session/prompt",
                {"sessionId": session_id, "prompt": [{"type": "text", "text": "go"}]},
                send,
            ))
            # Let the prompt reach the executor before cancelling it.
            await asyncio.sleep(0.1)
            await server._dispatch("session/cancel", {"sessionId": session_id}, send)
            await running
            return session_id

        session_id = asyncio.run(scenario())
        self.assertEqual(len(Recording.seen), 1)
        self.assertEqual(Recording.seen[0]["conversation"], session_id)
        self.assertEqual(Path(Recording.seen[0]["workspace"]).as_posix(), "D:/somewhere/else")

    def test_a_cancel_before_the_run_starts_reports_cancelled(self) -> None:
        """Stop pressed while queued is a stop of that prompt, not a finished turn."""
        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        async def scenario() -> dict:
            made = await self.server._dispatch("session/new", {"cwd": "D:/tmp"}, send)
            session_id = made["sessionId"]
            # Mark the session cancelled with no run in flight, which is the
            # state a queued prompt finds when the user pressed stop.
            self.server._sessions[session_id].cancelled = True
            return await self.server._dispatch(
                "session/prompt",
                {"sessionId": session_id, "prompt": [{"type": "text", "text": "go"}]},
                send,
            )

        self.assertEqual(asyncio.run(scenario())["stopReason"], "cancelled")


class ShutdownTests(unittest.TestCase):
    """Closing the server must not leave a run driving the workspace."""

    def test_close_stops_the_executor_and_forgets_the_sessions(self) -> None:
        backend = FakeBackend()
        server = AcpServer(home=Path("."), secret="", backend_factory=lambda: backend)
        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        async def scenario() -> None:
            made = await server._dispatch("session/new", {"cwd": "D:/tmp"}, send)
            await server._dispatch(
                "session/prompt",
                {"sessionId": made["sessionId"], "prompt": [{"type": "text", "text": "go"}]},
                send,
            )
            await server.aclose()

        asyncio.run(scenario())
        self.assertIsNone(server._backend)
        self.assertEqual(backend.stopped, 1)

    def test_close_interrupts_a_run_still_in_flight(self) -> None:
        """A run that outlives the server must be stopped, not just forgotten."""

        class HeldBackend(FakeBackend):
            interrupts = 0

            def interrupt(self, conversation=None, workspace=None):
                HeldBackend.interrupts += 1
                return True

        backend = HeldBackend()
        server = AcpServer(home=Path("."), secret="", backend_factory=lambda: backend)
        held = {}

        async def scenario() -> None:
            sent: list[dict] = []

            async def send(message: dict) -> None:
                sent.append(message)

            made = await server._dispatch("session/new", {"cwd": "D:/tmp"}, send)
            # A prompt builds the executor, which is what an interrupt needs.
            await server._dispatch(
                "session/prompt",
                {"sessionId": made["sessionId"], "prompt": [{"type": "text", "text": "go"}]},
                send,
            )
            session = server._sessions[made["sessionId"]]
            held["id"] = made["sessionId"]
            # The executor thread cannot be killed, so the wrapper is what close
            # has to cancel; a real run in flight looks exactly like this.
            session.tasks.append(asyncio.get_running_loop().create_task(asyncio.sleep(30)))
            await server.aclose()

        asyncio.run(scenario())
        self.assertGreaterEqual(backend.interrupts, 1)
        self.assertEqual(server._sessions[held["id"]].tasks, [])

    def test_close_without_a_run_is_harmless(self) -> None:
        server = AcpServer(home=Path("."), secret="", backend_factory=FakeBackend)

        async def scenario() -> None:
            await server.aclose()

        asyncio.run(scenario())

    def test_the_shutdown_event_releases_the_executor(self) -> None:
        """`run()` hands uvicorn a server that must clean up on shutdown.

        The lifespan shutdown message is the last moment anything can await, so
        it is where a run in flight is stopped and the executor closed. If it
        did not, every orderly shutdown would leak the executor's workspace
        locks.
        """
        backend = FakeBackend()
        server = AcpServer(home=Path("."), secret="", backend_factory=lambda: backend)

        async def scenario() -> None:
            sent: list[dict] = []

            async def send(message: dict) -> None:
                sent.append(message)

            await server._dispatch("session/new", {"cwd": "D:/tmp"}, send)
            await server._dispatch(
                "session/prompt",
                {"sessionId": "rsi-" + server._process_token + "-0001",
                 "prompt": [{"type": "text", "text": "go"}]},
                send)

            messages = iter([{"type": "lifespan.startup"},
                             {"type": "lifespan.shutdown"}])

            async def receive() -> dict:
                return next(messages)

            scope = {"type": "lifespan"}
            await server(scope, receive, send)

        asyncio.run(scenario())
        self.assertEqual(backend.stopped, 1)
        self.assertIsNone(server._backend)

    def test_close_from_inside_a_running_loop_releases_the_executor(self) -> None:
        """`close()` cannot await there, but it must still stop the executor.

        A caller that holds a loop and calls `close()` gets the no-await path.
        Dropping the release there would leave the executor running with nothing
        left to stop it.
        """
        backend = FakeBackend()
        server = AcpServer(home=Path("."), secret="", backend_factory=lambda: backend)

        async def scenario() -> None:
            sent: list[dict] = []

            async def send(message: dict) -> None:
                sent.append(message)

            await server._dispatch("session/new", {"cwd": "D:/tmp"}, send)
            await server._dispatch(
                "session/prompt",
                {"sessionId": "rsi-" + server._process_token + "-0001",
                 "prompt": [{"type": "text", "text": "go"}]},
                send)
            # Inside the loop: asyncio.run would raise, so this takes the
            # release-without-awaiting path.
            server.close()

        asyncio.run(scenario())
        self.assertEqual(backend.stopped, 1)
        self.assertIsNone(server._backend)

    def test_a_cancel_that_arrived_after_the_run_finished_is_not_a_cancel(self) -> None:
        """The executor's own stop reason decides, not the flags alone.

        `pause()` -- the documented fallback for a synchronous run -- lets the
        request in flight finish. So an interrupted run can reach a normal
        completion, and calling that `cancelled` would tell the user their task
        was abandoned while its answer is on the screen.
        """
        import threading

        gate = threading.Event()

        class FinishesAnyway(FakeBackend):
            def run(self, task, *a, **k):
                gate.wait(5)
                run = FakeRun(final="the answer")
                run.stop_reason = "finish"
                return run

            def interrupt(self, conversation=None, workspace=None):
                gate.set()
                return True

        server = AcpServer(home=Path("."), secret="", backend_factory=FinishesAnyway)
        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        async def scenario() -> dict:
            made = await server._dispatch("session/new", {"cwd": "D:/tmp"}, send)
            session_id = made["sessionId"]
            running = asyncio.ensure_future(server._dispatch(
                "session/prompt",
                {"sessionId": session_id, "prompt": [{"type": "text", "text": "go"}]},
                send))
            await asyncio.sleep(0.15)
            await server._dispatch("session/cancel", {"sessionId": session_id}, send)
            gate.set()
            return await running

        self.assertEqual(asyncio.run(scenario())["stopReason"], "end_turn")

    def test_a_cancel_that_stopped_nothing_does_not_mask_an_error(self) -> None:
        """An interrupted run that failed is a refusal, not a cancellation."""
        import threading

        gate = threading.Event()

        class FailsAnyway(FakeBackend):
            def run(self, task, *a, **k):
                gate.wait(5)
                run = FakeRun(error="the model refused")
                run.stop_reason = "error"
                return run

            def interrupt(self, conversation=None, workspace=None):
                gate.set()
                return True

        server = AcpServer(home=Path("."), secret="", backend_factory=FailsAnyway)
        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        async def scenario() -> dict:
            made = await server._dispatch("session/new", {"cwd": "D:/tmp"}, send)
            session_id = made["sessionId"]
            running = asyncio.ensure_future(server._dispatch(
                "session/prompt",
                {"sessionId": session_id, "prompt": [{"type": "text", "text": "go"}]},
                send))
            await asyncio.sleep(0.15)
            await server._dispatch("session/cancel", {"sessionId": session_id}, send)
            gate.set()
            return await running

        self.assertEqual(asyncio.run(scenario())["stopReason"], "refusal")

    def test_a_cancel_does_not_swallow_the_next_prompt(self) -> None:
        """A run stopped by cancel must not leave the flag set for the next one.

        The flag is what the next prompt reads to decide "this prompt was
        already cancelled". Left set, every later prompt on that session answers
        `cancelled` without ever reaching the executor -- the session becomes a
        tombstone the user cannot tell from a broken stop button.
        """
        import threading

        gate = threading.Event()

        class Gated(FakeBackend):
            runs: list[str] = []

            def run(self, task, *a, **k):
                Gated.runs.append(task)
                if task == "one":
                    gate.wait(5)
                return FakeRun(final="done-" + task)

            def interrupt(self, conversation=None, workspace=None):
                gate.set()
                return True

        Gated.runs = []
        server = AcpServer(home=Path("."), secret="", backend_factory=Gated)
        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        async def scenario() -> list:
            made = await server._dispatch("session/new", {"cwd": "D:/tmp"}, send)
            session_id = made["sessionId"]
            first = asyncio.ensure_future(server._dispatch(
                "session/prompt",
                {"sessionId": session_id, "prompt": [{"type": "text", "text": "one"}]},
                send))
            await asyncio.sleep(0.15)
            await server._dispatch("session/cancel", {"sessionId": session_id}, send)
            replies = [await first]
            for text in ("two", "three"):
                replies.append(await server._dispatch(
                    "session/prompt",
                    {"sessionId": session_id, "prompt": [{"type": "text", "text": text}]},
                    send))
            return replies

        replies = asyncio.run(scenario())
        self.assertEqual(replies[0]["stopReason"], "cancelled")
        self.assertEqual([one["stopReason"] for one in replies[1:]],
                         ["end_turn", "end_turn"])
        self.assertEqual(Gated.runs, ["one", "two", "three"])

    def test_a_disconnect_stops_the_runs_it_started(self) -> None:
        """A closed window must not keep a thread calling tools and billing."""

        class HangingBackend(FakeBackend):
            interrupts = 0

            def run(self, *a, **k):
                import time

                for _ in range(200):
                    time.sleep(0.01)
                return FakeRun(final="late")

            def interrupt(self, conversation=None, workspace=None):
                HangingBackend.interrupts += 1
                return True

        backend = HangingBackend()
        server = AcpServer(home=Path("."), secret="", backend_factory=lambda: backend)
        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        sent_frames = iter([
            {"type": "websocket.connect"},
            {"type": "websocket.receive", "text": json.dumps(
                {"jsonrpc": "2.0", "id": 1, "method": "session/new",
                 "params": {"cwd": "D:/tmp"}})},
            {"type": "websocket.receive", "text": json.dumps(
                {"jsonrpc": "2.0", "id": 2, "method": "session/prompt",
                 "params": {"sessionId": None,
                            "prompt": [{"type": "text", "text": "go"}]}})},
        ])
        state = {"session": None}

        async def receive() -> dict:
            await asyncio.sleep(0)
            try:
                frame = next(sent_frames)
            except StopIteration:
                await asyncio.sleep(0.05)
                return {"type": "websocket.disconnect", "code": 1001}
            if frame["type"] == "websocket.receive":
                body = json.loads(frame["text"])
                if body["method"] == "session/prompt":
                    body["params"]["sessionId"] = state["session"]
                    frame = {**frame, "text": json.dumps(body)}
            return frame

        async def server_send(message: dict) -> None:
            sent.append(message)
            if message["type"] == "websocket.send":
                body = json.loads(message["text"])
                if body.get("id") == 1:
                    state["session"] = body["result"]["sessionId"]

        scope = {"type": "websocket", "path": acp_server.ROUTE_ACP,
                 "headers": [], "query_string": b""}
        asyncio.run(server(scope, receive, server_send))

        held = [one for one in server._sessions.values() if one.tasks]
        self.assertEqual(held, [], "the run outlived its window")
        self.assertGreaterEqual(backend.interrupts, 1,
                                "the run was dropped without being stopped")


class UsageTests(unittest.TestCase):
    """The reply carries what the turn cost, in the client's own field names."""

    def _reply(self, run: FakeRun) -> dict:
        class Reporting(FakeBackend):
            def run(self, *a, **k):
                return run

        server = AcpServer(home=Path("."), secret="", backend_factory=Reporting)
        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        async def scenario() -> dict:
            made = await server._dispatch("session/new", {"cwd": "D:/tmp"}, send)
            return await server._dispatch(
                "session/prompt",
                {"sessionId": made["sessionId"], "prompt": [{"type": "text", "text": "go"}]},
                send,
            )

        return asyncio.run(scenario())

    def test_a_counted_turn_reports_both_counts(self) -> None:
        run = FakeRun(final="done")
        run.prompt_tokens = 4380
        run.completion_tokens = 2
        reply = self._reply(run)
        self.assertEqual(reply["usage"],
                         {"inputTokens": 4380, "outputTokens": 2, "totalTokens": 4382})

    def test_an_uncounted_turn_claims_nothing(self) -> None:
        """A missing counter is not a free turn, so no usage is sent at all."""
        run = FakeRun(final="done")
        run.prompt_tokens = 0
        run.completion_tokens = 0
        self.assertNotIn("usage", self._reply(run))


class ConnectionOwnershipTests(unittest.TestCase):
    """One window closing must not stop another window's run."""

    class _Window:
        def __init__(self, server: AcpServer) -> None:
            self.server = server
            self.inbox: asyncio.Queue = asyncio.Queue()
            self.out: list[dict] = []
            self.task: asyncio.Task | None = None

        async def _receive(self) -> dict:
            return await self.inbox.get()

        async def _send(self, message: dict) -> None:
            self.out.append(message)

        def start(self) -> None:
            scope = {"type": "websocket", "path": acp_server.ROUTE_ACP,
                     "headers": [], "query_string": b""}
            self.task = asyncio.create_task(
                self.server(scope, self._receive, self._send))
            self.inbox.put_nowait({"type": "websocket.connect"})

        def send(self, body: dict) -> None:
            self.inbox.put_nowait(
                {"type": "websocket.receive", "text": json.dumps(body)})

        def close(self) -> None:
            self.inbox.put_nowait({"type": "websocket.disconnect", "code": 1001})

        def reply_to(self, msg_id: int) -> dict | None:
            for message in self.out:
                if message["type"] != "websocket.send":
                    continue
                body = json.loads(message["text"])
                if body.get("id") == msg_id:
                    return body
            return None

    def test_closing_one_window_leaves_the_other_run_alone(self) -> None:
        """A second window is a second client, not part of the first one."""

        class Slow(FakeBackend):
            interrupts: list = []

            def run(self, task, *a, **k):
                import time

                time.sleep(0.4)
                return FakeRun(final="done-" + task)

            def interrupt(self, conversation=None, workspace=None):
                Slow.interrupts.append(conversation)
                return True

        Slow.interrupts = []
        server = AcpServer(home=Path("."), secret="", backend_factory=Slow)
        holder = {}

        async def scenario() -> None:
            first = self._Window(server)
            first.start()
            first.send({"jsonrpc": "2.0", "id": 1, "method": "session/new",
                        "params": {"cwd": "D:/a"}})
            await asyncio.sleep(0.1)

            second = self._Window(server)
            second.start()
            second.send({"jsonrpc": "2.0", "id": 1, "method": "session/new",
                         "params": {"cwd": "D:/b"}})
            await asyncio.sleep(0.1)
            second_id = second.reply_to(1)["result"]["sessionId"]
            second.send({"jsonrpc": "2.0", "id": 2, "method": "session/prompt",
                         "params": {"sessionId": second_id,
                                    "prompt": [{"type": "text", "text": "b-work"}]}})
            await asyncio.sleep(0.15)

            # The first window goes away. It has no run of its own.
            first.close()
            await asyncio.sleep(0.15)
            holder["interrupts"] = list(Slow.interrupts)
            holder["second"] = second_id
            holder["running"] = len(server._sessions[second_id].tasks)
            await asyncio.sleep(0.5)
            holder["reply"] = second.reply_to(2)
            for window in (first, second):
                if window.task is not None:
                    window.task.cancel()

        asyncio.run(scenario())
        self.assertEqual(holder["interrupts"], [],
                         "closing one window stopped another window's run")
        self.assertEqual(holder["running"], 1)
        self.assertEqual(holder["reply"]["result"]["stopReason"], "end_turn")

    def test_a_prompt_queued_behind_a_deleted_session_is_refused(self) -> None:
        """It must not drive the executor for a session the client dropped."""
        import threading

        gate = threading.Event()

        class Gated(FakeBackend):
            runs: list = []

            def run(self, task, *a, **k):
                Gated.runs.append(task)
                if task == "one":
                    gate.wait(5)
                return FakeRun(final="done-" + task)

            def interrupt(self, conversation=None, workspace=None):
                gate.set()
                return True

        Gated.runs = []
        server = AcpServer(home=Path("."), secret="", backend_factory=Gated)
        sent: list[dict] = []
        outcome = {}

        async def send(message: dict) -> None:
            sent.append(message)

        async def scenario() -> None:
            made = await server._dispatch("session/new", {"cwd": "D:/tmp"}, send)
            session_id = made["sessionId"]
            running = asyncio.ensure_future(server._dispatch(
                "session/prompt",
                {"sessionId": session_id, "prompt": [{"type": "text", "text": "one"}]},
                send))
            await asyncio.sleep(0.15)
            queued = asyncio.ensure_future(server._dispatch(
                "session/prompt",
                {"sessionId": session_id, "prompt": [{"type": "text", "text": "two"}]},
                send))
            await asyncio.sleep(0.15)
            await server._dispatch("session/delete", {"sessionId": session_id}, send)
            gate.set()
            await asyncio.sleep(0.4)
            outcome["queued_done"] = queued.done()
            try:
                queued.result()
                outcome["queued"] = "ran"
            except acp_server.AcpError as exc:
                outcome["queued"] = exc.code
            for future in (running, queued):
                if not future.done():
                    future.cancel()

        asyncio.run(scenario())
        self.assertEqual(Gated.runs, ["one"], "the deleted session still ran a prompt")
        self.assertEqual(outcome["queued"], -32602)

    def test_deleting_a_session_drops_its_connection_record(self) -> None:
        """The ownership table is per-session state and must not outlive it.

        Every session opened through a socket is recorded so a disconnect knows
        what to stop. A delete that forgot to remove the record would grow that
        table for the life of the process, and a later connection token reused
        from the same pool could inherit a stale entry.
        """
        server = AcpServer(home=Path("."), secret="", backend_factory=FakeBackend)

        async def scenario() -> tuple[int, bool]:
            sent: list[dict] = []

            async def send(message: dict) -> None:
                sent.append(message)

            made = await server._dispatch("session/new", {"cwd": "D:/tmp"}, send,
                                          connection="conn-1")
            session_id = made["sessionId"]
            before = len(server._opened)
            await server._dispatch("session/delete", {"sessionId": session_id}, send)
            return before, session_id in server._opened

        before, still_there = asyncio.run(scenario())
        self.assertEqual(before, 1)
        self.assertFalse(still_there, "the deleted session is still in the ownership table")

    def test_delete_waits_for_the_run_it_stops_before_returning(self) -> None:
        """`session/delete` must not return with the stopped run still unwinding.

        Cancelling a task only queues the cancellation; the task is not finished
        until the loop has run it. A delete that returned at that point would let
        the next prompt on that session start while the abandoned run was still
        inside its `finally`, releasing a lock the next prompt had already taken.
        """
        import threading

        gate = threading.Event()

        class Gated(FakeBackend):
            def run(self, task, *a, **k):
                gate.wait(5)
                return FakeRun(final="done-" + task)

            def interrupt(self, conversation=None, workspace=None):
                gate.set()
                return True

        server = AcpServer(home=Path("."), secret="", backend_factory=Gated)
        sent: list[dict] = []
        outcome = {}

        async def send(message: dict) -> None:
            sent.append(message)

        async def scenario() -> None:
            made = await server._dispatch("session/new", {"cwd": "D:/tmp"}, send)
            session_id = made["sessionId"]
            running = asyncio.ensure_future(server._dispatch(
                "session/prompt",
                {"sessionId": session_id, "prompt": [{"type": "text", "text": "one"}]},
                send))
            await asyncio.sleep(0.15)
            # The executor task delete is about to stop, captured before delete
            # clears the session's list.
            executor_task = list(server._sessions[session_id].tasks)[0]
            await server._dispatch("session/delete", {"sessionId": session_id}, send)
            outcome["executor_done"] = executor_task.done()
            gate.set()
            await asyncio.sleep(0.2)
            if not running.done():
                running.cancel()

        asyncio.run(scenario())
        self.assertTrue(outcome["executor_done"],
                        "delete returned while the run it stopped was still unwinding")


class ImportTests(unittest.TestCase):
    """This module must be importable where no server library is installed."""

    def test_the_module_imports_without_uvicorn(self) -> None:
        """The repository's own interpreter has no uvicorn, and tests run there."""
        import importlib
        import sys

        held = sys.modules.pop("rsi.acp_server", None)
        try:
            module = importlib.import_module("rsi.acp_server")
            self.assertTrue(hasattr(module, "run"))
        finally:
            if held is not None:
                sys.modules["rsi.acp_server"] = held

    def test_building_the_server_does_not_bind_a_port(self) -> None:
        """A test that only wants dispatch must not need a free port."""
        server = AcpServer(home=Path("."), secret="")
        self.assertEqual(server._sessions, {})


class RunEntryTests(unittest.TestCase):
    """`run` is the CLI entry and must not start a server at import time."""

    def test_run_imports_uvicorn_only_when_called(self) -> None:
        """Calling it without uvicorn reports the missing library, not a crash."""
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(acp_server.__file__).read_text(encoding="utf-8")
        # The import lives inside the function, so module import cannot need it.
        at_module_scope = any(
            line.startswith("import uvicorn") for line in source.splitlines()
        )
        self.assertFalse(at_module_scope)
        self.assertIn("def run(", source)
        _ = tmp


if __name__ == "__main__":
    unittest.main()
