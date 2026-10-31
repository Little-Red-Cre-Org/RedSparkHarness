"""An ACP backend goose can connect to, driving this harness's own executor.

goose desktop, pointed at `GOOSE_EXTERNAL_BACKEND_URL`, connects in three steps:
a plain `GET /status`, a `GET /acp` that must *refuse* because it is not an SSE
request, then a websocket to `/acp?token=<secret>`. Only the third one carries
conversation; the first two are how the client decides whether to draw its
window at all, which is why a wrong answer there looks like a broken install
rather than a protocol error.

Nothing here is a second agent. `session/prompt` starts `make_backend(
"openhands")` and relays the events that executor already emits, so there is one
place that knows how to talk to a model and this file is not it. That is also why
the backend is injected rather than imported at the call site: a fake backend in
a test then exercises the same relay the real one uses.

Deliberately stdlib-only at import time. The desktop installs uvicorn and
starlette, but the interpreter this repository's tests run on has neither, and a
module that cannot be imported cannot be tested -- so the ASGI callable is
hand-written and uvicorn is imported inside `run`.
"""

from __future__ import annotations

import asyncio
import hmac
import ipaddress
import json
import logging
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .goose_rpc import GooseSurface, _NoSession, _Unknown

__all__ = ["AcpServer", "run", "ROUTE_STATUS", "ROUTE_ACP"]

#: Where incoming method names go. Off by default: the desktop is not a place
#: to read a protocol log, and a bridge that narrates every event costs more
#: than it tells. Turned on when a client misbehaves and the question is what it
#: actually asked for.
_log = logging.getLogger(__name__)

#: Where goose asks whether a backend is alive. No secret: it is a reachability
#: probe, and the client sends no key with it.
ROUTE_STATUS = "/status"

#: The ACP endpoint. One path answers both the secret probe (HTTP, refused) and
#: the conversation itself (websocket, accepted).
ROUTE_ACP = "/acp"

#: The secret travels in a query parameter on the websocket, not in a header.
#: goosed reads `?token=`, and a header-only implementation authenticates nobody.
TOKEN_PARAM = "token"

#: Also accepted as a header, because that is what the HTTP probe uses, and one
#: credential should not need two spellings to be recognised.
SECRET_HEADER = "x-secret-key"

#: The ACP revision this speaks. goose sends its own in `initialize`; answering
#: with the same number is what tells it the two agree.
PROTOCOL_VERSION = 1

class AcpError(Exception):
    """A JSON-RPC failure with the code the client expects in the error object."""

    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class _Session:
    """One ACP session: the folder it works in and what it has been told."""

    session_id: str
    cwd: str
    conversation: str = ""
    cancelled: bool = False
    #: Whether the cancel that set `cancelled` actually stopped a run. The reply
    #: reads this, not the flag: a flag alone would say `cancelled` for a task
    #: that ran to completion while the user was pressing stop.
    interrupt_hit: bool = False
    tasks: list[asyncio.Task] = field(default_factory=list)
    #: Tool calls the client is showing as in-flight, by the executor's own id,
    #: and by tool name for the sources that send no id. See `_open_call`.
    open_calls: dict[str, str] = field(default_factory=dict)
    pending_by_name: dict[str, list[str]] = field(default_factory=dict)
    #: Serialises the prompts of one session. Two prompts on one session share
    #: one conversation in the executor, and the executor tracks one run per
    #: conversation: the second would displace the first's emitter and one of the
    #: two would report nothing. A client that reconnects while its last prompt
    #: is still running is what reaches this, so the second waits rather than
    #: interleaves.
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    #: The message text already sent as a chunk, so the run's final line is not
    #: drawn a second time under the answer that carried it.
    spoken: str = ""
    #: What the session list and info screens show. A title starts as the first
    #: task's opening words and is replaced when the client renames the session.
    title: str = ""
    created: float = field(default_factory=time.time)
    updated: float = field(default_factory=time.time)
    messages: int = 0


