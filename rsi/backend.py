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

"""The executor seam: who runs a task, in an interface sessions.py can hold.

`rsi.runner` answers "which object runs a task" and today that object is the
codex app-server client in `rsi.engine`. This module answers the same question
for OpenHands, and it exists so the answer can change without the session, the
server, or the client knowing.

The shape is not invented here. `sessions.Runner` is a Protocol, and a runner
satisfies it by naming `run(task, workspace, harness, surface, *, on_step=,
on_event=, model=, conversation=, reasoning=)`. A second implementation that
kept a different signature would be a second thing to support; keeping this one
identical means a swap is a change of which class is constructed, and the
dozen `emit(...)` calls in the engine's run loop keep their meaning.

`on_event` receives `(kind, data)` with exactly the kinds the codex engine
emits, so anything reading the event stream -- the desktop window, the SSE
route, a test -- reads the same names whichever backend produced them:

    step.started   {"index": int}
    step.message   {"index": int, "thinking": str, "assistant": str}
    tool.called    {"index": int, "name": str, "arguments": dict}
    tool.result    {"index": int, "name": str, "ok": bool, "ms": int}
    plan.updated   {"steps": [...]}
    model.retry    {"reason": str}
    run.finished   {"ok": bool, "steps": int, "seconds": float,
                    "stop_reason": str, "error": str}
    approval.decided {<engine audit entry>}

**Nothing here imports OpenHands at module import time.** The SDK is a 567 MB
dependency that most of this repository's tests run without, so every module
under `rsi/` must import cleanly on a bare interpreter. The imports live inside
`OpenHandsBackend._conversation`, the same late-import discipline
`oh_config.to_llm` uses.

What turns one of those SDK classes into the pair above is `rsi.oh_events`, and
it is imported lazily for the same reason: a machine without the SDK can still
import this module and use `CodexBackend`.
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from .oh_config import ConfigError, resolve

__all__ = [
    "Backend",
    "BackendError",
    "CodexBackend",
    "OpenHandsBackend",
    "make_backend",
]

# The always-on documents the harness hands an engine, in the order the codex
# engine puts them in a prompt. An executor that cannot take a file tree takes
# these as an instruction prefix instead.
HARNESS_DOCS = ("systemprompt.md", "guardrails.md", "LongTermMEMORY.md")

# What the desktop app and the SSE route are entitled to receive, and what
# `oh_events.translate` must produce. Named once so a translator that invents a
# kind shows up as a test failure rather than as a silent blank pane.
EVENT_KINDS = (
    "step.started",
    "step.message",
    "tool.called",
    "tool.result",
    "plan.updated",
    "model.retry",
    "run.finished",
    "approval.decided",
)


class BackendError(RuntimeError):
    """An executor could not run a task; the message says what stopped it."""


class Backend:
    """What a caller needs from an executor, stated as behaviour.

    This is a base class rather than a second Protocol because the two
    implementations share the keyword surface and a wrong keyword is worth
    catching at construction, not at the third call site.
    """

    #: Which executor this is, for logs and for a client that shows it.
    kind = "backend"

    def start(self) -> None:
        """Make the executor ready. Safe to call more than once."""

    def stop(self) -> None:
        """Release whatever `start` took. Safe to call more than once."""

    def interrupt(
        self, conversation: str | None = None, workspace: Any = None
    ) -> bool:
        """Ask the run in progress on one conversation to stop.

        Returns whether there was anything to interrupt, because a caller that
        reports "cancelled" without knowing would be telling the user something
        it never observed. The default declines: an engine whose run cannot be
        stopped must not claim it can, and `session/cancel` reports what this
        returns rather than assuming.

        `conversation` names the dialogue to stop; `workspace` is the folder it
        runs in, because the same dialogue in two folders is two conversations. A
        backend that serves one dialogue at a time may ignore both.
        """
        return False

    def run(
        self,
        task: str,
        workspace: Any,
        harness: dict[str, str],
        surface: Any,
        *,
        on_step: Callable[[Any], None] | None = None,
        on_event: Callable[[str, dict], None] | None = None,
        model: str | None = None,
        conversation: str | None = None,
        reasoning: str | None = None,
    ) -> Any:
        """Run one task and return a run result session code can read."""
        raise NotImplementedError


def workspace_root(workspace: Any) -> Path:
    """The directory a run works in.

    Same reading as `engine.workspace_root`, and for the same reason: the
    argument is either a Workspace or a path, and a bare `Path` has a `.root`
    of its own -- on Windows that is the drive root, so asking whether the
    value has one would silently turn "D:\\proj" into "D:\\".
    """
    if isinstance(workspace, (str, Path)):
        return Path(workspace)
    root = getattr(workspace, "root", None)
    if root:
        return Path(root)
    raise BackendError("a workspace is needed, and " + repr(workspace) + " has no root")


def harness_prefix(harness: dict[str, str]) -> str:
    """The always-on documents as one instruction block, or "".

    A harness with no documents contributes nothing rather than an empty
    heading: an engine that receives "## systemprompt.md\\n\\n" has been told
    a file exists and is blank, which is not what an empty tree means.
    """
    parts: list[str] = []
    for name in HARNESS_DOCS:
        body = (harness or {}).get(name) or ""
        if body.strip():
            parts.append("## " + name + "\n" + body.strip())
    return "\n\n".join(parts)


@dataclass
class _Turn:
    """The step being filled while a conversation runs.

    The codex loop builds a `Step` and appends it before the turn starts, so
    the caller's `on_step` sees it even for a turn that dies immediately. This
    holds the same fields and is turned into a `Step` at the end.
    """

    index: int = 0
    thinking: list[str] = field(default_factory=list)
    assistant: list[str] = field(default_factory=list)
    calls: list[dict] = field(default_factory=list)
    results: list[dict] = field(default_factory=list)
    # What the agent said when it called `finish`. OpenHands' agent answers by
    # calling that tool, and the answer arrives as the call's observation rather
    # than as an assistant message, so the run would finish with an empty final
    # and the window would show "完成" above nothing.
    answer: list[str] = field(default_factory=list)


class OpenHandsBackend(Backend):
    """Runs a task through the OpenHands SDK.

    The conversation is reused per (conversation, workspace) the same way the
    codex engine reuses a thread: it *is* the dialogue the model remembers, so
    two conversations must never share one, and the folder is part of the key
    because a conversation that moves to another folder must not keep running
    commands in the folder it was left in.
    """

    kind = "openhands"

    def __init__(
        self,
        *,
        home: Path | str,
        cwd: Path | str | None = None,
        model: str | None = None,
        timeout: float = 900.0,
    ) -> None:
        self.home = Path(home)
        self.cwd = Path(cwd) if cwd is not None else None
        self.model = model
        self.timeout = timeout
        self._conversations: dict[str, Any] = {}
        # Which run each conversation is currently reporting into, keyed by the
        # same conversation key. Not one slot for the whole backend: a backend is
        # shared by every session the process serves, so a single slot meant the
        # second run's emitter displaced the first's and one of the two watched
        # its own run report nothing. A conversation key already names the pair
        # (dialogue, folder) that owns a conversation, so it also names the run
        # in progress on it.
        self._live: dict[str, tuple[Callable[[str, dict], None], _Turn]] = {}
        self._started = False

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        """Check the config can describe a model, before a run needs one.

        Failing here rather than inside a run means a wrong `config.toml`
        reports itself while a caller is still in a position to show the file,
        instead of as an error the model appears to have produced.
        """
        if self._started:
            return
        try:
            resolve(self.home, model=self.model)
        except ConfigError as exc:
            raise BackendError(str(exc)) from exc
        self._started = True

    def interrupt(
        self, conversation: str | None = None, workspace: Any = None
    ) -> bool:
        """Cancel the in-flight run on one conversation.

        The SDK's own `interrupt()` cancels the task driving `arun()` at its next
        await boundary, which is inside the streaming HTTP read -- so this stops
        the model mid-token rather than after the current request. Its documented
        fallback for a synchronous `run()` is `pause()`, which waits for the
        request in flight and then stops, so a run driven synchronously stops one
        request later. Both leave the conversation resumable.

        Returns False when no run is registered for the key, which is what a
        cancel that arrived too late has to report: the ACP reply says
        `cancelled` on the strength of this answer alone.
        """
        key = self._conversation_key(
            conversation, workspace_root(workspace) if workspace is not None else None
        )
        if key not in self._live:
            return False
        held = self._conversations.get(key)
        stop = getattr(held, "interrupt", None)
        if stop is None:
            return False
        try:
            stop()
        except Exception as exc:  # noqa: BLE001 - the SDK's own teardown raises
            raise BackendError("the run did not stop: " + str(exc)) from exc
        return True

    def _conversation_key(self, conversation: str | None, workdir: Path | None = None) -> str:
        """The key naming one dialogue in one folder.

        `run` builds it from the workspace it was handed. `interrupt` is called
        from the serving side, which does not have that workspace, so it resolves
        the same key from the folder this backend was constructed with.
        """
        folder = workdir if workdir is not None else (self.cwd or Path.cwd())
        return _conversation_key(conversation, folder)

    def stop(self) -> None:
        """Close every conversation this backend opened."""
        for key in list(self._conversations):
            conversation = self._conversations.pop(key, None)
            self._close(conversation)
        self._started = False

    def close(self) -> None:
        """The name the runner protocol's callers use for `stop`.

        `server.py` keeps runners in a dict keyed by model and calls `close()`
        on whatever it holds. A backend without that name would have every
        conversation it opened outlive the server that opened them.
        """
        self.stop()

    @staticmethod
    def _close(conversation: Any) -> None:
        """Close one conversation, and say so rather than pretend it closed.

        A conversation that will not close is a leaked workspace lock, not a
        cosmetic problem, so the attempt is made once and the failure is
        reported with the reason the SDK gave.
        """
        if conversation is None:
            return
        close = getattr(conversation, "close", None)
        if close is None:
            return
        try:
            close()
        except Exception as exc:  # noqa: BLE001 - the SDK's own teardown raises
            raise BackendError("the conversation did not close: " + str(exc)) from exc

    # -- running -----------------------------------------------------------

    def run(
        self,
        task: str,
        workspace: Any,
        harness: dict[str, str],
        surface: Any,
        *,
        on_step: Callable[[Any], None] | None = None,
        on_event: Callable[[str, dict], None] | None = None,
        model: str | None = None,
        conversation: str | None = None,
        reasoning: str | None = None,
    ) -> Any:
        """Run one task in a conversation and report as it goes."""
        from .agent import AgentRun, Step

        emit = on_event or (lambda kind, data: None)
        started = time.time()
        chosen = model or self.model
        run = AgentRun(task=task, model=chosen or "openhands")

        workdir = workspace_root(workspace)
        workdir.mkdir(parents=True, exist_ok=True)
        key = _conversation_key(conversation, workdir)

        turn = _Turn()
        step = Step(index=0)
        run.steps.append(step)

        try:
            # Checked before anything is built so the reason a run cannot happen
            # is the missing piece, not a side effect of it: a missing translator
            # would otherwise surface as an SDK ImportError from inside a
            # pydantic model three frames down.
            translator = _translator()
            live = self._conversation(key, workdir, chosen, reasoning, translator, emit, turn)
            # Point the cached conversation's callback at this run's turn and
            # emitter before anything is sent: it was built during an earlier run
            # and still points at whatever was live then.
            self._live[key] = (emit, turn)
            emit("step.started", {"index": 0})
            spent = _usage_totals(live)
            self._send(live, task, harness, surface, workdir)
            # `Conversation.run()` returning *is* the turn ending. Without this
            # the settle step reads "nobody set a stop reason" as "the turn never
            # finished" and reports a completed run as a timeout -- which is what
            # it did until a real run was watched rather than asserted.
            run.stop_reason = run.stop_reason or "finish"
            run.prompt_tokens, run.completion_tokens = _read_usage(live, spent)
        except BackendError as exc:
            run.error = str(exc)
            run.stop_reason = run.stop_reason or "error"
        except Exception as exc:  # noqa: BLE001 - the SDK raises its own types
            run.error = type(exc).__name__ + ": " + str(exc)
            run.stop_reason = run.stop_reason or "error"
        finally:
            self._live.pop(key, None)
            _settle(turn, step, run, on_step)

        run.seconds = time.time() - started
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

    def _dispatch(self, key: str, translator: Any, event: Any) -> None:
        """Report one SDK event into the run that owns this conversation.

        The cached conversation calls this for the rest of its life, so it must
        not hold onto any one run's turn or emitter. `run` registers `key` before
        every send and clears it afterwards; a call that arrives with no run
        registered is one the SDK raised while the conversation was being closed,
        and there is nobody left to tell.
        """
        live = self._live.get(key)
        if live is None:
            return
        emit, turn = live
        _feed(translator, event, emit, turn)

    def _conversation(
        self,
        key: str,
        workdir: Path,
        model: str | None,
        reasoning: str | None,
        translator: Any,
        emit: Callable[[str, dict], None],
        turn: _Turn,
    ) -> Any:
        """The conversation for this key, built on first use.

        Every OpenHands import lives here. A module that imported the SDK at
        import time would make `rsi` unimportable on an interpreter without it,
        which is every interpreter this repository's tests use.

        `emit` and `turn` are only used to build a fresh conversation's callback;
        a cached one reports through `_dispatch` into whatever run is live. They
        stay in the signature because the turn in progress is what the very first
        run needs, and because a test building a conversation directly has no
        other way to name them.
        """
        _ = (emit, turn)
        held = self._conversations.get(key)
        if held is not None:
            self._repoint(held, model, reasoning)
            return held

        from openhands.sdk import Agent, Conversation

        llm = _llm(self.home, model, reasoning)
        agent = Agent(llm=llm, tools=_tools())
        conversation = Conversation(
            agent=agent,
            workspace=str(workdir),
            # Kept, not deleted on close: a session outlives its window, and a
            # run that cannot be resumed has to start the task over. Without a
            # persistence directory the SDK deletes the event log on close, so
            # the second run in one session would begin with no history.
            persistence_dir=workdir / ".oh" / _safe(key),
            delete_on_close=False,
            callbacks=[lambda event: self._dispatch(key, translator, event)],
            # The default visualizer prints a rich transcript into the process
            # that owns the service, which is a console the user never sees.
            visualizer=None,
        )
        self._conversations[key] = conversation
        return conversation

    def _repoint(self, conversation: Any, model: str | None, reasoning: str | None) -> None:
        """Point a cached conversation's agent at this run's model and effort.

        A conversation is built once and reused for every run that shares its
        key, so without this the first run's effort would be the session's
        effort forever: the picker would move and every later run would quietly
        keep the old level. `Agent` and `LLM` are frozen pydantic models, so the
        new one is derived rather than assigned into.
        """
        agent = getattr(conversation, "agent", None)
        held = getattr(agent, "llm", None)
        if held is None:
            return
        wanted = _llm(self.home, model, reasoning)
        if getattr(held, "reasoning_effort", None) == getattr(wanted, "reasoning_effort", None):
            return
        conversation.agent = agent.model_copy(update={"llm": wanted})

    def _send(self, conversation: Any, task: str, harness: dict[str, str], surface: Any, workdir: Path) -> None:
        """Send one task and let it run to a stop.

        The prompt is composed the way the codex engine composes it -- always-on
        documents, then the folder, then the task -- because that composition is
        what a harness experiment varies, and a second backend that ordered it
        differently would make two runs incomparable for a reason nobody chose.
        The folder is named for the engine's stated reason: without it the model
        infers a working directory of its own and writes somewhere the run was
        never meant to touch.
        """
        _ = surface  # the surface names the documents; the tree already carries them
        prefix = harness_prefix(harness)
        parts: list[str] = []
        if prefix:
            parts.append(prefix)
        parts.append("## workspace\n" + str(workdir))
        parts.append("## task\n" + task.strip())
        conversation.send_message("\n\n".join(parts))
        conversation.run()


def _translator() -> Any:
    """The event translator, refused clearly when it is not installed.

    Imported here rather than at module scope so this file stays loadable on an
    interpreter without the SDK, and so the failure names the module that is
    missing instead of looking like an ImportError at startup.
    """
    try:
        from . import oh_events
    except ImportError as exc:
        raise BackendError(
            "rsi.oh_events is not available, so SDK events cannot be translated: " + str(exc)
        ) from exc
    return oh_events


def _feed(translator: Any, event: Any, emit: Callable[[str, dict], None], turn: _Turn) -> None:
    """Hand one SDK event to the translator, record it, and emit whatever came back.

    Recording happens here rather than in the translator because the translator
    answers "what does this event mean to a listener" and the step answers "what
    did this turn do". Only some kinds belong in the second: a delta is a
    fragment of one message and lands in `assistant`, while a tool call is a
    whole thing and lands in `calls`.

    A translator that raises must not take the conversation down with it: this
    runs inside the SDK's own event dispatch, and an exception there loses the
    run rather than one event. So the failure becomes a reported event and the
    stream continues.
    """
    try:
        pair = translator.translate(event)
    except Exception as exc:  # noqa: BLE001 - one bad event is not one bad run
        emit("model.retry", {"reason": "event translation failed: " + str(exc)})
        return
    if pair is None:
        return
    kind, data = pair
    if kind not in EVENT_KINDS:
        emit("model.retry", {"reason": "translator produced an unknown event: " + str(kind)})
        return
    if kind == "tool.called":
        _thinking(translator, event, emit, turn)
    _record(turn, kind, data)
    emit(kind, data)


def _thinking(
    translator: Any,
    event: Any,
    emit: Callable[[str, dict], None],
    turn: _Turn,
) -> None:
    """Emit the reasoning an action carries, before the call it belongs to.

    The SDK stamps reasoning on the first action of a response and on no other
    (`agent/response_dispatch.py:181-186`, `thought=thought_content if i == 0
    else []`), so it arrives attached to a tool call rather than as a message of
    its own. A listener draws it as a line of its own, so it has to go out before
    the call it precedes -- sending it after would put the model's reasoning
    below the work it was reasoning about.

    A translator without `thinking_of` contributes nothing: that is the shape a
    test stand-in has, and an engine that reports no reasoning at all is a
    supported state rather than a fault.
    """
    answer = getattr(translator, "thinking_of", None)
    if answer is None:
        return
    try:
        thought = str(answer(event) or "").strip()
    except Exception as exc:  # noqa: BLE001 - one bad event is not one bad run
        emit("model.retry", {"reason": "reasoning could not be read: " + str(exc)})
        return
    if not thought:
        return
    data = {"index": 0, "thinking": thought, "assistant": ""}
    _record(turn, "step.message", data)
    emit("step.message", data)


def _record(turn: _Turn, kind: str, data: dict) -> None:
    """Remember the parts of an emitted event that belong to this turn's step."""
    if kind == "step.message":
        thinking = str(data.get("thinking") or "")
        assistant = str(data.get("assistant") or "")
        if thinking:
            turn.thinking.append(thinking)
        if assistant:
            turn.assistant.append(assistant)
    elif kind == "tool.called":
        turn.calls.append(
            {
                "name": str(data.get("name") or ""),
                "arguments": data.get("arguments") or {},
            }
        )
    elif kind == "tool.result":
        turn.results.append(
            {
                "output": str(data.get("output") or "")[:2000],
                "error": not data.get("ok", True),
            }
        )
        # `finish` is how an OpenHands agent stops, and the text it passes to
        # that tool is its answer to the task. It never sends a separate
        # assistant message, so this observation is the only place the answer
        # exists; without it every run finishes with an empty final.
        if str(data.get("name") or "") == "finish" and data.get("ok", True):
            said = str(data.get("output") or "").strip()
            if said:
                turn.answer.append(said)


