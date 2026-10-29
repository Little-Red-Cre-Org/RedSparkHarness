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

"""Sessions and workspaces: the durable objects the GUI manages.

A session is one long-lived conversation with one agent, bound to one workspace and one
generation of the harness. Keeping them separate matters, because the interesting
comparison in this project is the same task under two harnesses: same workspace, same
model, different generation. So the generation is recorded on each RUN, not baked into the
session, and a session can be re-run after the harness changes.

Layout:

    <root>/sessions/<id>/session.json      id, title, model, workspace, created_at
    <root>/sessions/<id>/workspace/        the files the agent writes
    <root>/sessions/<id>/runs/<run-id>/    transcript.md, meta.json, deliverables
"""

from __future__ import annotations

import inspect
import json
import os
import re
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

# Deliberately no `from .agent import ...`: a session stores runs and owns a
# workspace, it does not decide how a run is executed. It asks for an object with
# an `Agent.run`-shaped method and a `harness_system_prompt` callable. That keeps
# the storage layer usable with a scripted runner (tests, replays) and stops this
# module from importing an HTTP client it has no opinion about.
from typing import Any, Callable, Protocol, runtime_checkable

from harness2.core.tree import SurfaceSpec


@runtime_checkable
class RunResult(Protocol):
    """What a session reads off a finished run in order to persist it.

    `agent.AgentRun` satisfies this. Spelling it out matters: these seven
    attributes are the real contract between execution and storage, and leaving
    them implicit is how the two layers drift back together.
    """

    model: str
    final: str
    error: str
    seconds: float
    steps: list[Any]

    @property
    def ok(self) -> bool: ...

    def transcript(self) -> str: ...

    def to_dict(self) -> dict: ...


@runtime_checkable
class Runner(Protocol):
    """What a session needs from whatever executes a task.

    `agent.Agent` satisfies this. So does a fake in a test, which is the point:
    the two halves can be exercised apart.
    """

    def run(
        self,
        task: str,
        workspace: Any,
        harness: dict[str, str],
        surface: SurfaceSpec,
        *,
        on_step: Callable[[Any], None] | None = None,
        on_event: Callable[[str, dict], None] | None = None,
        model: str | None = None,
        conversation: str | None = None,
        reasoning: str | None = None,
    ) -> RunResult: ...

_ID = re.compile(r"^[0-9a-f]{8,16}$")
SESSION_FILE = "session.json"


class SessionError(RuntimeError):
    """A session operation was refused; the message says why."""


def _takes_on_event(runner) -> bool:
    """Whether a runner accepts on_event, without requiring it to.

    The Protocol names the hook, but a fake or an older runner may stop at
    on_step. Passing a keyword such a runner does not accept would turn an
    optional hook into a hard requirement, which is the opposite of the point.
    """
    return _accepts(runner, "on_event")


def _takes_model(runner) -> bool:
    """Whether a runner accepts a per-run model override.

    Same reasoning as _takes_on_event: a runner that picks its own model is
    still a runner. A caller that asks for one specific model on a runner that
    cannot honour it is silently getting a different model, so the caller is
    expected to check this rather than assume.
    """
    return _accepts(runner, "model")


def _takes_conversation(runner) -> bool:
    """Whether a runner accepts the name of the conversation to resume.

    A runner that has no notion of a stored conversation simply runs the task;
    saying nothing to it is correct, whereas passing a keyword it does not
    accept would raise. The name is also not an id in this module -- it is the
    session id -- so a runner that ignores it is not lying about anything.
    """
    return _accepts(runner, "conversation")


def _takes_reasoning(runner) -> bool:
    """Whether a runner accepts a per-run reasoning effort.

    Same reasoning as _takes_on_event. The level is also model-specific: a
    runner that cannot name its own levels would be handed a value it has no
    way to honour, so silence is the honest answer for one that stops short of
    the keyword.
    """
    return _accepts(runner, "reasoning")


def _accepts(runner, name: str) -> bool:
    """Whether runner.run names this keyword."""
    fn = getattr(runner, "run", None)
    if fn is None:
        return False
    try:
        params = inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return False
    return name in params

