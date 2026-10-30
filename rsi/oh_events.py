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

"""What one OpenHands SDK event means to a listener, in the engine's vocabulary.

`backend.OpenHandsBackend` hands every SDK event it receives to
`translate(event)`, and emits whatever pair comes back. The kinds it may name
are `backend.EVENT_KINDS`; anything else is refused there, so this module must
not invent one.

Two facts about the SDK shape everything below, and both were read off the
installed SDK rather than assumed:

1. A `LocalConversation` -- the one `backend._conversation` builds for a local
   workspace -- emits **no** `StreamingDeltaEvent`. That class exists only in
   `remote_conversation.py`, whose own docstring says it is published straight
   to PubSub and bypasses the callback chain. Text therefore arrives whole, in a
   `MessageEvent`, and the live token-by-token view a user expects has to come
   from the conversation's `token_callbacks` instead. That wiring belongs to
   `backend.py`; this module never sees a chunk.

2. `MessageEvent` is not "a message the user typed". The SDK emits one with
   `source="user"` for its own corrective nudges and for the task the caller
   sent, so `source` alone does not say whose words these are. Only
   `source="agent"` is assistant output, and only that becomes `step.message`.

Nothing here imports OpenHands at module scope, for the reason
`backend.py`'s docstring gives: `rsi` has to import on an interpreter without
the SDK, which is the interpreter the test suite runs on.
"""

from __future__ import annotations

from typing import Any

__all__ = ["thinking_of", "translate"]


#: The SDK's own names for the tools whose calls read better with their
#: argument in the line, rather than as a JSON dump.
_TERMINAL = "terminal"
_FILE_EDITOR = "file_editor"
_TASK_TRACKER = "task_tracker"

_MAX_BRIEF = 100

#: Task-list statuses, in the SDK's spelling, mapped to the one the plan panel
#: counts. `desktop._on_plan` counts `"completed"`, which is the codex engine's
#: word for a finished plan step; the SDK says `"done"`.
_PLAN_STATUS = {"todo": "pending", "in_progress": "in_progress", "done": "completed"}


def translate(event: Any) -> tuple[str, dict] | None:
    """The `(kind, data)` pair one SDK event becomes, or None if it means nothing here.

    The argument is an SDK event object; it is typed `Any` because naming the
    base class would mean importing the SDK in this module's signature.

    Returns:
        A pair naming one of `backend.EVENT_KINDS`, or `None` for an event this
        listener has no use for -- a state update, a token frame, a security
        analysis note. `None` is the ordinary answer, not a failure.
    """
    name = type(event).__name__
    if name == "MessageEvent":
        return _message(event)
    if name == "ActionEvent":
        return _action(event)
    if name == "ObservationEvent":
        return _observation(event)
    if name == "AgentErrorEvent":
        return _agent_error(event)
    if name == "UserRejectObservation":
        return _rejected(event)
    return None


def thinking_of(event: Any) -> str:
    """The reasoning one action event carries, or the empty string.

    Only the first action of an LLM response gets the reasoning block -- the SDK
    stamps `thought` and `reasoning_content` on `i == 0` and leaves the rest
    empty (`agent/response_dispatch.py:181-186`) -- so most calls answer "" and
    the caller emits a thinking line only when it does not.

    A separate function rather than a key in `translate`'s payload because
    thinking has to be emitted before the call it belongs to, and `translate`
    returns one pair per event.
    """
    idea = getattr(event, "reasoning_content", None)
    if idea:
        return str(idea).strip()
    return "".join(_texts(getattr(event, "thought", ()))).strip()


def _message(event: Any) -> tuple[str, dict] | None:
    """An assistant message, as the text a reader is waiting for.

    A `source="user"` MessageEvent is skipped: the SDK uses that source for the
    task it was handed and for the corrective nudges it sends itself, and the
    window already shows the task the user typed. Repeating either as assistant
    output would put words in the model's mouth.
    """
    if str(getattr(event, "source", "")) != "agent":
        return None
    message = getattr(event, "llm_message", None)
    if message is None:
        return None
    text = "".join(_texts(getattr(message, "content", ()))).strip()
    thinking = str(getattr(message, "reasoning_content", "") or "").strip()
    if not text and not thinking:
        return None
    return ("step.message", {"index": 0, "thinking": thinking, "assistant": text})


def _action(event: Any) -> tuple[str, dict] | None:
    """A tool call, named the way the codex engine names one.

    The engine reports a call as `{"name": <one readable line>, "arguments":
    {"brief": <what it is doing>}}`, and `desktop._brief` reads exactly that
    `brief` key. Keeping the shape means a card built for the codex engine
    renders the same here.

    The reasoning block on the event is deliberately not read here. The SDK puts
    it on the first action of a response (`i == 0`) so a caller drawing thinking
    as its own line has to emit it *before* the call, and this module answers one
    `(kind, data)` pair per event. `thinking_of` is the hook the caller uses for
    that; folding it into this payload instead would leave it unread, since no
    listener of `tool.called` looks at a `thinking` key.
    """
    tool = str(getattr(event, "tool_name", "") or "")
    action = getattr(event, "action", None)
    if not tool:
        # An action with no tool name is a malformed call; the SDK reports it as
        # an AgentErrorEvent instead, so nothing legitimately lands here.
        return None
    pair = (
        "tool.called",
        {
            "index": 0,
            "name": tool,
            "call_id": _call_id(event),
            "arguments": {"brief": _brief(tool, action)},
        },
    )
    return pair