def _safe(key: str) -> str:
    """A conversation key that can be a directory name on any platform.

    Short on purpose. The SDK files its event log under this directory and then
    appends a conversation id and a temporary suffix of its own, and the whole
    thing sits inside the workspace, which can be anywhere the user pointed it
    at. Spending 80 characters on a flattened copy of the workspace path made
    that name overflow Windows' 260-character limit for a real session -- the
    run died with FileNotFoundError before the model was called, so it looked
    like the model was refusing to work. A readable head plus a digest of the
    whole key stays unique without spending the budget on the folder name.
    """
    keep = [c if (c.isalnum() or c in "-_.") else "-" for c in key]
    head = "".join(keep)[:32].strip("-.") or "conversation"
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:8]
    return head + "-" + digest


def _tools() -> list[Any]:
    """The tool set a run may use.

    The browser tools are off: they pull a Playwright install the size of the
    app and nothing in RSI drives a browser yet. Terminal, file editing and the
    task tracker are the three that carry real work.
    """
    from openhands.tools import get_default_tools

    return get_default_tools(enable_browser=False)


def _llm(home: Path | str, model: str | None, reasoning: str | None) -> Any:
    """The `LLM` this engine home describes, at the effort the caller asked for.

    `resolve` returns constructor fields; the effort is not one of them because
    it belongs to the run rather than to the endpoint, so it is added here over
    the same fields rather than by widening that function's job.
    """
    from openhands.sdk.llm.llm import LLM

    fields = resolve(home, model=model)
    effort = resolve_effort(home, reasoning, str(fields.get("model") or ""))
    if effort:
        fields["reasoning_effort"] = effort
    return LLM(**fields)


