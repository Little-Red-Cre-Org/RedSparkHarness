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

"""Reading a stored transcript back into the tool calls it recorded.

A run is shown twice: live, from the event stream, and later, from the file it
left behind. The second one had been lossy - reopening a session printed the
task and the answer and nothing in between - so the tool work that the
right-hand column exists to show was gone from every completed run.

The transcript is the only record of it, which makes this file a parser. The
grammar is small: an [ACTION] line naming a call and its arguments, paired with
the [OBSERVATION] or [OBSERVATION ERROR] line that follows it. The payloads
inside it are not small, so the cases below are written against transcripts
captured from real runs rather than from the writer's shape.

Two limits belong to the format rather than to this parser. A transcript has no
escaping, so a tool whose output happens to contain a line starting with a tag
is read as a new record. And the writer truncates a long observation, which
leaves the call intact but costs it the duration that was past the cut.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from . import itemtext

__all__ = ["Call", "brief_of", "calls"]

# Long enough for a command line or a path, short enough for one row. The live
# stream clips at the same width, so a call reads the same either way.
_MAX = 120

# Transcript labels, in the order they are matched: the longer name has to be
# tested first or every failure would read as a success.
_KINDS = {
    "OBSERVATION ERROR": "failed",
    "OBSERVATION": "observation",
    "ACTION": "action",
    "THINKING": "thinking",
    "ASSISTANT": "assistant",
    "FINAL": "final",
}


@dataclass(frozen=True)
class Call:
    """One tool call as the transcript recorded it.

    ok is None when the run ended between the call and its result - an
    interrupted turn really does leave it unknown, and guessing either way would
    print a verdict the writer never reached.
    """

    name: str
    brief: str = ""
    ok: bool | None = None
    ms: int = 0


def calls(text: str) -> list[Call]:
    """Every tool call in one transcript, in the order it was made."""
    records = _records(text)
    found: list[Call] = []
    for index, (kind, body) in enumerate(records):
        if kind != "action":
            continue
        name, arguments = _action(body)
        # The result of a call is the record that follows it, and only that one:
        # matching results up by name would pair two calls to the same tool with
        # each other's outcomes.
        following = records[index + 1] if index + 1 < len(records) else None
        ok: bool | None = None
        ms = 0
        item: dict | None = None
        if following is not None and following[0] in ("observation", "failed"):
            ok, ms, item = _outcome(*following)
        # An older writer recorded the item's type rather than its name; the
        # name is a lookup away, and an already-named call passes through.
        found.append(
            Call(
                name=itemtext.label(name),
                brief=_brief(name, arguments, item),
                ok=ok,
                ms=ms,
            )
        )
    return found


def _brief(name: str, arguments: Any, item: dict | None) -> str:
    """The one line a row shows for a call.

    The engine used to write the brief into the arguments, and the newest
    transcripts still have it there. Older ones were written before that: they
    recorded an empty argument object next to the raw result. For those the
    result is what is left to read the call out of, and it says the same thing -
    which command ran, which file changed - because it is the same payload the
    live stream summarised from.
    """
    said = brief_of(arguments)
    if said or item is None:
        return said
    return itemtext.brief(item)


def brief_of(arguments: Any) -> str:
    """One readable line for a call's arguments.

    The engine passes {"brief": ...} through to the transcript, having already
    done the summarising; anything else is left to be shown as it was written,
    clipped to the width of a row.
    """
    if isinstance(arguments, str):
        return _clip(arguments)
    if isinstance(arguments, dict):
        said = arguments.get("brief")
        if isinstance(said, str):
            return _clip(said)
    if arguments in (None, "", {}, []):
        return ""
    try:
        return _clip(json.dumps(arguments, ensure_ascii=False))
    except (TypeError, ValueError):
        return _clip(str(arguments))


def _records(text: str) -> list[tuple[str, str]]:
    """The transcript as (kind, body) pairs, in order.

    A body may span lines: an observation carries whatever the tool printed, and
    the writer does not escape it. So a line without a tag of its own continues
    the record above it rather than being dropped.
    """
    found: list[tuple[str, str]] = []
    for line in str(text or "").splitlines():
        kind, body = _tag_of(line)
        if kind is None:
            if found:
                last_kind, last_body = found[-1]
                found[-1] = (last_kind, last_body + "\n" + line)
            continue
        found.append((kind, body))
    return found


def _tag_of(line: str) -> tuple[str | None, str]:
    if not line.startswith("["):
        return None, ""
    end = line.find("]")
    if end == -1:
        return None, ""
    kind = _KINDS.get(line[1:end])
    if kind is None:
        return None, ""
    body = line[end + 1 :]
    if body.startswith(" "):
        body = body[1:]
    return kind, body


def _action(body: str) -> tuple[str, str]:
    """Split "name(arguments)" into the two parts a row can show."""
    at = body.find("(")
    if at <= 0:
        return body.strip(), ""
    name = body[:at].strip()
    inner = body[at + 1 :]
    if inner.endswith(")"):
        inner = inner[:-1]
    try:
        arguments = json.loads(inner)
    except (TypeError, ValueError):
        return name, _clip(inner)
    return name, brief_of(arguments)


def _outcome(kind: str, body: str) -> tuple[bool, int, dict | None]:
    """Whether the call worked, how long it took, and the payload it came in.

    The tag is followed verbatim: the writer chose it from the result it had, so
    re-deriving the verdict from the payload would only add ways to disagree
    with it. The duration and the payload come only from an observation that is
    recognisably a raw item - an observation is otherwise just whatever the tool
    printed, and a coincidence there should not become a number on screen.
    """
    ok = kind != "failed"
    try:
        item = json.loads(body)
    except (TypeError, ValueError):
        return ok, 0, None
    if not isinstance(item, dict) or not item.get("type"):
        return ok, 0, None
    try:
        ms = int(item.get("durationMs") or 0)
    except (TypeError, ValueError):
        ms = 0
    return ok, ms, item


def _clip(text: str, limit: int = _MAX) -> str:
    flat = " ".join(str(text or "").split())
    if len(flat) <= limit:
        return flat
    return flat[: limit - 1] + "\u2026"