class AcpServer:
    """The ASGI application and the JSON-RPC dispatch behind it.

    Args:
        home: The engine home whose `config.toml` names the provider.
        model: The model every run uses unless the client names one.
        secret: The shared secret a client must present. Empty means no check,
            which is only meaningful on loopback during development.
        backend_factory: How to build an executor. Defaults to
            `backend.make_backend("openhands")`, imported on first use so this
            module stays importable on an interpreter without the SDK.
    """

    def __init__(
        self,
        *,
        home: Path | str,
        model: str | None = None,
        secret: str = "",
        backend_factory: Callable[[], Any] | None = None,
    ) -> None:
        self.home = Path(home)
        self.model = model
        self.secret = secret
        self._factory = backend_factory
        self._backend: Any = None
        self._sessions: dict[str, _Session] = {}
        self._counter = 0
        self._call_counter = 0
        # Names this process in every session id it hands out, so a restart
        # cannot reuse an id that still has a persistence directory on disk.
        self._process_token = secrets.token_hex(4)
        # Which socket opened each session, so a disconnect stops its own runs
        # and only those. See `_websocket`.
        self._opened: dict[str, str] = {}
        self._goose = GooseSurface(home=self.home, session_of=self._describe_session)

    # -- ASGI ---------------------------------------------------------------

    async def aclose(self) -> None:
        """Stop every run still in flight and release the executor.

        Called once the server has stopped accepting connections. Runs are
        abandoned and awaited first, so no thread is still producing output while
        the executor is being released.

        Awaiting is also what keeps this from raising: `task.cancel()` against a
        task whose loop has already closed raises `RuntimeError`, and a shutdown
        path that throws leaves the executor unstopped and its workspace locks
        held. Each abandonment is therefore isolated.
        """
        for session in list(self._sessions.values()):
            if not session.tasks:
                continue
            try:
                await self._abandon(session)
            except Exception as exc:  # noqa: BLE001 - shutdown must finish
                _log.warning("abandoning %s failed: %s", session.session_id, exc)
                session.tasks.clear()
        self._opened.clear()
        runner = self._backend
        self._backend = None
        if runner is not None:
            stop = getattr(runner, "stop", None)
            if stop is not None:
                try:
                    stop()
                except Exception as exc:  # noqa: BLE001 - shutdown must finish
                    _log.warning("stopping the executor failed: %s", exc)

    def close(self) -> None:
        """`aclose` for a caller that is not running an event loop.

        `run` has just returned from `uvicorn.run`, which owns and has closed the
        loop, so a fresh one is the only way to await the abandonment. A caller
        that already has a loop must await `aclose` instead.
        """
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is not None:
            # Already inside a running loop: there is no way to await here, so
            # release the executor without waiting for the runs. Better than
            # leaving it running, and the caller was told to use `aclose`.
            _log.warning("close() called from a running loop; use aclose()")
            self._release_executor()
            return
        asyncio.run(self.aclose())

    def _release_executor(self) -> None:
        """Stop the executor without touching the runs."""
        self._opened.clear()
        runner = self._backend
        self._backend = None
        if runner is None:
            return
        stop = getattr(runner, "stop", None)
        if stop is None:
            return
        try:
            stop()
        except Exception as exc:  # noqa: BLE001 - shutdown must finish
            _log.warning("stopping the executor failed: %s", exc)

    async def __call__(self, scope: dict, receive: Callable, send: Callable) -> None:
        """Serve one ASGI connection: HTTP for the probes, websocket for ACP."""
        if scope["type"] == "lifespan":
            await self._lifespan(receive, send)
            return
        if scope["type"] == "http":
            await self._http(scope, send)
            return
        if scope["type"] == "websocket":
            await self._websocket(scope, receive, send)

    async def _lifespan(self, receive: Callable, send: Callable) -> None:
        """Serve the startup/shutdown pair, and release the executor on shutdown.

        The shutdown message is the last moment anything can await, so this is
        where a run still in flight gets stopped and the executor closed. Doing
        it after `uvicorn.run` returns would be too late to await anything.
        """
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                await self.aclose()
                await send({"type": "lifespan.shutdown.complete"})
                return

    async def _http(self, scope: dict, send: Callable) -> None:
        """Answer the two probes. Neither one carries a conversation."""
        path = scope.get("path") or ""
        if path == ROUTE_STATUS:
            await _reply_json(send, 200, {"status": "ok", "backend": "rsi-harness"})
            return
        if path == ROUTE_ACP:
            # Not an upgrade, so this is the client asking whether the endpoint
            # exists and whether it wants to argue about secrets. 406 is what
            # goosed treats as "yes, and I should now open the socket".
            await _reply_json(send, 406, {"error": "use the websocket"})
            return
        await _reply_json(send, 404, {"error": "no route " + path})

    async def _websocket(self, scope: dict, receive: Callable, send: Callable) -> None:
        """Accept an ACP conversation, or close it for the wrong secret."""
        if not self._secret_ok(scope):
            await send({"type": "websocket.close", "code": 1008})
            return
        await send({"type": "websocket.accept"})
        # Everything below speaks JSON-RPC objects, not ASGI messages. One
        # wrapper here is what keeps the dispatch readable; without it every
        # reply has to remember to dress itself as a websocket frame, which is
        # exactly the bug that dropped the first live connection.
        pending: set[asyncio.Task] = set()
        # Names this connection, so the sessions it opens can be stopped when it
        # goes away without stopping a second window's work. A token rather than
        # a shared field: two connections are open at once.
        connection = secrets.token_hex(4)

        async def emit(frame: dict) -> None:
            await send({"type": "websocket.send", "text": json.dumps(frame)})

        while True:
            message = await receive()
            if message["type"] == "websocket.disconnect":
                # Stop this connection's runs before leaving. Left alone, the
                # executor keeps calling tools and billing tokens for a window
                # that is gone, and each run leaves a task nobody awaits.
                for session_id, owner in list(self._opened.items()):
                    if owner != connection:
                        continue
                    session = self._sessions.get(session_id)
                    if session is not None and session.tasks:
                        await self._abandon(session)
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                return
            if message["type"] != "websocket.receive":
                # `websocket.connect` arrives after the accept, carrying no frame.
                # Answering it reports a malformed request the client never sent.
                continue
            raw = message.get("text")
            if raw is None and message.get("bytes") is not None:
                raw = message["bytes"].decode("utf-8", "replace")
            try:
                frame = json.loads(raw)
            except (TypeError, ValueError):
                await _send_error(emit, None, -32700, "the frame is not JSON")
                continue
            if not isinstance(frame, dict):
                await _send_error(emit, None, -32600, "a request must be an object")
                continue

            if frame.get("method") == "session/new":
                # Tagged with this connection's token so a disconnect stops only
                # the sessions this window opened.
                self._opening_connection = connection
            task = asyncio.create_task(self._serve_frame(frame, emit, connection))
            pending.add(task)
            task.add_done_callback(pending.discard)

    def _secret_ok(self, scope: dict) -> bool:
        """Whether this connection presented the configured secret.

        Compared with `compare_digest` so a wrong secret costs the same time as
        a short one. An unset secret accepts anything, which is a development
        convenience and is why `run` refuses to bind a non-loopback address
        without one.
        """
        if not self.secret:
            return True
        offered = ""
        for key, value in scope.get("headers") or ():
            if key.decode("latin-1").lower() == SECRET_HEADER:
                offered = value.decode("latin-1")
                break
        for chunk in (scope.get("query_string") or b"").decode("latin-1").split("&"):
            name, _, value = chunk.partition("=")
            if name == TOKEN_PARAM:
                offered = _unquote(value)
                break
        # Compared as bytes, not as str: `compare_digest` refuses two non-ASCII
        # str with TypeError, which would escape this predicate and kill every
        # connection of a deployment whose secret is not ASCII. Headers and the
        # query are already bytes on the wire; encoding here is what keeps one
        # spelling of the check working for both.
        return hmac.compare_digest(offered.encode("utf-8"), self.secret.encode("utf-8"))

    # -- JSON-RPC -----------------------------------------------------------

    async def _serve_frame(self, frame: dict, send: Callable,
                           connection: str | None = None) -> None:
        """Handle one request or notification, reporting failures as JSON-RPC."""
        method = frame.get("method")
        msg_id = frame.get("id")
        params = frame.get("params") or {}
        if not isinstance(method, str):
            if msg_id is not None:
                await _send_error(send, msg_id, -32600, "a request needs a method")
            return
        try:
            result = await self._dispatch(method, params, send, connection)
        except AcpError as exc:
            _log.debug("%s -> %d %s", method, exc.code, exc.message)
            if msg_id is not None:
                await _send_error(send, msg_id, exc.code, exc.message)
            return
        except Exception as exc:  # noqa: BLE001 - one bad call is not one bad socket
            _log.warning("%s -> %s: %s", method, type(exc).__name__, exc)
            if msg_id is not None:
                await _send_error(send, msg_id, -32603, type(exc).__name__ + ": " + str(exc))
            return
        _log.debug("%s -> ok", method)
        if msg_id is not None:
            await _send_result(send, msg_id, result)

    async def _dispatch(self, method: str, params: dict, send: Callable,
                        connection: str | None = None) -> Any:
        """Route one method name to its handler.

        `send` is handed down rather than returned with, because a prompt answers
        its own request *and* streams updates while it runs, so it needs the
        transport for longer than the return value lasts. `connection` names the
        socket the request arrived on, so a session remembers which window to
        stop when that window closes.
        """
        if method == "initialize":
            return self._initialize(params)
        if method == "session/new":
            return self._session_new(params, connection)
        if method == "session/prompt":
            return await self._session_prompt(params, send)
        if method == "session/cancel":
            return self._session_cancel(params)
        if method == "session/list":
            return self._session_list()
        if method == "session/delete":
            return await self._session_drop(params)
        if method == "session/close":
            return await self._session_drop(params)
        if method.startswith("_goose/unstable/"):
            return self._unstable(method, params)
        raise AcpError(-32601, "this backend has no method " + method)

    def _initialize(self, params: dict) -> dict:
        """Report what this backend can do, in the version the client asked for.

        No `_meta.goose` block: the client reads it to decide whether the
        backend implements local inference and recipe parameter scopes, and
        this one implements neither. Claiming them would put controls on screen
        whose calls land on a method that does not exist.
        """
        asked = params.get("protocolVersion")
        return {
            "protocolVersion": asked if isinstance(asked, int) else PROTOCOL_VERSION,
            "agentCapabilities": {
                "loadSession": False,
                # No images or audio: the executor takes text, and claiming
                # otherwise would let a client send content this cannot read.
                "promptCapabilities": {
                    "image": False,
                    "audio": False,
                    "embeddedContext": True,
                },
                "mcpCapabilities": {"http": False, "sse": False, "acp": False},
                "sessionCapabilities": {"list": {}, "delete": {}, "close": {}},
                "auth": {},
            },
            "agentInfo": {"name": "rsi-harness", "version": "0.1.0"},
            "authMethods": [],
        }

    def _session_new(self, params: dict, connection: str | None = None) -> dict:
        """Open a session over the folder the client named.

        The id is unique per process *and* across restarts. It names the
        conversation, which names the executor's persistence directory, so a
        counter that restarted at zero would hand the first session of every
        new process the same directory as the first session of the previous one
        -- and with `delete_on_close=False` the new session would open onto the
        old session's event log. The suffix is a per-process token rather than
        the counter alone for exactly that reason.

        `connection` is the socket that asked, recorded so closing that window
        stops this session's run and closing another window does not.
        """
        cwd = str(params.get("cwd") or "").strip() or str(Path.cwd())
        self._counter += 1
        session_id = "rsi-" + self._process_token + "-" + format(self._counter, "04d")
        self._sessions[session_id] = _Session(session_id=session_id, cwd=cwd, conversation=session_id)
        if connection is not None:
            self._opened[session_id] = connection
        return {"sessionId": session_id, "models": None, "modes": None}

    def _session_list(self) -> dict:
        """List the sessions this process knows about, newest first."""
        return {
            "sessions": [
                self._describe_session(item.session_id)
                for item in sorted(
                    self._sessions.values(), key=lambda one: one.updated, reverse=True
                )
            ]
        }

    async def _session_drop(self, params: dict) -> dict:
        """Forget a session the client closed or deleted.

        Any run still in flight on it is stopped first, and awaited. Dropping
        the record alone would leave the executor working for a window that is
        gone: it would keep calling tools and billing tokens, and its updates
        would be addressed to a session the client no longer has.

        Deleting an id that is already gone is not an error: the window can ask
        twice.
        """
        session = self._sessions.pop(str(params.get("sessionId") or ""), None)
        self._opened.pop(str(params.get("sessionId") or ""), None)
        if session is not None:
            await self._abandon(session)
        return {}

    async def _abandon(self, session: _Session) -> None:
        """Stop whatever a session still has running, and wait for it to stop.

        Called when the client deletes the session, closes the socket, or the
        server shuts down. The executor's run is interrupted first so it stops
        producing events, then every task it owns is cancelled and awaited -- a
        `to_thread` task cannot be killed, but cancelling and awaiting the
        wrapper is what lets `_run_prompt` reach its `finally`, release the
        session lock, and stop relaying what the thread still produces.

        Awaiting matters: `task.cancel()` only queues the cancellation. Without
        the await, a queued prompt behind the abandoned one would take a lock the
        abandoned prompt has not released yet, and the cancelled run's own
        `finally` would then run against a state the next prompt already moved on
        from.
        """
        if session.tasks:
            self._interrupt(session)
        tasks = list(session.tasks)
        for task in tasks:
            task.cancel()
        session.tasks.clear()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def _describe_session(self, session_id: str) -> dict | None:
        """One session in the shape the client's session type requires."""
        session = self._sessions.get(session_id)
        if session is None:
            return None
        return {
            "sessionId": session.session_id,
            "cwd": session.cwd,
            "title": session.title or None,
            "updatedAt": _isoformat(session.updated),
            "_meta": {
                "messageCount": session.messages,
                "createdAt": _isoformat(session.created),
                "sessionType": "user",
                "hasRecipe": False,
                "userSetName": bool(session.title),
            },
        }

    def _rename(self, params: dict) -> dict:
        """Set a session's title, which the client shows in the history rail."""
        session = self._sessions.get(str(params.get("sessionId") or ""))
        if session is None:
            raise AcpError(-32602, "no session " + str(params.get("sessionId")))
        session.title = str(params.get("title") or "").strip()
        session.updated = time.time()
        return {"sessionId": session.session_id}

    def _session_cancel(self, params: dict) -> dict:
        """Stop the run in progress on a session.

        The reply is empty because ACP's cancel carries no result. What actually
        happened is reported by the prompt that was waiting: it answers
        `cancelled` only when this call left `interrupt_hit` true, which is set
        from the executor's own answer. A cancel that stopped nothing therefore
        does not make the run's reply claim it was cancelled.

        A cancel with no run in flight is not an error. The client sends one when
        the user presses stop, and the run may have finished a moment earlier;
        the next prompt then runs normally.
        """
        session = self._sessions.get(str(params.get("sessionId") or ""))
        if session is None:
            raise AcpError(-32602, "no session " + str(params.get("sessionId")))
        session.cancelled = True
        session.interrupt_hit = self._interrupt(session)
        return {}

    def _interrupt(self, session: _Session) -> bool:
        """Ask the executor to stop this session's run; True when it had one.

        The executor's `interrupt` cancels the SDK task at its next await
        boundary, so a run stops mid-response rather than after it. Engines whose
        run cannot be stopped return False, and the prompt reply then says
        `end_turn` -- the honest answer for a cancel that changed nothing.
        """
        runner = self._backend
        if runner is None or not session.tasks:
            return False
        interrupt = getattr(runner, "interrupt", None)
        if interrupt is None:
            return False
        try:
            # The folder is part of the executor's conversation key, so it has to
            # be the session's own folder: the run registered itself under that,
            # and a cancel that guessed another folder would find no run there and
            # report "nothing to stop" for a run that is in fact going.
            return bool(
                interrupt(
                    conversation=session.conversation,
                    workspace=Path(session.cwd),
                )
            )
        except Exception as exc:  # noqa: BLE001 - the SDK's own teardown raises
            _log.warning("cancel of %s failed: %s", session.session_id, exc)
            return False

    def _unstable(self, method: str, params: dict) -> dict:
        """Answer goose's private methods from this engine's own configuration.

        These are not ACP. The conversation would work without them, but the
        client would draw its "connect a provider" page instead of a chat,
        because `defaults/read` is what it checks before showing the window.
        `goose_rpc` owns what each reply says; this only turns its two failure
        modes into the JSON-RPC errors the client expects.
        """
        if method == "_goose/unstable/session/rename":
            return self._rename(params)
        try:
            return self._goose.answer(method, params)
        except _Unknown:
            raise AcpError(-32601, "this backend has no method " + method) from None
        except _NoSession as exc:
            raise AcpError(-32602, "no session " + exc.session_id) from None

    # -- the prompt path ----------------------------------------------------

    async def _session_prompt(self, params: dict, send: Callable) -> dict:
        """Run one task through the executor and relay its events as updates."""
        session_id = str(params.get("sessionId") or "")
        session = self._sessions.get(session_id)
        if session is None:
            raise AcpError(-32602, "no session " + session_id)
        task = _prompt_text(params.get("prompt"))
        if not task:
            raise AcpError(-32602, "the prompt carries no text")

        async with session.lock:
            # The session was deleted while this prompt queued for the lock.
            # Running it would drive the executor for a window that no longer has
            # this session, and its updates would be addressed to a sessionId the
            # client already dropped.
            if self._sessions.get(session_id) is not session:
                raise AcpError(-32602, "no session " + session_id)
            # A cancel that arrived while this prompt was queued behind another
            # one is a cancel of *this* prompt: the user pressed stop after
            # sending it and before it started. Nothing ran, so reporting it as
            # started-then-finished would be wrong in the other direction.
            if session.cancelled:
                session.cancelled = False
                session.interrupt_hit = False
                return {"stopReason": "cancelled"}
            return await self._run_prompt(session, task, send)

    async def _run_prompt(self, session: _Session, task: str, send: Callable) -> dict:
        """Run one task on a session whose lock this call already holds."""
        session_id = session.session_id
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        session.cancelled = False
        session.interrupt_hit = False
        # The first task names the session, which is what the history rail
        # shows. A later prompt leaves an existing title alone: the user may
        # have renamed it, and a title that rewrites itself is worse than none.
        if not session.title:
            session.title = _title_from(task)
        session.messages += 2

        def emit(kind: str, data: dict) -> None:
            # Called on the executor's thread; the queue is the only thing that
            # crosses back to the loop, so a slow client never blocks a run.
            loop.call_soon_threadsafe(queue.put_nowait, ("event", kind, data))

        def work() -> Any:
            runner = self._executor()
            return runner.run(
                task,
                Path(session.cwd),
                {},
                None,
                on_event=emit,
                model=self.model,
                conversation=session.conversation,
            )

        runner_task = asyncio.create_task(asyncio.to_thread(work))
        session.tasks.append(runner_task)
        stopped = False
        try:
            while True:
                if runner_task.done() and queue.empty():
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=0.05)
                except asyncio.TimeoutError:
                    continue
                _kind, kind, data = item
                await self._relay(send, session, kind, data)
            run = await runner_task
            # Read before the flags are cleared, and read as a pair: only a
            # cancel the executor obeyed counts as cancelled.
            stopped = session.cancelled and session.interrupt_hit and _was_stopped(run, session)
        finally:
            if runner_task in session.tasks:
                session.tasks.remove(runner_task)
            session.updated = time.time()
            # Cleared here as well as at the top of the next prompt. A cancel
            # that stopped a run leaves the flag set, and a later prompt would
            # otherwise read it as "this prompt was cancelled" and answer
            # `cancelled` without ever reaching the executor.
            session.cancelled = False
            session.interrupt_hit = False

        if stopped:
            return {"stopReason": "cancelled"}
        if getattr(run, "error", ""):
            return {"stopReason": "refusal"}
        # `run.final` is the last step's text, which was already relayed as an
        # `agent_message_chunk` while it streamed. Sending it again would draw
        # the same answer twice; it goes out only when the model produced a final
        # line no message chunk carried.
        final = str(getattr(run, "final", "") or "")
        if final and final.strip() not in session.spoken:
            await self._update(
                send, session_id, {"sessionUpdate": "agent_message_chunk",
                                   "content": {"type": "text", "text": final}}
            )
        reply = {"stopReason": "end_turn"}
        usage = _usage_of(run)
        if usage:
            reply["usage"] = usage
        return reply

    def _executor(self) -> Any:
        """The executor, built once and reused."""
        if self._backend is None:
            if self._factory is not None:
                self._backend = self._factory()
            else:
                from .backend import make_backend

                self._backend = make_backend("openhands", home=self.home, model=self.model)
        return self._backend

    async def _relay(self, send: Callable, session: _Session, kind: str, data: dict) -> None:
        """Turn one executor event into the ACP update that means the same thing."""
        session_id = session.session_id
        if kind == "step.message":
            thinking = str(data.get("thinking") or "")
            assistant = str(data.get("assistant") or "")
            if thinking:
                await self._update(
                    send, session_id,
                    {"sessionUpdate": "agent_thought_chunk",
                     "content": {"type": "text", "text": thinking}},
                )
            if assistant:
                session.spoken = assistant.strip()
                await self._update(
                    send, session_id,
                    {"sessionUpdate": "agent_message_chunk",
                     "content": {"type": "text", "text": assistant}},
                )
            return
        if kind == "tool.called":
            await self._update(
                send, session_id,
                {"sessionUpdate": "tool_call",
                 "toolCallId": self._open_call(session_id, data),
                 "title": str(data.get("name") or "tool"),
                 "kind": _tool_kind(str(data.get("name") or "")),
                 "status": "pending",
                 "rawInput": data.get("arguments") or {}},
            )
            return
        if kind == "tool.result":
            ok = bool(data.get("ok", True))
            text = str(data.get("output") or data.get("error") or "")
            await self._update(
                send, session_id,
                {"sessionUpdate": "tool_call_update",
                 "toolCallId": self._close_call(session_id, data),
                 "status": "completed" if ok else "failed",
                 "content": [{"type": "content",
                              "content": {"type": "text", "text": text[:4000]}}]
                 if text else []},
            )
            return
        if kind == "model.retry":
            await self._update(
                send, session_id,
                {"sessionUpdate": "agent_thought_chunk",
                 "content": {"type": "text",
                             "text": "retrying: " + str(data.get("reason") or "")}},
            )
            return
        if kind == "plan.updated":
            # The call that produced this list was reported as a plan rather than
            # as a result, so its card would stay "in progress" and its bookkeeping
            # entries would never be collected. Closing it here is what keeps a
            # long session from accumulating one dead card per plan update.
            call_id = self._close_call(session_id, data, invent=False)
            if call_id:
                await self._update(
                    send, session_id,
                    {"sessionUpdate": "tool_call_update",
                     "toolCallId": call_id,
                     "status": "completed"},
                )

    def _open_call(self, session_id: str, data: dict) -> str:
        """The id for a tool call that is starting, remembered for its result.

        The client keys its tool cards by this id and ignores a second card
        under an id it already holds, so two calls to the same tool in one reply
        (two `terminal` commands, which is the normal case) must not share one.
        The executor supplies its own call id on both halves of the pair; a
        private counter covers the events that carry none.
        """
        key = str(data.get("call_id") or "")
        self._call_counter += 1
        call_id = "call-" + (key or format(self._call_counter, "06d"))
        session = self._sessions.get(session_id)
        if session is not None:
            name = str(data.get("name") or "tool")
            if key:
                session.open_calls[key] = call_id
            session.pending_by_name.setdefault(name, []).append(call_id)
        return call_id

    def _close_call(self, session_id: str, data: dict, *, invent: bool = True) -> str:
        """The id of the call this result finishes, or "" when none is open.

        Matched by the executor's call id when it sent one -- two calls of the
        same tool can finish in either order, so the name alone would close the
        wrong card. Otherwise by taking the oldest still-open call of that name,
        so a result cannot land on a call that already finished.

        `invent` decides what a result with no open call answers. A tool result
        always needs an id, because the client is showing a card for it; a plan
        update that arrives with nothing open has no card to close, and making up
        an id there would ask the client to update a card it never drew.
        """
        key = str(data.get("call_id") or "")
        name = str(data.get("name") or "tool")
        session = self._sessions.get(session_id)
        if session is None:
            return "call-" + (key or format(self._call_counter, "06d")) if invent else ""
        queue = session.pending_by_name.get(name) or []
        if key:
            opened = session.open_calls.pop(key, "")
            if opened:
                if opened in queue:
                    queue.remove(opened)
                return opened
        if queue:
            call_id = queue.pop(0)
            for held, marked in list(session.open_calls.items()):
                if marked == call_id:
                    del session.open_calls[held]
                    break
            return call_id
        # A result with no open call: the client still needs an id, and reusing
        # the executor's own keeps it pointing at the right card if one exists.
        if not invent:
            return ""
        return "call-" + (key or format(self._call_counter, "06d"))

    async def _update(self, send: Callable, session_id: str, update: dict) -> None:
        """Send one `session/update` notification."""
        await send({"jsonrpc": "2.0", "method": "session/update",
                    "params": {"sessionId": session_id, "update": update}})


