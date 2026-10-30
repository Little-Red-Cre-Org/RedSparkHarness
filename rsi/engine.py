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

"""RSI Harness's execution engine: the part that actually does the work.

This module is the engine layer of RSI Harness. It replaces the hand-written
loop that could only report what it had already done: it posted a chat
completion, ran the tools, and told you after the fact. The engine keeps the
same work as a JSON-RPC conversation, so a run is observable while it happens
-- token by token, step by step -- and steerable while it runs.

Two things make that worth the subprocess boundary:

* `item/agentMessage/delta` and `item/reasoning/summaryTextDelta` arrive as
  the model produces them, which is what a live view needs. A batch API has no
  equivalent: it reports work once it is complete.
* `turn/steer` changes what the model is doing mid-turn. Measured: told to
  count to 600, steered after five seconds, it wrote 40 lines and answered
  STEERED-OK.

Isolation is not optional. The engine keeps its sessions, state and sandbox in
its own home directory, so this module always points that at .rsi/engine-home:
building RSI Harness must never read or write an installation the user keeps
for something else.

The engine binary is an implementation detail. Nothing outside this module
should name it: RSI Harness owns the sessions, the workspaces, the transcripts
and the event stream, and swapping the engine must not change any of that.
"""

from __future__ import annotations

import json
import os
import queue
import shutil
import signal
import subprocess
import threading
import time
import tomllib
from pathlib import Path
from typing import Any, Callable

from . import itemtext
from .models import DEFAULT_HOME, catalog

START_TIMEOUT = 30.0


class EngineError(RuntimeError):
    """The engine refused a request, or the conversation broke."""


def _end_process(proc: subprocess.Popen) -> None:
    """End the whole engine tree, not just the launcher we happen to own.

    The binary on PATH is not the engine. On Windows `codex` resolves to
    `codex.cmd`, a batch shim that starts node, which starts the real engine;
    terminating the process Popen returned kills the shim and leaves the engine
    running, and nothing else holds a handle to it. One closed window then
    leaves one engine behind, still holding its workspace open.

    So end the tree: the children of this pid are exactly the ones this
    process created, and `taskkill /T` is the only way to reach them on
    Windows. POSIX gets the same treatment through the session the child
    leads.
    """
    if proc.poll() is not None:
        return
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                capture_output=True,
                timeout=15,
                check=False,
            )
        except Exception:
            pass
        try:
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except Exception:
        try:
            proc.terminate()
        except Exception:
            pass
    try:
        proc.wait(timeout=5)
    except Exception:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


