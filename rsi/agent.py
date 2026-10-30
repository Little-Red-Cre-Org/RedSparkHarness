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

"""A minimal agent loop, driving any OpenAI-compatible chat endpoint.

This is the missing producer. Until now the system could store, gate and swap a
harness, but nothing wrote one: the demo proposer was scripted and the smoke tasks
ran a Python script. Here is an actual model, given tools, working a task.

It is deliberately small and deliberately not clever:

* The harness is loaded from the tree, not from a fixed prompt. Whatever the current
  generation says in systemprompt.md, guardrails.md, LongTermMEMORY.md and
  tool_descriptions/tool_guidance.md becomes the system message, so editing the
  harness changes what the agent does on the very next run.
* Tools are real. write_file, read_file, list_files and run_python act on a workspace
  directory on disk. The agent's work is inspected afterwards, not trusted.
* One turn, bounded. A step budget stops a model that loops. Every tool call and
  result is recorded, so a transcript can be replayed and scored.

What it is not: no streaming, no subagents, no skill loading, no MCP. A harness may
describe those, and this loop will not honour them -- which is itself worth knowing
before claiming a harness "improved".
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from harness2.core.tree import SurfaceSpec, Tree

DEFAULT_BASE_URL = "http://127.0.0.1:3425/v1"
DEFAULT_MODEL = "grok/grok-4.7@500k"


def harness_system_prompt(surface: SurfaceSpec, tree: Tree) -> str:
    """The always-on text of a harness, in the order the surface declares.

    This is where the harness being data becomes behaviour: change the tree, change
    the prompt, change what the agent does.
    """
    parts: list[str] = []
    for rel in surface.always_on:
        body = (tree.get(rel) or "").strip()
        if body:
            parts.append(body)
    return "\n\n---\n\n".join(parts)


@dataclass
class Step:
    """One model turn and whatever tools it asked for."""

    index: int
    assistant: str = ""
    thinking: str = ""
    calls: list[dict] = field(default_factory=list)
    results: list[dict] = field(default_factory=list)
    tokens: int = 0

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "assistant": self.assistant,
            "thinking": self.thinking,
            "calls": self.calls,
            "results": self.results,
            "tokens": self.tokens,
        }


@dataclass
class AgentRun:
    """Everything one run produced, in the order it happened."""

    task: str
    model: str
    steps: list[Step] = field(default_factory=list)
    final: str = ""
    error: str = ""
    seconds: float = 0.0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    stop_reason: str = ""

    @property
    def ok(self) -> bool:
        return not self.error and bool(self.steps)

    def transcript(self) -> str:
        """The shared [ACTION]/[OBSERVATION] grammar the Harness2 adapters use."""
        lines: list[str] = []
        for s in self.steps:
            if s.thinking:
                lines.append("[THINKING] " + s.thinking)
            if s.assistant:
                lines.append("[ASSISTANT] " + s.assistant)
            for call, result in zip(s.calls, s.results):
                name = call.get("name", "?")
                args = json.dumps(call.get("arguments", {}), ensure_ascii=False)
                lines.append("[ACTION] " + name + "(" + args + ")")
                out = str(result.get("output", ""))
                tag = "OBSERVATION ERROR" if result.get("error") else "OBSERVATION"
                lines.append("[" + tag + "] " + out)
        if self.final:
            lines.append("[FINAL] " + self.final)
        return "\n".join(lines)

    def to_dict(self) -> dict:
        return {
            "task": self.task,
            "model": self.model,
            "ok": self.ok,
            "error": self.error,
            "seconds": round(self.seconds, 2),
            "steps": len(self.steps),
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "stop_reason": self.stop_reason,
            "final": self.final,
        }


class ToolError(RuntimeError):
    """A tool refused to run; the message goes back to the model, not the caller."""


class Workspace:
    """The directory an agent works in. Every path is confined to it.

    A model that asks for ../../etc/passwd gets an error, not a file. This is path
    sanitation, not a sandbox: run_python still runs arbitrary Python with the
    privileges of the process. That limit is stated here rather than papered over.
    """

    def __init__(self, root: Path | str) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, rel: str) -> Path:
        p = (self.root / str(rel)).resolve()
        if p != self.root and self.root not in p.parents:
            raise ToolError("path escapes the workspace: " + repr(rel))
        return p

    def write_file(self, path: str, content: str = "") -> str:
        p = self._resolve(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(str(content), encoding="utf-8", newline="\n")
        return "wrote " + str(len(content)) + " chars to " + path

    def read_file(self, path: str) -> str:
        p = self._resolve(path)
        if not p.is_file():
            raise ToolError("no such file: " + path)
        return p.read_text(encoding="utf-8", errors="replace")

    def list_files(self) -> str:
        items = sorted(
            p.relative_to(self.root).as_posix()
            for p in self.root.rglob("*")
            if p.is_file() and "__pycache__" not in p.parts
        )
        return "\n".join(items) if items else "(workspace is empty)"

    def run_python(self, code: str = "", path: str = "", timeout: float = 60.0) -> str:
        """Run a file from the workspace, or a snippet, and return its output."""
        if path:
            target = self._resolve(path)
            if not target.is_file():
                raise ToolError("no such file: " + path)
            cmd = [sys.executable, str(target)]
        elif code.strip():
            cmd = [sys.executable, "-c", code]
        else:
            raise ToolError("give either path or code")
        try:
            proc = subprocess.run(
                cmd, cwd=str(self.root), capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            raise ToolError("timed out after " + str(timeout) + "s") from None
        out = (proc.stdout or "").strip()
        err = (proc.stderr or "").strip()
        if proc.returncode != 0:
            return ("EXIT " + str(proc.returncode) + "\nstdout:\n"
                    + out[-1500:] + "\nstderr:\n" + err[-1500:])
        return out or "(no output)"


TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List the files in the workspace.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a text file from the workspace.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write content to a file in the workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_python",
            "description": "Run Python in the workspace: a file via path, or code.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "code": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "finish",
            "description": "Declare the task done and give the final answer.",
            "parameters": {
                "type": "object",
                "properties": {"answer": {"type": "string"}},
                "required": ["answer"],
            },
        },
    },
]


class _Transient(RuntimeError):
    """A failure worth retrying: the network, not the request."""


class Agent:
    """A chat-completions agent bound to a workspace and a harness."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        max_steps: int = 12,
        timeout: float = 120.0,
        temperature: float = 0.0,
        retries: int = 2,
    ) -> None:
        self.base_url = (
            base_url or os.environ.get("OPENAI_BASE_URL") or DEFAULT_BASE_URL
        ).rstrip("/")
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY") or ""
        self.model = model or os.environ.get("RSI_AGENT_MODEL") or DEFAULT_MODEL
        self.max_steps = max_steps
        self.timeout = timeout
        self.temperature = temperature
        self.retries = retries
        # Set by the caller that wants to show a retry as it happens. It is a
        # plain attribute rather than a constructor argument so that a caller
        # supplying its own agent through agent_factory gets the same hook.
        self._on_retry: Callable[[int, int, str], None] | None = None
        # The backoff is real, but a test should not have to sit through it.
        self._sleep: Callable[[float], None] = time.sleep

    def _post(self, payload: dict) -> dict:
        """POST, retrying only what is worth retrying.

        A 5xx or a dropped connection is the network failing, not the request:
        the same bytes may well succeed a second later. A 4xx is the request
        being wrong, and sending it again just spends the wait twice.

        The retry is bounded and backs off, so a model endpoint that is simply
        down surfaces in seconds rather than hanging the run.
        """
        attempts = max(1, int(self.retries) + 1)
        delay = 0.5
        last = None
        for attempt in range(attempts):
            try:
                return self._post_once(payload)
            except _Transient as exc:
                last = exc
                if attempt + 1 >= attempts:
                    break
                emit_retry = getattr(self, "_on_retry", None)
                if emit_retry is not None:
                    emit_retry(attempt + 1, attempts, str(exc))
                self._sleep(delay)
                delay = min(delay * 2, 8.0)
        raise RuntimeError(str(last) if last is not None else "request failed")

    def _post_once(self, payload: dict) -> dict:
        req = urllib.request.Request(
            self.base_url + "/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
        )
        req.add_header("Authorization", "Bearer " + self.api_key)
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:400]
            message = "HTTP " + str(exc.code) + ": " + detail
            if exc.code >= 500 or exc.code == 429:
                raise _Transient(message) from None
            raise RuntimeError(message) from None
        except OSError as exc:
            # URLError, a refused connection and a socket timeout are all
            # OSError: no answer came back, so the same request may still work.
            reason = getattr(exc, "reason", exc)
            raise _Transient("cannot reach " + self.base_url + ": " + str(reason)) from None

    def run(
        self,
        task: str,
        workspace: Workspace,
        harness: Tree,
        surface: SurfaceSpec,
        *,
        on_step: Callable[[Step], None] | None = None,
        on_event: Callable[[str, dict], None] | None = None,
    ) -> AgentRun:
        """Work the task until the model calls finish, or the step budget runs out."""
        started = time.time()
        emit = on_event or (lambda kind, data: None)
        run = AgentRun(task=task, model=self.model)
        system = harness_system_prompt(surface, harness)

        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append(
            {
                "role": "user",
                "content": (
                    "# TASK\n\n" + task + "\n\n"
                    "# WORKSPACE\n\nYou have a working directory. Use the tools to "
                    "inspect it before writing anything. When the task is complete, "
                    "call finish with a one-line answer."
                ),
            }
        )

        handlers = {
            "list_files": lambda a: workspace.list_files(),
            "read_file": lambda a: workspace.read_file(a.get("path", "")),
            "write_file": lambda a: workspace.write_file(
                a.get("path", ""), a.get("content", "")
            ),
            "run_python": lambda a: workspace.run_python(
                a.get("code", ""), a.get("path", "")
            ),
        }

        try:
            for i in range(self.max_steps):
                emit("step.started", {"index": i})
                step = Step(index=i)
                data = self._post(
                    {
                        "model": self.model,
                        "messages": messages,
                        "tools": TOOL_SCHEMAS,
                        "tool_choice": "auto",
                        "temperature": self.temperature,
                    }
                )
                usage = data.get("usage") or {}
                step.tokens = int(usage.get("completion_tokens") or 0)
                run.prompt_tokens += int(usage.get("prompt_tokens") or 0)
                run.completion_tokens += step.tokens

                choice = (data.get("choices") or [{}])[0]
                msg = choice.get("message") or {}
                step.thinking = str(msg.get("reasoning_content") or "")
                step.assistant = str(msg.get("content") or "")
                raw_calls = msg.get("tool_calls") or []
                emit("step.message", {"index": i, "assistant": step.assistant, "thinking": step.thinking, "tokens": step.tokens, "tools": [str((c.get("function") or {}).get("name") or "") for c in raw_calls]})

                assistant_message: dict = {
                    "role": "assistant",
                    "content": step.assistant or None,
                }
                if raw_calls:
                    assistant_message["tool_calls"] = raw_calls
                messages.append(assistant_message)

                if not raw_calls:
                    run.steps.append(step)
                    run.final = step.assistant.strip()
                    run.stop_reason = "no_tool_call"
                    if on_step:
                        on_step(step)
                    break

                for call in raw_calls:
                    fn = call.get("function") or {}
                    name = str(fn.get("name") or "")
                    try:
                        args = json.loads(fn.get("arguments") or "{}")
                        if not isinstance(args, dict):
                            raise ValueError("arguments must be a JSON object")
                    except (ValueError, json.JSONDecodeError) as exc:
                        output = "bad arguments: " + str(exc)
                        step.calls.append({"name": name, "arguments": {}})
                        step.results.append({"output": output, "error": True})
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": call.get("id", ""),
                                "content": output,
                            }
                        )
                        continue

                    step.calls.append({"name": name, "arguments": args})

                    if name == "finish":
                        answer = str(args.get("answer") or "")
                        step.results.append({"output": answer, "error": False})
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": call.get("id", ""),
                                "content": "acknowledged",
                            }
                        )
                        run.final = answer
                        run.stop_reason = "finish"
                        break

                    handler = handlers.get(name)
                    emit("tool.called", {"index": i, "name": name, "arguments": args})
                    began = time.time()
                    if handler is None:
                        output, is_error = "unknown tool " + repr(name), True
                    else:
                        try:
                            output, is_error = handler(args), False
                        except ToolError as exc:
                            output, is_error = str(exc), True
                        except Exception as exc:
                            output = type(exc).__name__ + ": " + str(exc)
                            is_error = True

                    emit("tool.result", {"index": i, "name": name, "ok": not is_error, "ms": int((time.time() - began) * 1000)})
                    step.results.append({"output": output, "error": is_error})
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.get("id", ""),
                            "content": str(output)[:8000],
                        }
                    )

                run.steps.append(step)
                if on_step:
                    on_step(step)
                if run.stop_reason == "finish":
                    break
            else:
                run.stop_reason = "step_budget"
                run.error = "hit the " + str(self.max_steps) + "-step budget without finishing"
        except Exception as exc:
            run.error = type(exc).__name__ + ": " + str(exc)
            run.stop_reason = run.stop_reason or "error"

        run.seconds = time.time() - started
        emit("run.finished", {"ok": run.ok, "steps": len(run.steps), "seconds": round(run.seconds, 2), "stop_reason": run.stop_reason, "error": run.error})
        return run


def available_models(base_url: str | None = None, api_key: str | None = None) -> list[str]:
    """The model ids the endpoint advertises, for a UI to offer a choice."""
    base = (base_url or os.environ.get("OPENAI_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
    key = api_key or os.environ.get("OPENAI_API_KEY") or ""
    req = urllib.request.Request(base + "/models")
    req.add_header("Authorization", "Bearer " + key)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
    except Exception:
        return []
    return sorted(m.get("id", "") for m in data.get("data", []) if m.get("id"))


__all__ = [
    "Agent",
    "AgentRun",
    "Step",
    "ToolError",
    "Workspace",
    "available_models",
    "harness_system_prompt",
    "DEFAULT_BASE_URL",
    "DEFAULT_MODEL",
    "TOOL_SCHEMAS",
]