def _was_stopped(run: Any, session: _Session) -> bool:
    """Whether this run really ended because it was stopped.

    Three things have to agree, and any one of them alone is a lie:

    * the client asked to stop it;
    * the executor said it stopped something;
    * the run itself did not end on its own terms.

    The third is what the earlier version of this check missed. The SDK's
    documented fallback for a synchronous run is `pause()`, which lets the
    request in flight finish -- so an interrupted run can still reach a normal
    completion, and reporting it as `cancelled` would tell the user their task
    was abandoned while its answer is on screen. A run that errored is likewise
    not a cancelled run, and `refusal` is the term that describes it.
    """
    stop_reason = str(getattr(run, "stop_reason", "") or "").lower()
    if stop_reason in ("cancelled", "interrupted", "paused"):
        return True
    # A run that finished or failed on its own did so despite the cancel.
    if stop_reason in ("finish", "error", "timeout", "refusal"):
        return False
    # No stop reason at all: trust the two signals that are there. An executor
    # that reports none cannot be cross-checked, and the flags are then the only
    # statement left about why this run ended.
    return True


def _usage_of(run: Any) -> dict:
    """What one turn cost, in the shape the prompt reply's `usage` takes.

    The executor counts tokens per run; the client shows them under the reply.
    Omitted rather than sent as zeros when the executor counted nothing, so a
    window cannot claim a turn was free when it simply was not measured.
    """
    prompt = int(getattr(run, "prompt_tokens", 0) or 0)
    completion = int(getattr(run, "completion_tokens", 0) or 0)
    if prompt <= 0 and completion <= 0:
        return {}
    return {"inputTokens": prompt, "outputTokens": completion,
            "totalTokens": prompt + completion}