class Engine:
    """The engine process: one long-lived conversation server over JSON-RPC.

    Long-lived on purpose. Starting the engine costs about a second, and a
    process that stays open is what makes steering and interrupting possible at
    all: a turn id is only meaningful while the process that issued it is alive.
    """

    def __init__(
        self,
        *,
        home: Path | str | None = None,
        binary: str | None = None,
        cwd: Path | str | None = None,
    ) -> None:
        self.home = Path(home) if home else Path(".rsi") / "engine-home"
        self.binary = binary or shutil.which("codex") or "codex"
        self.cwd = Path(cwd) if cwd else Path.cwd()
        self._proc: subprocess.Popen | None = None
        self._msgs: queue.Queue = queue.Queue()
        self._pending: dict[int, dict] = {}
        self._lock = threading.Lock()
        self._next_id = 0
        self._reader: threading.Thread | None = None
        self._closed = False
        # The bound an approval is judged against, and a record of every
        # decision, so the bound can be demonstrated rather than asserted.
        self.workspace_root: Path | None = None
        self.audit_sink: Callable[[dict], None] | None = None
        self._audit_log: list[dict] = []
        # thread id -> workspace. An approval request names its thread, and
        # that is the only reliable way to know which run is asking: reading a
        # shared field here races the run thread that sets it.
        self._thread_workspace: dict[str, Path] = {}
        # One queue per run that is currently following a thread, so a
        # notification reaches the run it belongs to instead of being taken off
        # a shared queue by whichever run happened to poll first.
        self._subs: dict[str, list[queue.Queue]] = {}

    # -- lifecycle -----------------------------------------------------

    def _ensure_home(self) -> None:
        """Refuse to start against a home with no provider configured.

        An empty home is not an empty default: the engine silently falls back to
        the vendor's public endpoint, and the only symptom is a 401 from the
        network a moment later. Failing here names the real problem instead.
        """
        config = self.home / "config.toml"
        if config.is_file():
            return
        raise EngineError(
            "the engine home has no config.toml ("
            + str(config)
            + "), so it would fall back to a public endpoint. Write a provider "
            "config there, or pass home= with one."
        )

    def start(self) -> None:
        if self._proc is not None:
            return
        env = dict(os.environ)
        # The engine gets its own home inside the project. Pointing it
        # anywhere else would let a build of RSI Harness read or write a
        # runtime the user keeps for something unrelated.
        env["CODEX_HOME"] = str(self.home)
        self.home.mkdir(parents=True, exist_ok=True)
        self._ensure_home()
        cmd = [self.binary, "app-server"]
        try:
            self._proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=str(self.cwd),
                env=env,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                # Give the engine its own session, so close() can reach the
                # whole tree it spawns rather than only the process we own.
                start_new_session=os.name != "nt",
            )
        except FileNotFoundError as exc:
            raise EngineError(
                "no execution engine found on PATH; install one or pass binary= ("
                + str(exc)
                + ")"
            ) from None
        self._reader = threading.Thread(
            target=self._read_loop, name="rsi-engine-rpc", daemon=True
        )
        self._reader.start()
        threading.Thread(
            target=self._drain_stderr, name="rsi-engine-err", daemon=True
        ).start()
        self.call(
            "initialize",
            {"clientInfo": {"name": "rsi", "title": "RSI Harness", "version": "0.1.0"}},
        )

    def close(self) -> None:
        self._closed = True
        proc, self._proc = self._proc, None
        if proc is None:
            return
        _end_process(proc)

    def __enter__(self) -> Engine:
        self.start()
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    # -- approvals -----------------------------------------------------

    def _answer_request(self, msg: dict) -> None:
        """Decide an approval the engine is waiting on.

        The judgement lives in rsi.boundary, where it is tested without a
        process. This method only supplies the inputs and records the answer:
        the workspace root comes from the run, never from this process's own
        working directory, which is what approved a drive-root write the first
        time round.
        """
        from .boundary import decide

        method = msg.get("method", "")
        params = msg.get("params") or {}
        lower = method.lower()
        is_command = "command" in lower or "exec" in lower
        command = params.get("command") if is_command else ""
        if isinstance(command, list):
            command = " ".join(str(x) for x in command)
        # Which workspace is this? Ask the thread that made the request, not
        # whichever run last touched a shared field.
        base = self.workspace_for(str(params.get("threadId") or ""))
        if base is None:
            base = self.workspace_root
        allowed, subject = decide(
            kind="command" if is_command else "path",
            path=self._approval_path(method, params),
            command=str(command or ""),
            base=base,
        )
        decision = "accept" if allowed else "decline"
        self._audit(
            {
                "method": method,
                "path": subject,
                "allowed": allowed,
                "decision": decision,
                "item": params.get("itemId") or params.get("callId") or "",
            }
        )
        # One vocabulary for both request kinds: the schema spells the values
        # accept / acceptForSession / decline / cancel. A value outside it is
        # dropped by the engine, which looks exactly like a denial -- that is
        # how the first version appeared to work while approving everything.
        self._reply(msg.get("id"), {"decision": decision})

    @staticmethod
    def _approval_path(method: str, params: dict) -> str:
        """The path an approval is about, as far as the payload says."""
        for key in ("path", "grantRoot", "target", "file"):
            value = params.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        changes = params.get("changes")
        if isinstance(changes, list) and changes:
            paths = [
                c["path"].strip()
                for c in changes
                if isinstance(c, dict)
                and isinstance(c.get("path"), str)
                and c["path"].strip()
            ]
            if len(paths) == 1:
                return paths[0]
        return ""

    def _reply(self, req_id: Any, result: dict) -> None:
        proc = self._proc
        if proc is None or proc.stdin is None:
            return
        try:
            proc.stdin.write(
                json.dumps({"jsonrpc": "2.0", "id": req_id, "result": result}) + "\n"
            )
            proc.stdin.flush()
        except (BrokenPipeError, OSError):
            pass

    def _audit(self, entry: dict) -> None:
        """One line per decision, so the bound can be shown to have held."""
        entry = dict(entry)
        entry["at"] = round(time.time(), 3)
        with self._lock:
            self._audit_log.append(entry)
            if len(self._audit_log) > 500:
                del self._audit_log[:100]
        sink = self.audit_sink
        if sink is not None:
            try:
                sink(entry)
            except Exception:
                pass

    @property
    def audit_log(self) -> list[dict]:
        with self._lock:
            return list(self._audit_log)

    def bind_thread(self, thread_id: str, workspace: Path | str) -> None:
        """Remember which workspace a thread belongs to."""
        with self._lock:
            self._thread_workspace[thread_id] = Path(workspace)

    def workspace_for(self, thread_id: str) -> Path | None:
        """The workspace a requesting thread belongs to, if it is known."""
        with self._lock:
            return self._thread_workspace.get(thread_id)

    def is_within_workspace(self, path: str) -> bool:
        """Whether a path stays inside the run's workspace.

        The rule is in rsi.boundary and is tested there; this only supplies the
        root. Only the workspace counts -- this process has a cwd of its own,
        and treating that as an allowed root made every sibling of the project
        writable.
        """
        from .boundary import path_is_within

        return path_is_within(path, self.workspace_root)

    # -- transport -----------------------------------------------------

    def _drain_stderr(self) -> None:
        proc = self._proc
        if proc is None or proc.stderr is None:
            return
        for _line in proc.stderr:
            # Kept drained, deliberately discarded: app-server is chatty on
            # stderr and a full pipe would deadlock the conversation.
            pass

    def _read_loop(self) -> None:
        proc = self._proc
        if proc is None or proc.stdout is None:
            return
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "id" in msg and ("result" in msg or "error" in msg):
                with self._lock:
                    slot = self._pending.pop(msg["id"], None)
                if slot is not None:
                    slot["reply"] = msg
                    slot["event"].set()
            elif "id" in msg and "method" in msg:
                # A request FROM the engine: today that means an approval, and
                # an unanswered one stops the turn dead.
                self._answer_request(msg)
            else:
                self._dispatch(msg)
        with self._lock:
            waiting = list(self._pending.values())
            self._pending.clear()
        for slot in waiting:
            slot["reply"] = {"error": {"message": "app-server exited"}}
            slot["event"].set()

    def call(self, method: str, params: dict, timeout: float = START_TIMEOUT) -> dict:
        proc = self._proc
        if proc is None or proc.stdin is None:
            raise EngineError("app-server is not running")
        with self._lock:
            self._next_id += 1
            my_id = self._next_id
            slot: dict[str, Any] = {"event": threading.Event(), "reply": None}
            self._pending[my_id] = slot
        payload = {"jsonrpc": "2.0", "id": my_id, "method": method, "params": params}
        try:
            proc.stdin.write(json.dumps(payload) + "\n")
            proc.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            raise EngineError("app-server stopped accepting input: " + str(exc)) from None
        if not slot["event"].wait(timeout):
            with self._lock:
                self._pending.pop(my_id, None)
            raise EngineError(method + " timed out after " + str(timeout) + "s")
        reply = slot["reply"] or {}
        if "error" in reply:
            raise EngineError(method + ": " + json.dumps(reply["error"])[:400])
        return reply.get("result") or {}

    def notify(self, method: str, params: dict) -> None:
        """Send a notification (no reply expected)."""
        proc = self._proc
        if proc is None or proc.stdin is None:
            raise EngineError("app-server is not running")
        proc.stdin.write(
            json.dumps({"jsonrpc": "2.0", "method": method, "params": params}) + "\n"
        )
        proc.stdin.flush()

    def _dispatch(self, msg: dict) -> None:
        """Hand a notification to the run that is following its thread.

        A single shared queue cannot work once two runs are live: whichever run
        polls first takes the message, so one run's tokens are read by the
        other and lost to its owner. Notifications are therefore routed by the
        threadId every one of them carries. Anything unkeyed stays on the
        general queue, which is where a non-run notification belongs.
        """
        params = msg.get("params") or {}
        thread = str(params.get("threadId") or "")
        if thread:
            with self._lock:
                watchers = list(self._subs.get(thread) or ())
            if watchers:
                for watcher in watchers:
                    watcher.put(msg)
                return
        self._msgs.put(msg)

    def subscribe(self, thread_id: str) -> queue.Queue:
        """A queue for one thread's notifications, for as long as it is held."""
        box: queue.Queue = queue.Queue()
        with self._lock:
            self._subs.setdefault(thread_id, []).append(box)
        return box

    def unsubscribe(self, thread_id: str, box: queue.Queue) -> None:
        with self._lock:
            held = self._subs.get(thread_id) or []
            if box in held:
                held.remove(box)
            if not held:
                self._subs.pop(thread_id, None)

    def events(self) -> queue.Queue:
        return self._msgs


