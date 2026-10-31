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

"""What a tool call was, said in one line.

The engine reports each call as an item with a type and a payload, and the
window has to turn that into something a reader can scan. Pure functions on
purpose: the mapping is easy to get blunt -- a raw JSON dump is unreadable and a
bare tool name hides whether the agent read or wrote -- and keeping it out of
the event loop makes it testable against captured payloads instead of guesses.

Every branch here is written against a payload observed from the engine, not
against the schema alone. Where the payload offers no summary the brief is
empty, which is better than inventing one.
"""

from __future__ import annotations

import json
from typing import Any

__all__ = ["brief", "label", "outcome"]

# Item types that are not tool work: they are the conversation itself.
CONVERSATION = ("userMessage", "agentMessage", "reasoning", "hookPrompt", "plan")

LABELS = {
    "commandExecution": "命令",
    "fileChange": "改文件",
    "mcpToolCall": "MCP",
    "webSearch": "联网搜索",
    "dynamicToolCall": "工具",
    "collabAgentToolCall": "子代理",
    "subAgentActivity": "子代理",
    "imageView": "看图",
    "imageGeneration": "生成图片",
    "sleep": "等待",
    "enteredReviewMode": "进入评审",
    "exitedReviewMode": "退出评审",
    "contextCompaction": "压缩上下文",
}

_MAX = 100


def label(item_type: str) -> str:
    """The Chinese name for one item type, or the raw type if unknown."""
    text = str(item_type or "")
    return LABELS.get(text, text or "?")


def brief(item: dict[str, Any] | None) -> str:
    """One readable line describing what the call is doing."""
    if not isinstance(item, dict):
        return ""
    kind = item.get("type")

    if kind == "commandExecution":
        return _clip(_command_text(item))

    if kind == "fileChange":
        return _paths(item.get("changes"))

    if kind == "mcpToolCall":
        server = str(item.get("server") or "")
        tool = str(item.get("tool") or "")
        name = "/".join([p for p in (server, tool) if p])
        return _clip(name or _json(item.get("arguments")))

    if kind == "webSearch":
        return _clip(str(item.get("query") or ""))

    if kind in ("dynamicToolCall", "collabAgentToolCall"):
        name = str(item.get("tool") or item.get("name") or "")
        return _clip(name or _json(item.get("arguments")))

    if kind in ("readFile", "imageView"):
        return _clip(str(item.get("path") or ""))

    if kind == "imageGeneration":
        return _clip(str(item.get("prompt") or ""))

    return _clip(_json(item.get("arguments")))


def outcome(item: dict[str, Any] | None) -> tuple[bool, int]:
    """Whether the call succeeded, and how long it took in milliseconds.

    A failed call is the thing a reader must notice, so this returns False for
    every status the payload uses to mean "did not work" -- including
    declined, which is a refusal rather than a fault.
    """
    if not isinstance(item, dict):
        return True, 0
    status = str(item.get("status") or "")
    ok = status not in ("failed", "declined")
    if item.get("exitCode") not in (None, 0):
        ok = False
    if item.get("error"):
        ok = False
    if item.get("success") is False:
        ok = False
    try:
        ms = int(item.get("durationMs") or 0)
    except (TypeError, ValueError):
        ms = 0
    return ok, ms


def _command_text(item: dict[str, Any]) -> str:
    """The command as a person would type it.

    The engine wraps every shell command in the shell it chose, so the raw
    field reads as a powershell invocation with the real command buried inside
    it. The payload also carries the engine's own parse of what the command
    does, which is what a reader wants.
    """
    actions = item.get("commandActions")
    if isinstance(actions, list) and actions:
        said = _from_actions(actions)
        if said:
            return said
    return _unwrap_shell(str(item.get("command") or ""))


def _from_actions(actions: list[Any]) -> str:
    parts: list[str] = []
    for action in actions:
        if not isinstance(action, dict):
            continue
        kind = str(action.get("type") or "")
        path = str(action.get("path") or "")
        if kind == "read":
            parts.append("读 " + path)
        elif kind == "listFiles":
            parts.append("列出 " + (path or "."))
        elif kind == "search":
            query = str(action.get("query") or "")
            parts.append("搜索 " + _clip(query, 40) + (" @ " + path if path else ""))
        else:
            shell = str(action.get("command") or "")
            if shell:
                parts.append(_unwrap_shell(shell))
    if not parts:
        return ""
    return " · ".join(parts)


def _unwrap_shell(command: str) -> str:
    """Strip the engine's shell wrapper so the command itself is visible."""
    text = command.strip()
    if not text:
        return ""
    lowered = text.lower()
    for flag in (" -command ", " -c ", " /c "):
        at = lowered.rfind(flag)
        if at == -1:
            continue
        head = lowered[:at]
        if not any(s in head for s in ("powershell", "pwsh", "cmd.exe", "bash", "sh", "cmd")):
            continue
        body = text[at + len(flag):].strip()
        if len(body) >= 2 and body[0] in ("'", '"') and body[-1] == body[0]:
            body = body[1:-1]
        return body.strip()
    return text


def _paths(changes: Any) -> str:
    if not isinstance(changes, list):
        return ""
    names: list[str] = []
    for change in changes:
        if isinstance(change, dict):
            path = change.get("path")
            if path:
                names.append(str(path))
    return _clip(" · ".join(names))


def _json(value: Any) -> str:
    if value in (None, "", {}, []):
        return ""
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(value)


def _clip(text: str, limit: int = _MAX) -> str:
    flat = " ".join(str(text or "").split())
    if len(flat) <= limit:
        return flat
    return flat[: limit - 1] + "…"