def _isoformat(when: float) -> str:
    """A unix timestamp as the ISO-8601 string the client parses."""
    return datetime.fromtimestamp(when, tz=timezone.utc).isoformat()


#: The ACP `ToolKind` a tool name maps to. The protocol carries ten kinds and
#: the client picks its icon from this field, so a run whose tools all report
#: `other` draws every call as the same generic card.
#:
#: The names on the left are the SDK's own (`oh_events._TERMINAL` and friends),
#: not a private vocabulary: a tool the SDK grows later falls through to `other`
#: rather than being guessed at.
_TOOL_KINDS = {
    "terminal": "execute",
    "bash": "execute",
    "execute_bash": "execute",
    "file_editor": "edit",
    "str_replace_editor": "edit",
    "edit_file": "edit",
    "write_file": "edit",
    "read_file": "read",
    "task_tracker": "think",
    "think": "think",
    "browser": "fetch",
    "web_fetch": "fetch",
    "web_search": "search",
    "grep": "search",
    "glob": "search",
}


def _tool_kind(name: str) -> str:
    """The ACP kind for a tool call, defaulting to `other`.

    An unknown name is not an error: `other` is what the protocol defaults to,
    and the client still draws the card, only without a tool-specific icon.
    """
    return _TOOL_KINDS.get(name, "other")