def _usage_totals(conversation: Any) -> tuple[int, int]:
    """How much this conversation had spent before the current turn.

    The SDK keeps cumulative counters per LLM, so the only way to report what
    one turn cost is to take two readings and subtract. Read zero when the SDK
    offers nothing rather than raising: a missing usage counter must not turn a
    finished run into a failed one.
    """
    stats = getattr(conversation, "conversation_stats", None)
    combined = getattr(stats, "get_combined_metrics", None)
    if combined is None:
        return 0, 0
    try:
        metrics = combined()
    except Exception:  # noqa: BLE001 - an SDK change must not fail the run
        return 0, 0
    usage = getattr(metrics, "accumulated_token_usage", None)
    return (
        int(getattr(usage, "prompt_tokens", 0) or 0),
        int(getattr(usage, "completion_tokens", 0) or 0),
    )


def _read_usage(conversation: Any, before: tuple[int, int]) -> tuple[int, int]:
    """What the turn that just ended spent, as two non-negative counts."""
    if not hasattr(conversation, "conversation_stats"):
        return 0, 0
    now = _usage_totals(conversation)
    return max(0, now[0] - before[0]), max(0, now[1] - before[1])


def resolve_effort(home: Path | str, wanted: str | None, model_id: str) -> str:
    """The effort to ask for, or empty when the model advertises none.

    OpenHands validates `reasoning_effort` against the provider's enum, and a
    level a model does not advertise would either be refused or silently mean
    something else. The catalogue is the only source that knows, so an unknown
    level falls back to the model's default rather than being passed through.

    Without this the effort is whatever the caller typed, so a level the model
    never advertised reaches the provider and is accepted as something nobody
    chose -- the catalogue is the last place that can tell the difference.
    """
    from .models import catalog

    levels: tuple[str, ...] = ()
    default = ""
    # The id this arrives with carries the wire prefix `normalize_model` adds
    # (`openai/workbuddy/...`), while the catalogue files it without one. Match
    # on either spelling: comparing only the bare id never matched, so every
    # level looked unknown and the check below silently passed everything
    # through -- a level the model does not advertise reached the provider.
    bare = model_id[len("openai/") :] if model_id.startswith("openai/") else model_id
    for entry in catalog(home).models:
        if entry.id in (model_id, bare):
            levels, default = entry.reasoning_levels, entry.default_reasoning_level
            break
    want = (wanted or "").strip()
    if not want:
        return default if default and (not levels or default in levels) else ""
    if levels and want not in levels:
        return default if default in levels else ""
    return want