@dataclass
class RunRecord:
    """One agent run inside a session."""

    id: str
    session: str
    task: str
    generation: str
    model: str = ""
    created_at: float = 0.0
    final: str = ""
    error: str = ""
    steps: int = 0
    seconds: float = 0.0
    ok: bool = False
    # Run state that the harness tree cannot express. Kept in the index so that
    # "what did this session cost" is answerable without opening every run's
    # meta.json -- that read is cheap per run and linear in the number of runs.
    prompt_tokens: int = 0
    completion_tokens: int = 0
    stop_reason: str = ""

    @property
    def tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "session": self.session,
            "task": self.task,
            "generation": self.generation,
            "model": self.model,
            "created_at": self.created_at,
            "final": self.final,
            "error": self.error,
            "steps": self.steps,
            "seconds": round(self.seconds, 2),
            "ok": self.ok,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "stop_reason": self.stop_reason,
        }


@dataclass
class Session:
    """A durable conversation: a workspace, a model, and a history of runs."""

    id: str
    root: Path
    title: str = ""
    model: str = ""
    created_at: float = 0.0
    updated_at: float = 0.0
    runs: list[RunRecord] = field(default_factory=list)
    # Where this conversation works, when that is not the private directory
    # handed out below. Empty means "the default", which is what every session
    # written before this field existed meant.
    workspace: str = ""

    @property
    def workspace_dir(self) -> Path:
        if self.workspace:
            return Path(self.workspace)
        return self.root / "sessions" / self.id / "workspace"

    @property
    def private_workspace(self) -> bool:
        """Whether the workspace is the one this session owns outright."""
        return not self.workspace

    @property
    def runs_dir(self) -> Path:
        return self.root / "sessions" / self.id / "runs"

    @property
    def meta_path(self) -> Path:
        return self.root / "sessions" / self.id / SESSION_FILE

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "model": self.model,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "runs": [r.to_dict() for r in self.runs],
            "workspace": str(self.workspace_dir),
            "custom_workspace": self.workspace,
        }

    def save(self) -> None:
        self.meta_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "id": self.id,
            "title": self.title,
            "model": self.model,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "runs": [r.to_dict() for r in self.runs],
            "workspace": self.workspace,
        }
        tmp = self.meta_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.meta_path)