def _title_from(task: str) -> str:
    """A session title taken from the task that opened it.

    The rail shows one line, so this keeps the opening words and drops the rest
    of a long instruction. Newlines collapse to spaces first, because a title
    carrying one would break the single-line label it lands in.
    """
    flat = " ".join(task.split())
    return flat if len(flat) <= 60 else flat[:57].rstrip() + "..."


def _prompt_text(prompt: Any) -> str:
    """The text of an ACP prompt, which arrives as a list of content blocks."""
    if isinstance(prompt, str):
        return prompt.strip()
    parts: list[str] = []
    for block in prompt or ():
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text") or ""))
    return "\n".join(parts).strip()


def _unquote(value: str) -> str:
    """Form-decode a query parameter without pulling in urllib.

    `+` is a space: the client builds the URL with `URLSearchParams`, which
    encodes a space as `+`, so a secret containing one would never match if this
    read the character literally. A literal `+` must arrive as `%2B`.
    """
    out = bytearray()
    index = 0
    while index < len(value):
        char = value[index]
        if char == "%" and index + 2 < len(value):
            try:
                out.append(int(value[index + 1 : index + 3], 16))
            except ValueError:
                out.append(ord(char))
            index += 3
            continue
        out.append(0x20 if char == "+" else ord(char))
        index += 1
    return out.decode("utf-8", "replace")