def _conversation_key(conversation: str | None, workdir: Path) -> str:
    """What a conversation is filed under. Same key as the codex engine's.

    The name is the session id, and the folder is part of it, so the two
    backends agree about when a dialogue restarts -- a migration that changed
    the key would silently start every conversation over.
    """
    name = str(conversation or "").strip()
    if name:
        return "conversation:" + name + "\x00" + str(workdir)
    return "workspace:" + str(workdir)


def _settle(turn: _Turn, step: Any, run: Any, on_step: Callable[[Any], None] | None) -> None:
    """Copy the turn into the step, fill the run, and hand the step to on_step.

    The codex loop does this in the same order at the same point: the step is
    settled after the turn, then the caller sees it, then the run is reported
    finished. A caller that reads both cannot observe a finished run whose step
    is still empty.

    It does not decide why the run stopped. That is the one thing only `run()`
    knows -- a stopped conversation ends normally, an exception ends it by
    failing, and reading "no reason recorded" as either one here got it wrong.
    """
    step.thinking = "".join(turn.thinking).strip()
    step.assistant = "".join(turn.assistant).strip() or "".join(turn.answer).strip()
    step.calls = list(turn.calls)
    step.results = list(turn.results)
    run.final = step.assistant
    if on_step:
        on_step(step)