def workspace_root(workspace: Any) -> Path:
    """The directory a run works in.

    Callers hand in either an `agent.Workspace` or the path itself. The two are
    told apart by asking whether the value *is* a path, not by asking whether it
    has a `.root`: `Path` has one of its own, and on Windows it is the drive
    root, so a bare path would be read as "\\". Every caller in this tree passes
    a Workspace, which is why the wrong reading never reached a run; a bare path
    is still an accepted argument, and that is the case this guards.
    """
    if isinstance(workspace, (str, os.PathLike)):
        return Path(workspace)
    return Path(workspace.root)


def conversation_key(conversation: str | None, workdir: Path) -> str:
    """What a run's engine thread is filed under.

    One thread per conversation: it *is* the dialogue the model remembers, so
    two conversations must never share one, and one conversation must keep
    using the same one from run to run.

    The folder is part of the key as well, because a thread's working directory
    is fixed when it is created. A conversation that moves to another folder
    therefore starts a new thread: resuming the old one would run the next
    commands in the folder it was left in, which is not what was just chosen.

    Callers that do not say which conversation they are fall back to the folder,
    which is the old behaviour rather than a new risk.
    """
    name = str(conversation or "").strip()
    if name:
        return "conversation:" + name + "\x00" + str(workdir)
    return "workspace:" + str(workdir)