async def _reply_json(send: Callable, status: int, body: dict) -> None:
    """Answer one plain HTTP request."""
    payload = json.dumps(body).encode("utf-8")
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json"),
                            (b"content-length", str(len(payload)).encode())]})
    await send({"type": "http.response.body", "body": payload})


async def _send_result(send: Callable, msg_id: Any, result: Any) -> None:
    """Answer a request."""
    await send({"jsonrpc": "2.0", "id": msg_id, "result": result})


async def _send_error(send: Callable, msg_id: Any, code: int, message: str) -> None:
    """Refuse a request."""
    await send({"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}})


def run(
    host: str = "127.0.0.1",
    port: int = 57800,
    secret: str = "",
    *,
    home: Path | str,
    model: str | None = None,
) -> None:
    """Serve ACP until interrupted.

    Blocks. uvicorn is imported here rather than at module scope so that
    importing this file costs nothing and works on an interpreter without it.

    Raises:
        SystemExit: `host` is not a loopback address and no `secret` was given.
            This process hands any client that connects an agent that runs
            terminal commands in the workspace, so listening on a routable
            address without a secret would publish that agent to the network.
            The check is here rather than in the CLI because `run` is the only
            thing that binds a socket.
    """
    if not secret and not _is_loopback(host):
        raise SystemExit(
            "refusing to serve on "
            + host
            + " without a secret: any client that connected could run commands "
            "in the workspace. Pass --secret, or bind a loopback address."
        )

    import uvicorn

    app = AcpServer(home=home, model=model, secret=secret)
    try:
        uvicorn.run(app, host=host, port=port, log_level="warning")
    finally:
        # The lifespan shutdown event already awaited `aclose`, which is the only
        # place a run in flight can be awaited. This is the fallback for a server
        # that never delivered that event -- a crash, or a loop closed under it --
        # so the executor is released either way. `close` tolerates the closed
        # loop that `uvicorn.run` leaves behind.
        app.close()


def _is_loopback(host: str) -> bool:
    """Whether `host` only accepts connections from this machine."""
    name = (host or "").strip().strip("[]").lower()
    if name == "localhost":
        return True
    try:
        return ipaddress.ip_address(name).is_loopback
    except ValueError:
        # A hostname that is not an address is not provably local, so it is
        # treated as routable: the safe answer is the one that demands a secret.
        return False