class CodexBackend(Backend):
    """The existing engine behind the same interface.

    It adds nothing to `engine.AgentRunner`; it is here so a caller can hold one
    name and get either executor, and so a test can run both against one task.
    """

    kind = "engine"

    def __init__(
        self,
        *,
        model: str | None = None,
        home: Path | str | None = None,
        cwd: Path | str | None = None,
        timeout: float = 900.0,
    ) -> None:
        from .engine import AgentRunner

        self._runner = AgentRunner(model=model, home=home, cwd=cwd, timeout=timeout)

    def start(self) -> None:
        """Nothing to warm: the engine process starts with the first run."""

    def stop(self) -> None:
        """Nothing held here: the runner owns its process."""
        close = getattr(self._runner, "close", None)
        if close is not None:
            close()

    def close(self) -> None:
        """The name the runner protocol's callers use for `stop`."""
        self.stop()

    def run(
        self,
        task: str,
        workspace: Any,
        harness: dict[str, str],
        surface: Any,
        *,
        on_step: Callable[[Any], None] | None = None,
        on_event: Callable[[str, dict], None] | None = None,
        model: str | None = None,
        conversation: str | None = None,
        reasoning: str | None = None,
    ) -> Any:
        """Run one task on the codex engine, passing every keyword through."""
        return self._runner.run(
            task,
            workspace,
            harness,
            surface,
            on_step=on_step,
            on_event=on_event,
            model=model,
            conversation=conversation,
            reasoning=reasoning,
        )


def make_backend(kind: str, **options: Any) -> Backend:
    """The executor `kind` names, or a refusal listing the ones that exist.

    A missing OpenHands install is reported as a `BackendError` naming the
    module, because the alternative -- an ImportError from three frames down in
    a pydantic model -- reads like a bug in this file.
    """
    if kind == "engine":
        return CodexBackend(**options)
    if kind == "openhands":
        try:
            import openhands.sdk  # noqa: F401 - presence is the whole question
        except ImportError as exc:
            raise BackendError(
                "the openhands SDK is not installed in this interpreter: " + str(exc)
            ) from exc
        return OpenHandsBackend(**options)
    raise BackendError(
        "unknown executor " + repr(kind) + "; the ones available are engine and openhands"
    )


def surface_documents(surface: Any) -> tuple[str, ...]:
    """The documents a surface declares always-on, in its own order.

    Kept next to `harness_prefix` so a caller building a `harness` dict and a
    caller reading one agree about which files matter. A surface that names
    none contributes nothing rather than the engine's default list.
    """
    names = getattr(surface, "always_on", ())
    return tuple(str(name) for name in names)
