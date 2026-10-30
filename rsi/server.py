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

"""An HTTP + event-stream service over a generation store, on the standard library.

Deliberately stdlib-only (`http.server` + `socketserver`), matching Harness2's own choice to
ship with `dependencies = []`. FastAPI would be nicer to write against, but a service you
cannot start without installing something is a worse first step than a service with a
plainer request handler.

Two things this service exists to demonstrate, both hard to see in a library API:

* **The live harness can change while requests are in flight.** A reader resolves the ref
  and grabs a generation's tree before doing work; a concurrent adoption moves the pointer
  underneath it. Neither should observe a half-written harness. `resolve()` is the seam.
* **Every state change is an event.** Adoptions and rollbacks emit to subscribers, so a UI
  can show what happened rather than poll for a diff.

What it is not: there is no authentication, no rate limiting and no TLS. It binds loopback
by default for a reason -- see `serve()`.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .models import home_for
from .providers import (
    KEY_ALIASES,
    WRITABLE_KEYS,
    ProviderError,
    read_providers,
    update_provider_values,
)
from .store import Store, StoreError

MAX_EVENTS = 1000

# The settings routes that change a file rather than the live harness. Named
# once so the router and the tests cannot drift apart on a string.
SETTINGS_PROVIDERS = "/settings/providers"


@dataclass
class Event:
    seq: int
    kind: str
    at: float
    data: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {"seq": self.seq, "kind": self.kind, "at": self.at, "data": self.data}


class EventLog:
    """A bounded, seq-numbered log. Subscribers can replay from a seq and then follow.

    A deque plus a condition variable rather than an async queue: the writer only ever
    appends, and readers only ever read forward from a cursor, so this is the whole contract.
    """

    def __init__(self, maxlen: int = MAX_EVENTS) -> None:
        self._events: deque[Event] = deque(maxlen=maxlen)
        self._cond = threading.Condition()
        self._seq = 0
        self._closed = False

    def emit(self, kind: str, **data) -> Event:
        with self._cond:
            self._seq += 1
            ev = Event(seq=self._seq, kind=kind, at=time.time(), data=dict(data))
            self._events.append(ev)
            self._cond.notify_all()
            return ev

    def since(self, seq: int, *, timeout: float = 0.0) -> list[Event]:
        """Events after `seq`; blocks up to `timeout` when there are none yet."""
        deadline = time.monotonic() + timeout
        with self._cond:
            while not self._closed:
                out = [e for e in self._events if e.seq > seq]
                if out or timeout <= 0:
                    return out
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return []
                self._cond.wait(remaining)
            return [e for e in self._events if e.seq > seq]

    def since_with_first(self, seq: int) -> tuple[list[Event], int]:
        """The events after `seq` and the oldest seq held, as one snapshot.

        Two calls would be two acquisitions, and the deque can roll in
        between: the gap reported would then not belong to the batch that
        came back with it.
        """
        with self._cond:
            out = [e for e in self._events if e.seq > seq]
            first = self._events[0].seq if self._events else self._seq + 1
            return out, first

    def close(self) -> None:
        with self._cond:
            self._closed = True
            self._cond.notify_all()

    @property
    def closed(self) -> bool:
        with self._cond:
            return self._closed

    @property
    def first_seq(self) -> int:
        """The oldest seq still held. A cursor behind this has lost events."""
        with self._cond:
            return self._events[0].seq if self._events else self._seq + 1

    @property
    def last_seq(self) -> int:
        with self._cond:
            return self._seq

    def all(self) -> list[Event]:
        with self._cond:
            return list(self._events)


@dataclass
class Snapshot:
    """What a request resolved: the generation id and its tree, together.

    Returned as one value on purpose. Asking "which generation is live" and "give me its
    tree" as two calls is a race; a swap between them yields a tree that does not belong to
    the id. Callers here always get a matched pair.
    """

    generation: str
    content_hash: str
    tree: dict[str, str]
    forked_at: float


class LiveHarness:
    """The seam between the pointer and the bytes.

    `resolve()` is the only way to get a harness in this service, so there is exactly one
    place that has to be correct under concurrent swaps.

    **Two locks, on purpose.** A single lock around both reading and adopting measured badly:
    an adoption spends ~150ms inside the gate, and every reader blocked behind it. The split
    is:

    * `_write_lock` serialises adoptions, which must not interleave (two gates seeing the
      same `live` would both be validated against a stale baseline).
    * `_swap_lock` is held only for the two pointer operations that must appear atomic
      together: reading the ref and caching the tree, or writing the ref and dropping the
      cache. It is never held across a gate, so readers never wait for one.

    The cache makes the read path O(1) after the first hit; it is keyed by generation id,
    and a swap clears it under the swap lock, so a reader can never be handed a tree that
    does not match the id it was resolved with.
    """

    def __init__(self, store: Store, events: EventLog, ref: str = "stable") -> None:
        self.store = store
        self.events = events
        self.ref = ref
        self._write_lock = threading.Lock()
        self._swap_lock = threading.Lock()
        self._cache: tuple[str, str, dict[str, str]] | None = None

    def _snapshot_locked(self) -> Snapshot:
        # The cache cannot be validated by asking the store which generation is live: that
        # read alone is ~270us and, under the GIL, every reader pays it. The ref only changes
        # through this object (adopt/rollback both clear the cache under this lock), so a
        # populated cache IS the answer until something here invalidates it.
        if self._cache is not None:
            gen_id, digest, tree = self._cache
            return Snapshot(
                generation=gen_id,
                content_hash=digest,
                tree=tree,
                forked_at=time.time(),
            )
        gen = self.store.current(self.ref)
        tree = self.store.tree_of(gen.id)
        self._cache = (gen.id, gen.content_hash, tree)
        return Snapshot(
            generation=gen.id,
            content_hash=gen.content_hash,
            tree=tree,
            forked_at=time.time(),
        )

    def resolve(self) -> Snapshot:
        with self._swap_lock:
            return self._snapshot_locked()

    def refresh(self) -> Snapshot:
        """Drop the cache and re-read. Needed only if the store is changed by another
        process, which this service does not do; kept explicit rather than implicit."""
        with self._swap_lock:
            self._cache = None
            return self._snapshot_locked()

    def adopt(self, tree: dict[str, str], *, kind: str = "auto", note: str = "") -> dict:
        """Gate then commit, emitting the verdict either way.

        The gate runs OUTSIDE the swap lock: it reads the live tree once, then spends its
        time in subprocesses. Only the commit moves the pointer, under both locks.
        """
        from .gate import gate

        with self._write_lock:
            with self._swap_lock:
                live = self.store.current(self.ref)
                live_tree = self.store.tree_of(live.id)
            verdict = gate(self.store.surface, live_tree, tree)
            gen = None
            if verdict.ok:
                with self._swap_lock:
                    gen = self.store.commit(
                        live.id,
                        tree,
                        kind=kind,
                        note=note or verdict.explain(),
                        ref=self.ref,
                        evidence={"gate.json": json.dumps(verdict.to_dict(), indent=2)},
                    )
                    self._cache = None
        payload = {
            "ok": verdict.ok,
            "level": verdict.level,
            "reason": verdict.reason,
            "generation": gen.id if gen else None,
        }
        self.events.emit("adoption.accepted" if verdict.ok else "adoption.rejected", **payload)
        return payload

    def rollback(self, gen_id: str) -> dict:
        with self._swap_lock:
            ref = self.store.rollback(gen_id, name=self.ref)
            self._cache = None
        payload = {"generation": ref.generation, "by": ref.by}
        self.events.emit("ref.moved", ref=self.ref, **payload)
        return payload


def _json_bytes(obj: Any) -> bytes:
    return json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")


class _Server(ThreadingHTTPServer):
    """ThreadingHTTPServer with a listen backlog that can hold a burst.

    The stdlib default is `request_queue_size = 5`. Under a simultaneous connection storm
    the 8th connection is refused at the listen queue and the client retransmits -- roughly
    a 500ms stall on Windows, measured. Raising the backlog removed it (max 592ms -> 15ms).
    This is not load-bearing for correctness, but a service whose p99.9 is a kernel
    retransmit timer is a service that looks broken exactly when it is busiest.
    """

    request_queue_size = 128
    allow_reuse_address = True
    daemon_threads = True


def make_handler(app: "Application") -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "rsi/0.1"
        protocol_version = "HTTP/1.1"

        # -- helpers -------------------------------------------------------

        def _send(self, status: int, body: bytes, ctype: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def _json(self, status: int, obj: Any) -> None:
            self._send(status, _json_bytes(obj), "application/json; charset=utf-8")

        def _error(self, status: int, message: str, **extra) -> None:
            self._json(status, {"error": message, **extra})

        def log_message(self, fmt: str, *args) -> None:  # keep the stress output readable
            if app.verbose:
                super().log_message(fmt, *args)

        # -- routing -------------------------------------------------------

        def do_GET(self) -> None:
            path = urlparse(self.path).path.rstrip("/") or "/"
            try:
                if path == "/":
                    self._json(HTTPStatus.OK, app.info())
                elif path == "/generations":
                    self._json(HTTPStatus.OK, app.generations())
                elif path == "/current":
                    self._json(HTTPStatus.OK, app.current())
                elif path == "/current/tree":
                    self._json(HTTPStatus.OK, app.current_tree())
                elif path == "/events":
                    self._stream_events()
                elif path == "/models":
                    # Advertised by the service, not by the client: which models
                    # exist is a fact about the endpoint the service talks to,
                    # and a client that asks over HTTP does not need to import
                    # the model client to draw a dropdown.
                    from .agent import available_models

                    self._json(HTTPStatus.OK, {"models": available_models()})
                elif path == SETTINGS_PROVIDERS:
                    self._json(HTTPStatus.OK, app.providers())
                elif path.startswith("/generations/"):
                    self._json(HTTPStatus.OK, app.show(path.rsplit("/", 1)[-1]))
                elif path.startswith("/runs/"):
                    self._json(HTTPStatus.OK, app.run_state(path.rsplit("/", 1)[-1]))
                elif path == "/events/since":
                    after = 0
                    q = urlparse(self.path).query
                    for part in q.split(chr(38)):
                        if part.startswith("after="):
                            try:
                                after = int(part.split("=", 1)[1])
                            except ValueError:
                                after = 0
                    # A snapshot read must return at once. since() defaults to
                    # no wait, so the empty log this is usually called on
                    # cannot turn the poll into a block.
                    #
                    # The events and the oldest seq held are read together: two
                    # acquisitions could see the deque roll between them and
                    # report a gap that does not belong to this batch.
                    now, first = app.events.since_with_first(after)
                    now = [e.to_dict() for e in now]
                    # A cursor older than the oldest event still held has missed
                    # some for good. Saying so costs nothing, and a client told
                    # about the hole can report a trimmed log instead of quietly
                    # showing a stream with events missing from the middle.
                    #
                    # Events are numbered from 1, so a cursor of `after` has
                    # read through `after`; anything below the oldest still
                    # held was dropped. Cursor 0 means "nothing read yet" and
                    # is just as capable of being behind as any other.
                    dropped = max(0, first - after - 1)
                    self._json(HTTPStatus.OK, {"events": now, "dropped": dropped})
                elif path == "/verify":
                    problems = app.live.store.verify()
                    self._json(
                        HTTPStatus.OK if not problems else HTTPStatus.CONFLICT,
                        {"ok": not problems, "problems": problems},
                    )
                else:
                    self._error(HTTPStatus.NOT_FOUND, f"no route for {path}")
            except StoreError as exc:
                self._error(HTTPStatus.NOT_FOUND, str(exc))
            except Exception as exc:  # a bug in a handler must not kill the server
                self._error(HTTPStatus.INTERNAL_SERVER_ERROR, f"{type(exc).__name__}: {exc}")

        def do_POST(self) -> None:
            path = urlparse(self.path).path.rstrip("/") or "/"
            try:
                body = self._read_json()
                if path == "/adopt":
                    tree = body.get("tree")
                    if not isinstance(tree, dict) or not tree:
                        self._error(HTTPStatus.BAD_REQUEST, "body needs a non-empty 'tree' object")
                        return
                    result = app.live.adopt(
                        {str(k): str(v) for k, v in tree.items()},
                        kind=str(body.get("kind") or "auto"),
                        note=str(body.get("note") or ""),
                    )
                    self._json(HTTPStatus.OK if result["ok"] else HTTPStatus.UNPROCESSABLE_ENTITY, result)
                elif path == "/rollback":
                    gen = str(body.get("generation") or "")
                    if not gen:
                        self._error(HTTPStatus.BAD_REQUEST, "body needs 'generation'")
                        return
                    self._json(HTTPStatus.OK, app.live.rollback(gen))
                elif path == "/run":
                    task = str(body.get("task") or "").strip()
                    if not task:
                        self._error(HTTPStatus.BAD_REQUEST, "body needs a non-empty 'task'")
                        return
                    # Refuse up front whatever would fail a moment later in the
                    # worker. Answering 202 and failing asynchronously makes the
                    # client watch a run that never had a chance, and the error
                    # only shows up if it thinks to poll for it.
                    if app.executor is None:
                        self._error(
                            HTTPStatus.CONFLICT,
                            "this service has no executor configured; it can "
                            "serve reads but cannot run a task",
                        )
                        return
                    session = body.get("session") or None
                    if session is not None and app.sessions is not None:
                        try:
                            app.sessions.get(session)
                        except Exception as exc:
                            self._error(
                                HTTPStatus.NOT_FOUND,
                                "no such session: " + str(session),
                                detail=str(exc),
                            )
                            return
                    run_id = app.start_run(
                        task,
                        session=session,
                        model=body.get("model") or None,
                        # Empty and absent both mean "the model's own default",
                        # so neither reaches the engine as a level to look up.
                        reasoning=body.get("reasoning") or None,
                    )
                    self._json(HTTPStatus.ACCEPTED, {"run": run_id, "state": "running"})
                else:
                    self._error(HTTPStatus.NOT_FOUND, f"no route for {path}")
            except StoreError as exc:
                self._error(HTTPStatus.CONFLICT, str(exc))
            except json.JSONDecodeError as exc:
                self._error(HTTPStatus.BAD_REQUEST, f"body is not JSON: {exc}")
            except Exception as exc:
                self._error(HTTPStatus.INTERNAL_SERVER_ERROR, f"{type(exc).__name__}: {exc}")

        def do_PATCH(self) -> None:
            path = urlparse(self.path).path.rstrip("/")
            try:
                body = self._read_json()
                if path.startswith(SETTINGS_PROVIDERS + "/"):
                    provider_id = path.rsplit("/", 1)[-1]
                    self._json(HTTPStatus.OK, app.patch_provider(provider_id, body))
                else:
                    self._error(HTTPStatus.NOT_FOUND, f"no route for {path}")
            except ProviderError as exc:
                # The message says what would have to change instead, and the
                # status is the one the exception already chose: this module
                # rejects by file state, not by request shape alone.
                self._error(exc.status, str(exc))
            except json.JSONDecodeError as exc:
                self._error(HTTPStatus.BAD_REQUEST, f"body is not JSON: {exc}")
            except Exception as exc:
                self._error(HTTPStatus.INTERNAL_SERVER_ERROR, f"{type(exc).__name__}: {exc}")

        # -- internals -----------------------------------------------------

        def _read_json(self) -> dict:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return {}
            raw = self.rfile.read(length)
            data = json.loads(raw.decode("utf-8"))
            if not isinstance(data, dict):
                raise json.JSONDecodeError("body must be a JSON object", "", 0)
            return data

        def _stream_events(self) -> None:
            """Server-sent events: replay from ?since=N, then follow until the client leaves."""
            q = urlparse(self.path).query
            since = 0
            for part in q.split("&"):
                if part.startswith("since="):
                    try:
                        since = int(part.split("=", 1)[1])
                    except ValueError:
                        since = 0
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            try:
                while not app.stopped.is_set():
                    events = app.events.since(since, timeout=1.0)
                    if app.events.closed and not events:
                        return
                    for ev in events:
                        since = ev.seq
                        self.wfile.write(b"data: " + _json_bytes(ev.to_dict()) + b"\n\n")
                    self.wfile.flush()
                    if not events:
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                # A client that went away is not an error worth a traceback:
                # it is the normal end of a stream. On Windows this arrives as
                # ConnectionAbortedError (10053), which is not a BrokenPipe.
                return

    return Handler


def _attach_retry_hook(agent, emit) -> None:
    """Route an agent's retry notices into the run's event stream.

    A retry is worth showing: without it a run that is waiting out a 5xx just
    looks stuck for seconds. The hook is attached from outside because the
    agent may have been built by a caller's own factory, so there is nowhere in
    Agent itself that knows about the service.
    """
    if agent is None:
        return

    def announce(attempt, total, why):
        emit("model.retry", {"attempt": attempt, "of": total, "reason": str(why)[:200]})

    try:
        agent._on_retry = announce
    except AttributeError:
        # A runner that does not accept the hook is not an error: it simply
        # has nothing to announce.
        pass


def session_executor(store, sessions, surface, *, agent_factory=None):
    """An executor that runs a session through SessionStore, emitting as it goes.

    This is the seam that keeps persistence and the event stream on the same
    execution: sessions.run writes the transcript and the index, and its
    on_event is what the service forwards. Splitting them would mean a run
    that can be watched but not found afterwards.

    The engine behind a runner is started once and reused. Starting it costs
    about a second, and keeping the process alive is also what makes a run
    steerable: a turn can only be redirected while the process that issued it
    is still there. It is also what makes a conversation continuous: the runner
    keeps the engine thread that holds the dialogue.

    Runners are therefore cached per model rather than built per run. Building
    one per run would give each run a fresh engine process -- losing the
    conversation it was supposed to continue, and leaking the previous process
    since nothing held it long enough to close it.
    """
    from .agent import harness_system_prompt
    from .engine import AgentRunner

    engines: dict[str, object] = {}

    def _runner(model):
        if agent_factory is None:
            key = "default"
            if key not in engines:
                engines[key] = AgentRunner()
            return engines[key]
        key = str(model or "")
        if key not in engines:
            engines[key] = agent_factory(model)
        return engines[key]

    def run(task, emit, session, model, reasoning=None):
        sid = session or (sessions.create(title=task[:40], model=model or "").id)
        gen = store.current("stable")
        harness = store.tree_of(gen.id)
        agent = _runner(model)
        # Re-attached every run: the hook reports a retry to whoever is
        # watching *this* run, and a cached runner would otherwise keep
        # announcing into the channel of whichever run built it.
        _attach_retry_hook(agent, emit)
        # Handed on only when there is a level to hand on: `sessions.run` takes
        # it as a keyword, and a run that names no level must not require the
        # callee to accept the word.
        extra = {"reasoning": reasoning} if reasoning else {}
        return sessions.run(
            sid, task, harness, surface,
            generation=gen.id, agent=agent,
            # The model chosen in the window is the model this run uses. It was
            # reaching _run_worker and stopping there, so the choice was
            # accepted, recorded and then ignored.
            model=model or None,
            # The effort level is handed on unread: this service does not know
            # which levels a model has, and a level it invented would be a level
            # the engine could not honour.
            **extra,
            # The session is the conversation: its runs continue one dialogue,
            # and no other session may share it. Without this the engine filed
            # runs by directory, so two sessions working in the same folder
            # remembered each other's turns.
            conversation=sid,
            system_prompt=harness_system_prompt(surface, harness),
            on_event=emit,
        )

    def close():
        held = list(engines.values())
        engines.clear()
        for runner in held:
            if hasattr(runner, "close"):
                runner.close()

    run.close = close
    return run


class Application:
    """Route bodies, separated from the HTTP plumbing so they can be tested directly."""

    def __init__(
        self,
        store: Store,
        *,
        ref: str = "stable",
        verbose: bool = False,
        sessions = None,
        home: Path | str | None = None,
    ) -> None:
        self.store = store
        self.ref = ref
        self.verbose = verbose
        self.sessions = sessions
        # The engine home the settings routes edit. Callers usually pass the one
        # the window is already using; deriving it from the store keeps a
        # service started from the CLI pointed at the same directory, because
        # a settings write and a run must not be reading two different files.
        if home is None:
            home = home_for(store.root)
        self.home = Path(home)
        self._providers_lock = threading.Lock()
        self.events = EventLog()
        self.live = LiveHarness(store, self.events, ref=ref)
        self.stopped = threading.Event()
        self.executor = None
        # Settled runs are kept so a client that asked for one still finds it,
        # but only so many: this is meant to run for a long time, and a dict
        # that only ever grows is a leak with a friendly name. Ordered by
        # insertion, so the bound sheds the oldest, which the transcript on
        # disk still covers.
        self.runs: dict[str, dict] = {}
        self.max_runs = 200
        # How long a settled run is spared from pruning, so a watcher that
        # has not polled yet still finds it.
        self.run_grace = 30.0
        self._runs_lock = threading.Lock()

    # -- read-side ---------------------------------------------------------

    def info(self) -> dict:
        return {
            "service": "rsi",
            "store": str(self.store.root),
            "ref": self.ref,
            "generations": len(self.store.generations()),
            "last_event": self.events.last_seq,
        }

    def current(self) -> dict:
        snap = self.live.resolve()
        return {
            "generation": snap.generation,
            "content_hash": snap.content_hash,
            "files": sorted(snap.tree),
        }

    def current_tree(self) -> dict:
        """The live tree itself; separate from /current so the hot path stays small."""
        snap = self.live.resolve()
        return {
            "generation": snap.generation,
            "content_hash": snap.content_hash,
            "tree": snap.tree,
        }

    def generations(self) -> dict:
        gens = self.store.generations()
        refs = self.store.refs()
        return {
            "generations": [g.to_dict() for g in gens],
            "refs": {k: v.to_dict() for k, v in refs.items()},
        }


    # -- settings ------------------------------------------------------
    #
    # These routes change a file, not the live harness, so nothing here touches
    # the event log: a subscriber watching for adoptions should not be woken by
    # a base URL edit. The engine re-reads config.toml on its next turn, so a
    # save takes effect without a reload this service would have to arrange.

    def providers(self) -> dict:
        """The configured providers, without any credential in the answer."""
        return {
            "home": str(self.home),
            "providers": [p.describe() for p in read_providers(self.home)],
        }

    def patch_provider(self, provider_id: str, body: dict) -> dict:
        """Apply the writable fields in `body` to one provider, then answer with the result.

        The whole request is applied as one edit: every field is checked before
        the file is touched, and the ones that survive are written in a single
        replacement. A request that names a valid field and an invalid one
        therefore leaves the file byte for byte as it was, so a caller can read
        any refusal as "nothing changed".
        """
        if not isinstance(body, dict) or not body:
            raise ProviderError(
                "body needs at least one of " + ", ".join(WRITABLE_KEYS + tuple(KEY_ALIASES))
            )
        unknown = sorted(set(body) - set(WRITABLE_KEYS) - set(KEY_ALIASES))
        if unknown:
            # The aliases are named too: `api_key` is the name the window uses,
            # and a refusal that omits it would read as if that field did not exist.
            raise ProviderError(
                "cannot change " + ", ".join(unknown) + "; writable keys are "
                + ", ".join(WRITABLE_KEYS + tuple(KEY_ALIASES))
            )
        wanted: dict[str, str] = {}
        for key in WRITABLE_KEYS + tuple(KEY_ALIASES):
            if key not in body:
                continue
            # An empty string is the window's way of saying "the field was left
            # alone": a masked key box comes back empty when untouched, and
            # writing that would erase a working credential. Skipping it here
            # rather than in the writer keeps "blank means nothing" a fact about
            # this request, not about the file format.
            if isinstance(body[key], str) and not body[key].strip():
                continue
            wanted[key] = body[key]
        if not wanted:
            # Every field the request named was blank. The honest answer is the
            # provider as it stands, not a refusal: "left alone" is a recognised
            # request, and the caller gets back the state it should draw.
            for provider in read_providers(self.home):
                if provider.id == provider_id:
                    return {"ok": True, "provider": provider.describe(), "changed": []}
            raise ProviderError("provider " + provider_id + " is not in the config", status=404)
        with self._providers_lock:
            changed = update_provider_values(self.home, provider_id, wanted)
        for provider in read_providers(self.home):
            if provider.id == provider_id:
                return {"ok": True, "provider": provider.describe(), "changed": changed}
        raise ProviderError("provider " + provider_id + " is not in the config", status=404)

    # -- runs ----------------------------------------------------------

    def start_run(self, task, session=None, model=None, reasoning=None):
        run_id = uuid.uuid4().hex[:12]
        with self._runs_lock:
            self.runs[run_id] = {'state': 'running', 'task': task, 'started': time.time()}
        self.events.emit('run.started', run=run_id, task=task, session=session)
        threading.Thread(
            target=self._run_worker, args=(run_id, task, session, model, reasoning),
            name='rsi-run-' + run_id, daemon=True,
        ).start()
        return run_id

    def _run_worker(self, run_id, task, session, model, reasoning=None):
        executor = self.executor
        if executor is None:
            self._finish_run(run_id, error='no executor configured')
            return
        try:
            result = executor(task, self._emit_for(run_id), session, model, reasoning)
        except Exception as exc:
            self._finish_run(run_id, error=type(exc).__name__ + ': ' + str(exc))
            return
        self._finish_run(run_id, result=result)


    def _emit_for(self, run_id):
        def emit(kind, data):
            payload = dict(data or {})
            payload['run'] = run_id
            self.events.emit(kind, **payload)
        return emit

    def _finish_run(self, run_id, result=None, error=None):
        with self._runs_lock:
            rec = self.runs.get(run_id) or {}
            rec['state'] = 'error' if error else 'done'
            rec['error'] = error or ''
            rec['finished'] = time.time()
            if result is not None:
                rec['final'] = getattr(result, 'final', '')
                rec['ok'] = bool(getattr(result, 'ok', False))
                # The run id the service minted is not the id the session
                # store used: they are different namespaces, and a client
                # wanting to render this run's transcript needs the latter.
                session_run = getattr(result, 'id', '')
                if session_run:
                    rec['session_run'] = str(session_run)
            self.runs[run_id] = rec
            self._prune_runs(keep=run_id)

    def _prune_runs(self, keep=None, grace=None):
        """Shed old settled runs, keeping the ones a watcher may still ask for.

        A run that has just settled has not necessarily been read: a client
        polls every 150ms, so its terminal state is exactly the thing nobody
        has seen yet. Dropping it there would answer 'no such run' for a run
        that succeeded a moment ago, which reads to the user as a failure.
        So: never the run that just settled, and never one settled within the
        grace window. Everything older is only reachable through
        SessionStore, which is where the transcript lives anyway.
        """
        if len(self.runs) <= self.max_runs:
            return
        if grace is None:
            grace = self.run_grace
        cutoff = time.time() - grace
        for key, rec in list(self.runs.items()):
            if len(self.runs) <= self.max_runs:
                break
            if key == keep:
                continue
            if rec.get('state') == 'running':
                continue
            if rec.get('finished', 0.0) > cutoff:
                continue
            self.runs.pop(key, None)

    def run_state(self, run_id):
        with self._runs_lock:
            rec = self.runs.get(run_id)
        if rec is None:
            raise StoreError('no such run: ' + run_id)
        return dict(rec)

    def show(self, gen_id: str) -> dict:
        g = self.store.get(gen_id)
        tree = self.store.tree_of(gen_id)
        return {
            **g.to_dict(),
            "lineage": [x.id for x in self.store.lineage(gen_id)],
            "files": {rel: len(body) for rel, body in sorted(tree.items())},
        }


def serve(
    store_root: Path | str | None = None,
    surface = None,
    *,
    store: Store | None = None,
    host: str = "127.0.0.1",
    port: int = 0,
    ref: str = "stable",
    verbose: bool = False,
    sessions = None,
    home: Path | str | None = None,
) -> tuple[_Server, Application, threading.Thread]:
    """Start the service on a background thread; returns (server, app, thread).

    Callers may hand in a Store they already opened. There is then one Store per
    process instead of two: open_store builds in-process caches, and two copies of
    that cache cannot see each other write.

    Binds loopback by default: there is no auth here, and exposing a listener that will
    adopt agent-authored code to a network is not something to do implicitly.
    """
    if store is None:
        if store_root is None or surface is None:
            raise ValueError("serve needs either store= or store_root= plus surface=")
        from .store import open_store

        store = open_store(Path(store_root), surface)
    app = Application(store, ref=ref, verbose=verbose, sessions=sessions, home=home)

    httpd = _Server((host, port), make_handler(app))
    httpd.daemon_threads = True
    thread = threading.Thread(target=httpd.serve_forever, name="rsi-http", daemon=True)
    thread.start()
    app.events.emit("service.started", host=host, port=httpd.server_address[1])
    return httpd, app, thread


def url_of(httpd: ThreadingHTTPServer) -> str:
    host, port = httpd.server_address[:2]
    return f"http://{host}:{port}"


__all__ = [
    "Application",
    "Event",
    "EventLog",
    "LiveHarness",
    "Snapshot",
    "make_handler",
    "serve",
    "url_of",
]