class SessionStore:
    """Creates, lists and runs sessions. One directory per session on disk."""

    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)
        (self.root / "sessions").mkdir(parents=True, exist_ok=True)
        # session.json is read-modify-write: a run loads the session, appends its
        # record and saves the whole file. Two runs in one session at once -- two
        # windows watching the same service is enough -- would each save a list
        # that lacks the other's record, and one run would vanish from the index
        # while its transcript sat on disk. One lock per session closes that.
        self._locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    def _lock_for(self, sid: str) -> threading.Lock:
        with self._locks_guard:
            lock = self._locks.get(sid)
            if lock is None:
                lock = threading.Lock()
                self._locks[sid] = lock
            return lock

    # -- creation ------------------------------------------------------

    def create(self, title: str = "", model: str = "", workspace: str = "") -> Session:
        sid = uuid.uuid4().hex[:12]
        now = time.time()
        s = Session(
            id=sid,
            root=self.root,
            title=(title.strip() or "New session"),
            model=model,
            created_at=now,
            updated_at=now,
            workspace=str(workspace or ""),
        )
        s.workspace_dir.mkdir(parents=True, exist_ok=True)
        s.runs_dir.mkdir(parents=True, exist_ok=True)
        s.save()
        return s

    def get(self, sid: str) -> Session:
        if not _ID.match(str(sid)):
            raise SessionError("bad session id: " + repr(sid))
        meta = self.root / "sessions" / sid / SESSION_FILE
        if not meta.is_file():
            raise SessionError("no such session: " + sid)
        d = json.loads(meta.read_text(encoding="utf-8"))
        s = Session(
            id=sid,
            root=self.root,
            title=str(d.get("title") or ""),
            model=str(d.get("model") or ""),
            created_at=float(d.get("created_at") or 0.0),
            updated_at=float(d.get("updated_at") or 0.0),
            # Files written before a session could choose its own directory
            # have no such key, and mean the private one.
            workspace=str(d.get("workspace") or ""),
        )
        for r in d.get("runs") or []:
            s.runs.append(
                RunRecord(
                    id=str(r.get("id") or ""),
                    session=sid,
                    task=str(r.get("task") or ""),
                    generation=str(r.get("generation") or ""),
                    model=str(r.get("model") or ""),
                    created_at=float(r.get("created_at") or 0.0),
                    final=str(r.get("final") or ""),
                    error=str(r.get("error") or ""),
                    steps=int(r.get("steps") or 0),
                    seconds=float(r.get("seconds") or 0.0),
                    ok=bool(r.get("ok")),
                    # Older session.json files predate these fields; .get keeps them
                    # readable instead of failing to load the whole session.
                    prompt_tokens=int(r.get("prompt_tokens") or 0),
                    completion_tokens=int(r.get("completion_tokens") or 0),
                    stop_reason=str(r.get("stop_reason") or ""),
                )
            )
        return s

    def list(self) -> list[Session]:
        base = self.root / "sessions"
        out: list[Session] = []
        if not base.is_dir():
            return out
        for p in sorted(base.iterdir()):
            if not p.is_dir() or not _ID.match(p.name):
                continue
            try:
                out.append(self.get(p.name))
            except (SessionError, ValueError, KeyError):
                continue
        return sorted(out, key=lambda s: s.updated_at, reverse=True)

    def delete(self, sid: str) -> None:
        s = self.get(sid)
        shutil.rmtree(s.root / "sessions" / sid, ignore_errors=True)

    # -- workspace -----------------------------------------------------

    def files(self, sid: str) -> list[dict]:
        """A listing of the workspace, for the UI file tree."""
        s = self.get(sid)
        out: list[dict] = []
        if not s.workspace_dir.is_dir():
            return out
        for p in sorted(s.workspace_dir.rglob("*")):
            if not p.is_file() or "__pycache__" in p.parts:
                continue
            rel = p.relative_to(s.workspace_dir).as_posix()
            out.append({"path": rel, "size": p.stat().st_size})
        return out

    def read(self, sid: str, rel: str) -> str:
        """Read one workspace file; refuses anything outside it."""
        s = self.get(sid)
        target = (s.workspace_dir / rel).resolve()
        if target != s.workspace_dir and s.workspace_dir.resolve() not in target.parents:
            raise SessionError("path escapes the workspace: " + repr(rel))
        if not target.is_file():
            raise SessionError("no such file: " + rel)
        return target.read_text(encoding="utf-8", errors="replace")

    def reindex(self) -> dict:
        """Backfill run state that older session files do not carry.

        Explicit, not automatic: a reader must not rewrite a user's history as a
        side effect. The values live in each run's meta.json, so this reads them
        once and persists them into session.json, where listing can reach them
        without opening every run.
        """
        filled = 0
        touched = 0
        for s in self.list():
            changed = False
            for r in s.runs:
                if r.prompt_tokens or r.completion_tokens:
                    continue
                p = s.runs_dir / r.id / "meta.json"
                if not p.is_file():
                    continue
                try:
                    meta = json.loads(p.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                tr = meta.get("transcript") or {}
                prompt = int(tr.get("prompt_tokens") or 0)
                completion = int(tr.get("completion_tokens") or 0)
                if not (prompt or completion):
                    continue
                r.prompt_tokens = prompt
                r.completion_tokens = completion
                r.stop_reason = str(tr.get("stop_reason") or "")
                filled += 1
                changed = True
            if changed:
                s.save()
                touched += 1
        return {"runs_filled": filled, "sessions_saved": touched}

    def workspace(self, sid: str):
        """The workspace object for a session, without importing the agent module."""
        from .agent import Workspace

        return Workspace(self.get(sid).workspace_dir)

    def set_workspace(self, sid: str, workspace: Path | str | None) -> Session:
        """Point a session at another directory, or back at its own.

        Existing runs stay where they are on disk -- transcripts keep living
        under the session -- so this only decides what the next run works in.
        Handing over a directory is not the same as adopting its contents:
        nothing is copied in either direction.
        """
        wanted = str(workspace or "").strip()
        with self._lock_for(sid):
            session = self.get(sid)
            if wanted:
                target = Path(wanted).expanduser()
                try:
                    target = target.resolve()
                except OSError:
                    target = target.absolute()
                if target.is_file():
                    raise SessionError("not a directory: " + str(target))
                try:
                    target.mkdir(parents=True, exist_ok=True)
                except OSError as exc:
                    raise SessionError("cannot use " + str(target) + ": " + str(exc)) from None
                session.workspace = str(target)
            else:
                session.workspace = ""
                session.workspace_dir.mkdir(parents=True, exist_ok=True)
            session.save()
            return session

    # -- runs ----------------------------------------------------------

    def run(
        self,
        sid: str,
        task: str,
        harness: dict[str, str],
        surface: SurfaceSpec,
        *,
        generation: str = "",
        agent: Runner | None = None,
        workspace: Any | None = None,
        system_prompt: str | None = None,
        model: str | None = None,
        conversation: str | None = None,
        reasoning: str | None = None,
        on_step=None,
        on_event=None,
    ) -> RunRecord:
        """Run `agent` on a task, persist the transcript, and update the session.

        `agent` and `workspace` are injected. There is no default agent here on
        purpose: constructing one would make this module depend on a model client,
        and would quietly pick a model for the caller.
        """
        if agent is None:
            raise SessionError(
                "run() needs an agent to execute the task; pass something with an "
                "Agent.run-shaped method (rsi.agent.Agent satisfies it)"
            )
        s = self.get(sid)
        rid = uuid.uuid4().hex[:12]
        run_dir = s.runs_dir / rid
        run_dir.mkdir(parents=True, exist_ok=True)

        ws = workspace if workspace is not None else self.workspace(sid)
        kwargs = {"on_step": on_step}
        # Only a runner that declares on_event gets one: the Protocol spells it out,
        # but a fake or an older runner may stop at on_step, and passing a keyword
        # it does not accept would turn an optional hook into a hard requirement.
        if on_event is not None and _takes_on_event(agent):
            kwargs["on_event"] = on_event
        # A chosen model is part of the request that was made, so a runner that
        # can honour it is told; one that cannot keeps its own, and the record
        # below reports what the run actually used rather than what was asked.
        if model and _takes_model(agent):
            kwargs["model"] = model
        # The conversation is what the run continues. Two sessions sharing a
        # workspace are still two conversations, so this is named after the
        # session and not derived from the directory.
        if conversation and _takes_conversation(agent):
            kwargs["conversation"] = conversation
        # The effort travels with the request the same way the model does. It is
        # not checked here: this module has no catalogue, so the only validation
        # it could offer would be a guess. The runner that owns the catalogue
        # validates, and drops a level its model does not advertise.
        if reasoning and _takes_reasoning(agent):
            kwargs["reasoning"] = reasoning
        result = agent.run(task, ws, harness, surface, **kwargs)

        (run_dir / "transcript.md").write_text(
            result.transcript(), encoding="utf-8", newline="\n"
        )
        (run_dir / "system_prompt.md").write_text(
            system_prompt if system_prompt is not None else "",
            encoding="utf-8",
            newline="\n",
        )

        rec = RunRecord(
            id=rid,
            session=sid,
            task=task,
            generation=generation,
            model=result.model,
            created_at=time.time(),
            final=result.final,
            error=result.error,
            steps=len(result.steps),
            seconds=result.seconds,
            ok=result.ok,
            # getattr with defaults: a runner may satisfy Runner and nothing more,
            # so cost accounting is optional rather than a new requirement.
            prompt_tokens=int(getattr(result, "prompt_tokens", 0) or 0),
            completion_tokens=int(getattr(result, "completion_tokens", 0) or 0),
            stop_reason=str(getattr(result, "stop_reason", "") or ""),
        )
        (run_dir / "meta.json").write_text(
            json.dumps({**rec.to_dict(), "transcript": result.to_dict()}, indent=2),
            encoding="utf-8",
        )
        # Re-read under the lock, not before the run: another run in this same
        # session may have finished while this one was still going, and saving
        # the session object loaded at the start would drop that record.
        with self._lock_for(sid):
            s = self.get(sid)
            s.runs.append(rec)
            s.updated_at = time.time()
            s.save()
        return rec

    def transcript(self, sid: str, rid: str) -> str:
        p = self.root / "sessions" / sid / "runs" / rid / "transcript.md"
        if not p.is_file():
            raise SessionError("no such run: " + rid)
        return p.read_text(encoding="utf-8", errors="replace")


__all__ = [
    "RunRecord",
    "RunResult",
    "Runner",
    "Session",
    "SessionError",
    "SessionStore",
]