def _observation(event: Any) -> tuple[str, dict] | None:
    """A tool's outcome, as succeeded-or-not plus the text a reader can scan.

    A terminated tool list is reported as the plan instead of as a result: it
    *is* the plan, and both readings of one event would show the same line
    twice.
    """
    tool = str(getattr(event, "tool_name", "") or "")
    observation = getattr(event, "observation", None)
    steps = _plan_steps(observation)
    if steps is not None:
        # The call id rides along even though this is reported as a plan: the
        # report that produced it is still a tool call the client opened a card
        # for, and without its id that card stays "in progress" forever.
        return ("plan.updated", {"steps": steps, "call_id": _call_id(event),
                                 "name": tool})

    text = _as_text(getattr(observation, "content", None))
    ok = not bool(getattr(observation, "is_error", False))
    exit_code = getattr(observation, "exit_code", None)
    if exit_code not in (None, 0):
        ok = False
    return (
        "tool.result",
        {"index": 0, "name": tool, "call_id": _call_id(event), "ok": ok, "output": text[:2000], "ms": 0},
    )


def _as_text(value: Any) -> str:
    """The plain text of an observation's `content`, whichever form it took.

    An observation's `content` is a `list[TextContent]`, not a string -- running
    `str()` over it yields `"[TextContent(cache_prompt=False, type='text',
    text='all good')]"`, which is what a report field shows when nobody checked.
    Some tools do hand back a bare string, so both are accepted rather than one
    assumed.
    """
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return "".join(_texts(value))
    return str(value)


def _agent_error(event: Any) -> tuple[str, dict] | None:
    """A call the SDK refused before running, reported as a failed result.

    The codex engine reports these the same way -- a call that did not work --
    rather than as a retryable model error, because nothing will retry it: the
    tool was never invoked.
    """
    tool = str(getattr(event, "tool_name", "") or "")
    error = str(getattr(event, "error", "") or "")
    return (
        "tool.result",
        {"index": 0, "name": tool, "call_id": _call_id(event), "ok": False, "output": error[:2000], "ms": 0},
    )


def _rejected(event: Any) -> tuple[str, dict] | None:
    """A call the user declined, reported as a failed result.

    `itemtext.outcome` counts `declined` as not-succeeded for the same reason:
    the work did not happen, and a reader who sees only the call would think it
    did.
    """
    tool = str(getattr(event, "tool_name", "") or "")
    reason = str(getattr(event, "rejection_reason", "") or "rejected")
    return (
        "tool.result",
        {"index": 0, "name": tool, "call_id": _call_id(event), "ok": False, "output": reason[:2000], "ms": 0},
    )


def _call_id(event: Any) -> str:
    """The SDK's own id for this tool call, or "" when it carries none.

    A call and its observation have to be paired by something that stays unique
    across a whole conversation: the tool name does not (two `terminal` calls in
    one reply is the normal case) and the step index does not (this backend does
    not report one). The SDK puts `tool_call_id` on both halves of the pair, so
    it is carried through rather than reconstructed.

    Empty when the event has no id -- an `AgentErrorEvent` carries the id of the
    call it refused, but a fixture or a future SDK event may not. The caller
    decides what to do with an empty id; inventing one here would collide.
    """
    return str(getattr(event, "tool_call_id", "") or "")


def _plan_steps(observation: Any) -> list[dict] | None:
    """The task list an observation carries, or None when it carries none.

    Read from the observation rather than from the action so a `view` and a
    `plan` both refresh the panel: the SDK returns the list on both, and the
    panel is showing state either way.
    """
    items = getattr(observation, "task_list", None)
    if not items:
        return None
    steps: list[dict] = []
    for item in items:
        status = str(getattr(item, "status", "") or "")
        title = str(getattr(item, "title", "") or "")
        steps.append({"status": _PLAN_STATUS.get(status, "pending"), "title": title})
    return steps


def _brief(tool: str, action: Any) -> str:
    """One readable line for a call, in the words the codex engine uses.

    The command is preferred over the name because "npm test" tells a reader
    what is happening and "terminal" does not. A tool with nothing worth
    quoting contributes its name rather than an empty line.
    """
    if tool == _TERMINAL:
        return _clip(str(getattr(action, "command", "") or ""))
    if tool == _FILE_EDITOR:
        command = str(getattr(action, "command", "") or "")
        path = str(getattr(action, "path", "") or "")
        return _clip((command + " " + path).strip())
    if tool == _TASK_TRACKER:
        command = str(getattr(action, "command", "") or "")
        return _clip((tool + " " + command).strip())
    return _clip(tool)


def _texts(contents: Any) -> list[str]:
    """The plain text of a content list, skipping images and anything else.

    `content_to_str` does the same job in the SDK, but calling it would need the
    SDK imported here; the walk is three lines and this module stays free of the
    dependency.
    """
    out: list[str] = []
    for item in contents or ():
        text = getattr(item, "text", None)
        if isinstance(text, str) and text:
            out.append(text)
    return out


def _clip(text: str) -> str:
    """One line, short enough for a card."""
    line = " ".join(text.split())
    if len(line) <= _MAX_BRIEF:
        return line
    return line[: _MAX_BRIEF - 1] + "\u2026"