def _ours(params: dict, thread_id: str, turn_id: str) -> bool:
    """Whether a notification belongs to the turn this run is following.

    Notifications arrive on one queue for the whole engine process, so without
    this check a run reads whatever any other run happens to emit - which is
    how two conversations came to see each other's words. Both ids are required
    by the schema on every notification this loop reads; a message that carries
    neither is not a run notification and is ignored.
    """
    thread = params.get("threadId")
    turn = params.get("turnId")
    if not thread and not turn:
        # Every notification this loop reads carries both ids in the schema. One
        # that carries neither is not a run notification, and guessing it
        # belongs here is exactly what produced the cross-talk.
        return False
    if thread_id and thread and str(thread) != thread_id:
        return False
    if turn_id and turn and str(turn) != turn_id:
        return False
    return True


def _error_text(error: Any) -> str:
    """A one-line message from a TurnError payload."""
    if isinstance(error, dict):
        text = str(error.get("message") or "").strip()
        info = error.get("codexErrorInfo")
        if info and not text:
            text = str(info)
        return text
    return str(error or "").strip()


class AgentRunner:
    """The RSI Harness runner: hands the task to the engine, reports as it goes.

    It satisfies the same protocol as the loop it replaces -- run(task,
    workspace, harness, surface, on_step=, on_event=) -> RunResult -- so
    sessions.py, server.py and the client keep working untouched. What changes
    is where the thinking happens.

    The harness tree is not pushed into the engine as editable files: the engine
    owns its own prompt and tools. Instead the tree's always-on documents are
    handed over as an instruction prefix, which is the part a harness experiment
    actually varies.
    """

    def __init__(
        self,
        engine: Engine | None = None,
        *,
        model: str | None = None,
        sandbox: str = "workspace-write",
        home: Path | str | None = None,
        cwd: Path | str | None = None,
        timeout: float = 900.0,
    ) -> None:
        self._engine = engine
        self._owns_engine = engine is None
        self.model = model
        self.sandbox = sandbox
        self.home = home
        self.cwd = cwd
        self.timeout = timeout
        self._threads: dict[str, str] = {}
        self._thread_ids: dict[str, str] = {}
        # The config.toml a cached thread was started against. A thread binds
        # its provider when it is created and keeps using it for every later
        # turn, so a config change only reaches a run that opens a new thread.
        # Measured: repointing base_url at a dead port left the same thread
        # answering normally, while a fresh thread failed to connect.
        self._config_stamp_seen: tuple[Any, ...] | None = None
        self._active_workspace: Path | None = None
        # NO BOUND IS ENFORCED YET, and saying so is the point. Adjudicating
        # approvals from inside this process proved unsafe: the decision runs
        # on the reader thread while the workspace root is set on the run
        # thread, and paths judged out of bounds were accepted anyway. A bound
        # that reports itself as working while it does not is worse than no
        # bound, so the default is an honest one: do not ask, do not pretend.
        #
        # The rule itself is in rsi.boundary and covered by
        # tests.test_engine_bound. Flipping enforce_bound is what enables it.
        # OFF. Six attempts at adjudicating approvals from inside this process
        # each looked fixed and each let a write through to a drive root, so
        # the switch stays where it is until the rule is exercised against the
        # payloads the engine actually sends, not the ones it was assumed to
        # send. rsi/boundary.py holds the rule and tests.test_engine_bound
        # proves it; what is unproven is the plumbing that feeds it.
        self.approval = "never"
        self.enforce_bound = False

    # -- lifecycle -----------------------------------------------------

    @property
    def engine(self) -> Engine:
        if self._engine is None:
            self._engine = Engine(home=self.home, cwd=self.cwd)
            self._engine.start()
        return self._engine

    def close(self) -> None:
        if self._owns_engine and self._engine is not None:
            self._engine.close()
            self._engine = None

    def __enter__(self) -> AgentRunner:
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    # -- configuration -------------------------------------------------

    def _config_path(self) -> Path:
        """The config.toml this runner starts threads against."""
        return (Path(self.home) if self.home else DEFAULT_HOME) / "config.toml"

    def _config_stamp(self) -> tuple[Any, ...]:
        """Identity of the config a thread would be started against.

        Only the keys thread/start actually reads: the provider, the catalogue
        and the model. A thread binds all three at creation and never re-reads
        them, while `approvalPolicy` and the sandbox policy are sent per turn --
        so an edit to those reaches the next run without a new thread and must
        not cost the conversation its earlier turns.

        Unparseable config falls back to the whole file's (mtime_ns, size): a
        conservative direction, since the cost of one extra thread is smaller
        than running new settings on the connection they were meant to replace.
        A missing config is not that case -- Engine._ensure_home names it when a
        thread actually tries to start.
        """
        path = self._config_path()
        try:
            stat = path.stat()
        except OSError:
            return (0, 0)
        try:
            data = tomllib.loads(path.read_text(encoding="utf-8"))
        except (OSError, tomllib.TOMLDecodeError):
            return (stat.st_mtime_ns, stat.st_size)
        provider = data.get("model_provider")
        block = (data.get("model_providers") or {}).get(provider) or {}
        return (
            provider,
            data.get("model"),
            data.get("model_catalog_json"),
            tuple(sorted((str(key), str(value)) for key, value in block.items())),
        )

    def _forget_threads_if_config_changed(self) -> None:
        """Drop threads started against a config that is no longer there.

        A thread binds its provider at thread/start and never re-reads the
        config, so keeping it after an edit would run the new settings' task on
        the old provider. Clearing the cache costs this run the conversation's
        earlier turns -- acceptable because a provider change is exactly the
        moment the old dialogue is no longer the one being continued.
        """
        stamp = self._config_stamp()
        seen = getattr(self, "_config_stamp_seen", None)
        if self._thread_ids and seen is not None and stamp != seen:
            # Only the reusable-thread map. `_threads` holds live turn ids for
            # runs still in flight; each run removes its own entry when it
            # ends, and clearing it here would take steering away from a turn
            # that is still running under the old config.
            self._thread_ids.clear()
        self._config_stamp_seen = stamp

    def _resolve_effort(self, wanted: str | None, model_id: str) -> str:
        """The effort to ask for, validated against what the model advertises.

        The engine accepts any non-empty string as an effort and silently falls
        back to its own default when it does not recognise one (measured with
        "bogus-level": accepted, no error). A level the model does not list
        would therefore look applied while doing nothing, so only a level read
        back from the model's own entry is ever passed on.

        That rule covers the unreadable case without a separate branch:
        rsi.models.catalog never raises, and an unreadable home reads as no
        models at all, so no entry is found and nothing is verified. Saying
        nothing leaves the engine's default, which is the honest outcome for a
        level this process could not check.

        An empty result means "say nothing": the effort field is left out of the
        turn rather than sent empty.
        """
        want = (wanted or "").strip()
        if not want:
            return ""
        levels: tuple[str, ...] = ()
        default = ""
        for entry in catalog(self.home).models:
            if entry.id == (model_id or ""):
                levels, default = entry.reasoning_levels, entry.default_reasoning_level
                break
        if want in levels:
            return want
        return default if default in levels else ""

    # -- steering ------------------------------------------------------

    def steer(self, workspace_key: str, text: str) -> None:
        """Change what the running turn is doing, without starting a new one.

        This is the capability the old loop had no equivalent for: it could be
        cancelled, never redirected. The key is the one this run filed itself
        under -- see conversation_key() -- not a directory.
        """
        state = self._threads.get(workspace_key)
        if not state:
            raise EngineError("no live turn for " + workspace_key)
        thread_id, turn_id = state
        self.engine.call(
            "turn/steer",
            {
                "threadId": thread_id,
                "expectedTurnId": turn_id,
                "input": [{"type": "text", "text": text}],
            },
            timeout=30.0,
        )

    # -- running -------------------------------------------------------

    def _sandbox_policy(self) -> dict:
        """The sandbox to ask for.

        workspaceWrite is the right box, but the engine gates writes behind an
        approval that nothing answers here, so asking for it produces a run
        that cannot touch a file. Until the bound is enforced in-process the
        policy has to be the one that lets work happen -- and the code says so
        rather than implying a protection it lacks.
        """
        if self.enforce_bound:
            return {"type": "workspaceWrite"}
        return {"type": "dangerFullAccess"}

    def run(
        self,
        task: str,
        workspace: Any,
        harness: dict[str, str],
        surface: Any,
        *,
        model: str | None = None,
        reasoning: str | None = None,
        conversation: str | None = None,
        on_step: Callable[[Any], None] | None = None,
        on_event: Callable[[str, dict], None] | None = None,
    ) -> Any:
        from .agent import AgentRun, Step

        emit = on_event or (lambda kind, data: None)
        started = time.time()
        # The caller's choice wins for this run. It is passed per turn rather
        # than only at thread/start because a thread is reused per workspace:
        # setting it once would pin the first model a workspace ever ran with.
        chosen = model or self.model
        run = AgentRun(task=task, model=chosen or "engine")
        effort = self._resolve_effort(reasoning, chosen)
        self._forget_threads_if_config_changed()

        workdir = workspace_root(workspace)
        workdir.mkdir(parents=True, exist_ok=True)
        key = conversation_key(conversation, workdir)

        engine = self.engine
        engine.workspace_root = workdir
        self._active_workspace = workdir
        if self.enforce_bound:
            engine.audit_sink = lambda entry: emit("approval.decided", entry)
        thread_id = self._start_thread(key, workdir)
        prompt = self._prompt(task, harness)

        step = Step(index=0)
        run.steps.append(step)
        params: dict[str, Any] = {
            "threadId": thread_id,
            "input": [{"type": "text", "text": prompt}],
            "sandboxPolicy": self._sandbox_policy(),
            "approvalPolicy": self.approval,
        }
        if chosen:
            params["model"] = chosen
        if effort:
            # Sent per turn, so a level change applies to the next run without
            # restarting the process. `effort` is the app-server's own field
            # name for TurnStartParams.reasoningEffort.
            params["effort"] = effort
        # Subscribed before the turn starts, so nothing the turn emits can land
        # while no one is listening for this thread.
        box = engine.subscribe(thread_id)
        try:
            result = engine.call("turn/start", params, timeout=60.0)
            turn_id = (result.get("turn") or {}).get("id") or ""
            self._threads[key] = (thread_id, turn_id)
            emit("step.started", {"index": 0})
            self._consume(engine, box, emit, step, run, thread_id, turn_id)
        except Exception as exc:
            run.error = type(exc).__name__ + ": " + str(exc)
            run.stop_reason = run.stop_reason or "error"
        finally:
            self._threads.pop(key, None)
            engine.unsubscribe(thread_id, box)

        if not run.error and not run.stop_reason:
            run.stop_reason = "turn_completed"
        run.seconds = time.time() - started
        if on_step:
            on_step(step)
        emit(
            "run.finished",
            {
                "ok": run.ok,
                "steps": len(run.steps),
                "seconds": round(run.seconds, 2),
                "stop_reason": run.stop_reason,
                "error": run.error,
            },
        )
        return run

    def _start_thread(self, key: str, workdir: Path) -> str:
        """One thread per conversation, reused across that conversation's runs.

        The key is the conversation, not the directory: two conversations
        working in the same folder are still two conversations, and reusing one
        thread for both would hand the second everything the first said.
        """
        if key in self._thread_ids:
            return self._thread_ids[key]
        params: dict[str, Any] = {"cwd": str(workdir)}
        if self.model:
            params["model"] = self.model
        result = self.engine.call("thread/start", params)
        thread_id = (result.get("thread") or {}).get("id") or ""
        if not thread_id:
            raise EngineError("thread/start returned no thread id")
        self._thread_ids[key] = thread_id
        # The approval policy judges against this, per thread.
        self.engine.bind_thread(thread_id, workdir)
        # The stamp only means "this thread was started after the config it is
        # seen with". Taken after the call so an edit landing during startup is
        # caught by the next run rather than assumed applied.
        self._config_stamp_seen = self._config_stamp()
        return thread_id

    def _prompt(self, task: str, harness: dict[str, str]) -> str:
        """The harness's always-on documents, the workspace, then the task.

        Naming the workspace is not decoration. Without it the model infers a
        working directory of its own -- it wrote to a drive root when told to
        create a file "in the current directory" -- and every write then lands
        somewhere the run was never meant to touch.
        """
        parts: list[str] = []
        for name in ("systemprompt.md", "guardrails.md", "LongTermMEMORY.md"):
            body = (harness or {}).get(name) or ""
            if body.strip():
                parts.append("## " + name + "\n" + body.strip())
        if self._active_workspace:
            parts.append("## workspace\n" + str(self._active_workspace))
        parts.append("## task\n" + task.strip())
        return "\n\n".join(parts)

    def _consume(
        self, engine: Engine, box: queue.Queue, emit, step, run, thread_id: str, turn_id: str
    ) -> None:
        """Follow the notification stream until the turn settles.

        The queue is this thread's own, so a second run's tokens never arrive
        here. The ids are still checked: a thread that is reused carries the
        previous turn's late notifications, and those are not this turn's words.
        """
        deadline = time.time() + self.timeout
        thinking: list[str] = []
        # Deltas are grouped by the item they belong to. One turn can carry
        # several agentMessages -- an aside, a correction, then the answer --
        # and joining them all produced a final answer that ran the earlier
        # ones into the last: "...first.The first shell choice...ANSWER: 27".
        # Only the last group with text in it is the answer; see the join below.
        assistant: dict[str, list[str]] = {}
        assistant_order: list[str] = []

        while time.time() < deadline:
            try:
                msg = box.get(timeout=1.0)
            except queue.Empty:
                continue
            method = msg.get("method") or ""
            params = msg.get("params") or {}
            if not _ours(params, thread_id, turn_id):
                continue

            if method == "item/reasoning/summaryTextDelta":
                piece = params.get("delta") or ""
                if piece:
                    thinking.append(piece)
                    emit("step.message", {"index": 0, "thinking": piece, "assistant": ""})
            elif method == "item/agentMessage/delta":
                piece = params.get("delta") or ""
                if piece:
                    item_id = str(params.get("itemId") or "")
                    if item_id not in assistant:
                        assistant_order.append(item_id)
                    assistant.setdefault(item_id, []).append(piece)
                    # Still emitted per delta: the stream is what the user
                    # watches, and each piece is real text as it arrives. Only
                    # the turn's final value is chosen by item below.
                    emit("step.message", {"index": 0, "thinking": "", "assistant": piece})
            elif method == "item/started":
                item = params.get("item") or {}
                kind = item.get("type")
                if kind and kind not in itemtext.CONVERSATION:
                    emit(
                        "tool.called",
                        {
                            "index": 0,
                            "name": itemtext.label(kind),
                            "arguments": itemtext.brief(item),
                        },
                    )
                    step.calls.append(
                        {"name": itemtext.label(kind), "arguments": {"brief": itemtext.brief(item)}}
                    )
            elif method == "item/completed":
                item = params.get("item") or {}
                kind = item.get("type", "")
                if kind and kind not in itemtext.CONVERSATION:
                    ok, ms = itemtext.outcome(item)
                    emit(
                        "tool.result",
                        {"index": 0, "name": itemtext.label(kind), "ok": ok, "ms": ms},
                    )
                    step.results.append(
                        {
                            "output": str(item.get("aggregatedOutput") or item.get("diff") or "")[:2000]
                            or json.dumps(item, ensure_ascii=False)[:2000],
                            "error": not ok,
                        }
                    )
            elif method == "turn/plan/updated":
                emit("plan.updated", {"steps": params.get("plan") or []})
            elif method == "thread/tokenUsage/updated":
                # The notification carries {last, total} under "tokenUsage".
                # "last" is this turn, "total" is the whole thread - and a
                # thread is reused for every run in a conversation, so total
                # would charge this run for all the ones before it.
                usage = params.get("tokenUsage") or {}
                piece = usage.get("last") or usage.get("total") or {}
                run.prompt_tokens = int(piece.get("inputTokens") or run.prompt_tokens)
                run.completion_tokens = int(piece.get("outputTokens") or run.completion_tokens)
            elif method == "turn/completed":
                state = (params.get("turn") or {}).get("status")
                if state == "completed":
                    run.stop_reason = "finish"
                elif state in ("interrupted", "failed"):
                    run.stop_reason = state
                    err = (params.get("turn") or {}).get("error")
                    if err:
                        run.error = str(err)[:400]
                break
            elif method == "error":
                # A retryable error is announced and then retried by the
                # engine; treating it as the end would report a failure the
                # run recovers from on its own.
                if params.get("willRetry"):
                    emit("model.retry", {"reason": _error_text(params.get("error"))})
                    continue
                run.error = _error_text(params.get("error")) or json.dumps(params)[:400]
                run.stop_reason = "error"
                break

        step.thinking = "".join(thinking).strip()
        # The turn's words are the last group that says anything. "Last group"
        # alone would be wrong: an agentMessage can be started and left empty,
        # and picking it would report an empty final answer for a turn that did
        # answer. Walking the order backwards finds the last group with text and
        # keeps the single-message case byte-for-byte what it was.
        final_text = ""
        for item_id in reversed(assistant_order):
            text = "".join(assistant[item_id]).strip()
            if text:
                final_text = text
                break
        step.assistant = final_text
        run.final = step.assistant
        if not run.stop_reason:
            run.stop_reason = "timeout"
            run.error = run.error or "turn did not settle within " + str(self.timeout) + "s"


__all__ = ["AgentRunner", "Engine", "EngineError", "conversation_key"]
