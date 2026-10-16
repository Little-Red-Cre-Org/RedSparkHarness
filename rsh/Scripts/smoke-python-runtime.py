#!/usr/bin/env python3
"""Keyless full-turn and snapshot smoke for the Python SDK runtime."""

from __future__ import annotations

import argparse
import base64
import difflib
import hashlib
import importlib
import importlib.metadata
import json
import os
import queue
import re
import secrets
import shutil
import subprocess
import sys
import sysconfig
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from deepseek_harness import RunResult


EXPECTED_TEXT = "runtime smoke ok"
LIVE_API_SENTINEL = "PYTHON_SDK_LIVE_OK"
CODE_PROMPT = "Use run_code to compute the packaged worker smoke value."
CODE_WORKER_TEXT = "code worker smoke ok"
WORKFLOW_PROMPT = "Use workflow to compute the packaged worker smoke value without agents."
WORKFLOW_WORKER_TEXT = "workflow worker smoke ok"
MINIMAL_PROMPT = "Exercise the packaged minimal agent's persistent shell."
MINIMAL_TEXT = "minimal agent smoke ok"
FS_SEARCH_PROMPT = "Exercise the packaged filesystem search tools."
FS_SEARCH_TEXT = "filesystem search smoke ok"
FS_SEARCH_MARKER = "PACKAGED_FS_SEARCH_OK"
MCP_PROMPT = "Exercise the packaged MCP client with one external stdio server."
MCP_TEXT = "MCP client smoke ok"
PROFILE_PLUGIN_PROMPT = "Verify the Python-installed dsh profile plugin."
PROFILE_PLUGIN_TEXT = "profile plugin smoke ok"
PROFILE_PLUGIN_MARKER = "PYTHON_INSTALLED_DSH_PROFILE_PLUGIN"
NATIVE_EXTERNAL_OPERATION_PROMPT = "Delegate one filesystem change to an external child and report completion."
NATIVE_EXTERNAL_OPERATION_COLD_PROMPT = "Continue after an external SDK process restart."
NATIVE_EXTERNAL_OPERATION_CHILD_PROMPT = "Create one file using the write tool, then report the result."
NATIVE_EXTERNAL_OPERATION_TEXT = "external child completed"
NATIVE_INBOX_FIRST_TASK = "Start the Native SDK Inbox move fixture."
NATIVE_INBOX_COLD_TASK = "Restore the Native SDK Inbox Session after a process restart."
NATIVE_INBOX_FIRST_REPLY = "Native Inbox owner completed."
NATIVE_INBOX_COLD_REPLY = "Native Inbox Session restored."
NATIVE_STAGED_FILES_FIRST_TASK = "Read the staged first file and inspect the image."
NATIVE_STAGED_FILES_SECOND_TASK = "Read the second staged file too."
NATIVE_STAGED_FILES_COLD_TASK = "Cold-read the first staged file again."
NATIVE_STAGED_FILES_WRITE_TASK = "Try to overwrite the staged first file using the saved path."
NATIVE_STAGED_FILES_FIRST_REPLY = "Both uploaded files were read."
NATIVE_STAGED_FILES_COLD_REPLY = "The restored first file is readable."
NATIVE_STAGED_FILES_WRITE_REPLY = "The staged file stayed read-only."
NATIVE_SKILLS_FIRST_TASK = "/review Apply the review skill to the requested change, then summarize its instruction."
NATIVE_SKILLS_COLD_TASK = "/review Continue after restart and follow the review skill again."
NATIVE_SKILLS_TOOL_CALL_ID = "load-review-skill"
NATIVE_SKILLS_BODY = (
    "Always inspect the requested file before proposing a fix. "
    "Use the skill tool to load these instructions when relevant."
)
NATIVE_SKILLS_TOOL_REPLY = "loaded review instructions"
NATIVE_SKILLS_COLD_REPLY = "cold skill Session restored"
NATIVE_STAGED_FILES_GATE: tuple[threading.Event, threading.Event] | None = None
NATIVE_SDK_REFERENCES = (
    Path(__file__).resolve().parent / "snapshots" / "python-sdk-single-exe" / "native-sdk" / "references.json"
)
NATIVE_SDK_EXTERNAL_FIXTURE = NATIVE_SDK_REFERENCES.parent / "external-operation"
NATIVE_SDK_EXTERNAL_DRIVER = NATIVE_SDK_EXTERNAL_FIXTURE / "driver.mjs"
NATIVE_SDK_EXTERNAL_PATHS = NATIVE_SDK_EXTERNAL_FIXTURE / "workspace-paths.mjs"
NATIVE_SDK_EXTERNAL_WORKSPACE = (
    Path(__file__).resolve().parents[2] / "snapshots" / "native-sdk" / "external-operation" / "workspace.expected"
)
IS_WINDOWS = sys.platform == "win32"
MINIMAL_SHELL_TOOL = "pwsh" if IS_WINDOWS else "bash"
MINIMAL_SHELL_COMMAND = (
    "$global:dshSdkCounter = [int]$global:dshSdkCounter + 1; "
    'Write-Output "COUNT=$global:dshSdkCounter CWD=$((Get-Location).Path)"; '
    "if ($global:dshSdkCounter -eq 1) { Set-Location $env:TEMP }"
    if IS_WINDOWS
    else (
        "counter=$(( ${counter:-0} + 1 )); export counter; "
        "printf 'COUNT=%s CWD=%s\\n' \"$counter\" \"$PWD\"; "
        "if [ \"$counter\" -eq 1 ]; then cd /tmp; fi"
    )
)
MINIMAL_SHELL_SECOND_CWD = str(Path(tempfile.gettempdir()).resolve()) if IS_WINDOWS else "/tmp"
SPAWN_NODE_PROMPT = "Run node --version through the packaged shell tool."
SPAWN_NODE_TEXT = "spawn node smoke ok"
SPAWN_NODE_CALL_ID = "spawn-node-shell"
# The POSIX command string starts with `node ` inside the shell tool's `bash -c`
# argv, the exact form @yao-pkg/pkg's unpatched SEA bootstrap rewrites to the
# executable itself while stamping PKG_EXECPATH into the child environment.
SPAWN_NODE_COMMAND = (
    'node --version; if ($env:PKG_EXECPATH) { "PKG_EXECPATH=$env:PKG_EXECPATH" } else { "PKG_EXECPATH=ABSENT" }'
    if IS_WINDOWS
    else 'node --version; echo "PKG_EXECPATH=${PKG_EXECPATH:-ABSENT}"'
)
LEGACY_CUSTOM_DISABLED_ROWS = (
    "agent-instructions",
    "goal",
    "goal-round-driver",
    "command-goal",
    "plan-mode",
    "archify",
    "skill",
    "skill-filesystem",
    "tool-fs",
    "tool-fs-search",
    "tool-goal",
    "tool-ralph",
    "tool-skill",
    "tool-str-replace-editor",
    "tool-subagent-control",
    "tool-subagent-list-agents",
    "tool-subagent-fork",
    "tool-todo",
    "tool-web",
)
SNAPSHOT_PROMPT = "Run the advanced packaged-runtime snapshot scenario."
SNAPSHOT_SESSION_ID = "advanced-executable"
SNAPSHOT_DIRECT_CHILD_PROMPT = "Reply with exactly DIRECT_CHILD_OK and nothing else."
SNAPSHOT_WORKFLOW_CHILD_PROMPT = "Reply with exactly WORKFLOW_CHILD_OK and nothing else."
SNAPSHOT_FINAL_TEXT = "ADVANCED_EXECUTABLE_OK"
RESTART_FIRST_PROMPT = "Complete the first isolated Python SDK process turn."
RESTART_FIRST_TEXT = "PROCESS_ONE_OK"
RESTART_SECOND_PROMPT = "Complete the second isolated Python SDK process turn."
RESTART_SECOND_TEXT = "PROCESS_TWO_OK"
RESTART_FIRST_SESSION_ID = "process-one"
RESTART_SECOND_SESSION_ID = "process-two"
SNAPSHOT_PLUGIN_CODE = """\
return (ctx) => {
  harness.registerTool(ctx, harness.defineTool({
    name: 'snapshot_double',
    description: 'Double a number for executable snapshot verification.',
    parameters: { value: { type: 'number', required: true } },
    output: {
      schema: { type: 'number' },
      render(_args, value) {
        return [{ type: 'text', text: String(value) }]
      }
    },
    async execute(args) {
      return args.value * 2
    }
  }))
}
"""
SNAPSHOT_WORKFLOW_SCRIPT = (
    "phase('Delegate')\n"
    f"const reply = await agent('{SNAPSHOT_WORKFLOW_CHILD_PROMPT}', {{ label: 'workflow-child' }})\n"
    "return { reply }"
)
ADVANCED_SNAPSHOT_DIRECTORY = (
    Path(__file__).resolve().parent / "snapshots" / "python-sdk-single-exe" / "advanced"
)
ADVANCED_SNAPSHOT_FILENAMES = (
    "result.json", "session.v3.jsonl", "session.1.v3.jsonl", "session.2.v3.jsonl",
)
MINIMAL_SNAPSHOT_DIRECTORY = (
    Path(__file__).resolve().parent / "snapshots" / "python-sdk-single-exe" / "minimal"
)
if IS_WINDOWS:
    MINIMAL_SNAPSHOT_DIRECTORY /= "win-x64"
MINIMAL_SNAPSHOT_FILENAMES = ("model-visible.json",)
IN_HISTORY_SNAPSHOT_DIRECTORY = (
    Path(__file__).resolve().parent / "snapshots" / "python-sdk-single-exe" / "minimal-in-history"
)
IN_HISTORY_SNAPSHOT_FILENAMES = ("prompt-history.json",)
RESTART_SNAPSHOT_DIRECTORY = (
    Path(__file__).resolve().parent / "snapshots" / "python-sdk-single-exe" / "restart"
)
RESTART_SNAPSHOT_FILENAMES = (
    "result.json", "requests.json", "session.1.v3.jsonl", "session.2.v3.jsonl",
)
MCP_SERVER_SCRIPT = """\
import json
import os
import sys
import time


log_path = os.environ.get("MCP_SMOKE_LOG")


def send(message):
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\\n")
    sys.stdout.flush()


for line in sys.stdin:
    request = json.loads(line)
    if log_path is not None:
        with open(log_path, "a", encoding="utf-8") as log:
            log.write(str(request.get("method")) + "\\n")
    request_id = request.get("id")
    if request_id is None:
        continue
    method = request.get("method")
    if method == "initialize":
        send({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": request["params"]["protocolVersion"],
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "python-wheel-fixture", "version": "1.0.0"},
            },
        })
    elif method == "tools/list":
        # Keep discovery pending long enough that an SDK runtime answering
        # initialize before discovery completes makes its first model request
        # without this tool and fails deterministically.
        time.sleep(0.25)
        send({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "tools": [{
                    "name": "add",
                    "description": "Add two numbers.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {"a": {"type": "number"}, "b": {"type": "number"}},
                        "required": ["a", "b"],
                        "additionalProperties": False,
                    },
                }],
            },
        })
    elif method == "tools/call":
        params = request["params"]
        if params.get("name") != "add" or params.get("arguments") != {"a": 19, "b": 23}:
            send({
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32602, "message": "unexpected tool call"},
            })
            continue
        send({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {"content": [{"type": "text", "text": "42"}]},
        })
    else:
        send({
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32601, "message": f"unsupported method: {method}"},
        })
"""


def write_profile_patch(
    root: Path,
    name: str,
    sessions: Path,
    patches: list[dict[str, object]],
) -> Path:
    """Write one JSON-form dsh profile patch with deterministic persistence."""
    path = root / name
    path.write_text(json.dumps([
        {
            "id": "session-persistence-jsonl",
            "config": {"root": str(sessions), "compression": "none"},
        },
        {"id": "session-telemetry-otel", "disabled": True},
        *patches,
    ], indent=2))
    return path


def write_advanced_profile_patch(root: Path, name: str, sessions: Path) -> Path:
    """Write the shared custom, snapshot, and restart profile patch."""
    return write_profile_patch(root, name, sessions, [
        {"id": "tools", "config": {"mode": "both"}},
        {
            "id": "system-prompt",
            "config": {
                "persona": "You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.",
            },
        },
        {"id": "session-log-deepseek", "config": {"enabled": True}},
        *({"id": row_id, "disabled": True} for row_id in LEGACY_CUSTOM_DISABLED_ROWS),
        {"id": "tool-bash", "disabled": True},
        {"id": "tool-pwsh", "disabled": True},
        {
            "id": "tool-subagent",
            "config": {
                "provider": "spawn",
                "toolName": "subagent",
                "backgroundMode": "one-shot",
            },
        },
        {"insert": [
            {"id": "code-runtime", "name": "@deepseek-ai/dsh-code-runtime-worker-thread"},
            {"id": "cordis-host-runner", "name": "@deepseek-ai/dsh-cordis-host-runner"},
            {"id": "cordis-tool", "name": "@deepseek-ai/dsh-tool-cordis"},
        ]},
    ])


def write_mcp_patch(root: Path, sessions: Path, server_script: Path) -> Path:
    """Write a profile patch that mounts the packaged MCP client."""
    return write_profile_patch(root, "mcp.patch.yml", sessions, [{
        "insert": [{
            "id": "mcp-fixture",
            "name": "@deepseek-ai/dsh-mcp-client",
            "config": {
                "serverName": "fixture",
                "transport": "stdio",
                "command": sys.executable,
                "args": [str(server_script)],
                "env": {"MCP_SMOKE_LOG": str(server_script.with_suffix(".log"))},
                "failOnStartupError": True,
                "reconnect": {"enabled": False},
            },
        }],
    }])


class MockModelHandler(BaseHTTPRequestHandler):
    """Return deterministic text, worker, and orchestration completions."""

    requests: list[dict[str, object]] = []

    def do_POST(self) -> None:
        content_length = int(self.headers.get("content-length", "0"))
        body = json.loads(self.rfile.read(content_length))
        self.requests.append(body)
        gate = NATIVE_STAGED_FILES_GATE
        if gate is not None and any(
            NATIVE_STAGED_FILES_FIRST_TASK in message_text(message.get("content"))
            for message in body.get("messages", [])
            if isinstance(message, dict) and message.get("role") == "user"
        ):
            gate[0].set()
            if not gate[1].wait(timeout=60):
                raise TimeoutError("installed staged-file turn was not released after upload and steer")
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        chunks = completion_chunks(body)
        for chunk in chunks:
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def log_message(self, _format: str, *_args: object) -> None:
        return


def completion_chunks(body: dict[str, object]) -> list[dict[str, object]]:
    """Choose the next deterministic model response from request history."""
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        raise AssertionError(f"model request has no messages: {body}")
    # A system prompt update may follow the tool result without replacing it.
    latest = next(message for message in reversed(messages) if message.get("role") != "system")
    if not isinstance(latest, dict):
        raise AssertionError(f"model request has an invalid latest message: {body}")

    if latest.get("role") == "tool":
        call_id, tool_name = latest_tool_call(messages)
        tool_text = message_text(latest.get("content"))
        staged_followup = native_staged_files_tool_followup(call_id, tool_name, tool_text)
        if staged_followup is not None:
            return staged_followup
        if call_id == "native-sdk-external-child" and tool_name == "subagent":
            if "Child wrote created.txt." not in tool_text:
                raise AssertionError(f"external SDK child returned no recorded file result: {tool_text}")
            return text_chunks(NATIVE_EXTERNAL_OPERATION_TEXT)
        mcp = mcp_tool_followup(call_id, tool_name, tool_text)
        if mcp is not None:
            return mcp
        if call_id == NATIVE_SKILLS_TOOL_CALL_ID and tool_name == "skill":
            return text_chunks(NATIVE_SKILLS_TOOL_REPLY)
        fs_search = fs_search_tool_followup(call_id, tool_name, tool_text)
        if fs_search is not None:
            return fs_search
        spawn_node = spawn_node_tool_followup(call_id, tool_name, tool_text)
        if spawn_node is not None:
            return spawn_node
        minimal = minimal_tool_followup(call_id, tool_name, tool_text)
        if minimal is not None:
            return minimal
        advanced = advanced_tool_followup(body, call_id, tool_name, tool_text)
        if advanced is not None:
            return advanced
        if "42" not in tool_text:
            raise AssertionError(f"{tool_name} worker returned no expected value: {latest}")
        if tool_name == "run_code":
            return text_chunks(CODE_WORKER_TEXT)
        if tool_name == "workflow":
            return text_chunks(WORKFLOW_WORKER_TEXT)
        raise AssertionError(f"unexpected tool follow-up: {tool_name}")

    user_prompts = [
        message_text(message.get("content"))
        for message in reversed(messages)
        if isinstance(message, dict) and message.get("role") == "user"
    ]
    minimal_prompt = next((prompt for prompt in user_prompts if prompt == MINIMAL_PROMPT), None)
    # The minimal composition's assembled system prompt, advertised tool schemas, and
    # model-visible messages are pinned by its snapshot, not asserted here.
    if minimal_prompt is not None:
        return tool_call_chunks(
            "minimal-bash-1",
            MINIMAL_SHELL_TOOL,
            {"command": MINIMAL_SHELL_COMMAND},
        )
    scenario_prompts = {
        SNAPSHOT_DIRECT_CHILD_PROMPT,
        SNAPSHOT_WORKFLOW_CHILD_PROMPT,
        SNAPSHOT_PROMPT,
        CODE_PROMPT,
        WORKFLOW_PROMPT,
        FS_SEARCH_PROMPT,
        SPAWN_NODE_PROMPT,
        MCP_PROMPT,
        RESTART_FIRST_PROMPT,
        RESTART_SECOND_PROMPT,
        PROFILE_PLUGIN_PROMPT,
        NATIVE_EXTERNAL_OPERATION_PROMPT,
        NATIVE_EXTERNAL_OPERATION_COLD_PROMPT,
        NATIVE_INBOX_FIRST_TASK,
        NATIVE_INBOX_COLD_TASK,
        NATIVE_STAGED_FILES_FIRST_TASK,
        NATIVE_STAGED_FILES_SECOND_TASK,
        NATIVE_STAGED_FILES_COLD_TASK,
        NATIVE_STAGED_FILES_WRITE_TASK,
        NATIVE_SKILLS_FIRST_TASK,
        NATIVE_SKILLS_COLD_TASK,
    }
    latest_user_prompt = user_prompts[0] if user_prompts else ""
    staged_prompt = next(
        (candidate for candidate in (
            NATIVE_STAGED_FILES_FIRST_TASK,
            NATIVE_STAGED_FILES_SECOND_TASK,
            NATIVE_STAGED_FILES_COLD_TASK,
            NATIVE_STAGED_FILES_WRITE_TASK,
        ) if candidate in latest_user_prompt),
        None,
    )
    prompt = staged_prompt or next(
        (candidate for candidate in user_prompts if candidate in scenario_prompts),
        message_text(latest.get("content")),
    )
    if prompt == SNAPSHOT_DIRECT_CHILD_PROMPT:
        return text_chunks("DIRECT_CHILD_OK")
    if prompt == SNAPSHOT_WORKFLOW_CHILD_PROMPT:
        return text_chunks("WORKFLOW_CHILD_OK")
    if prompt == SNAPSHOT_PROMPT:
        assert_advertised_tool(body, "cordis_define")
        return tool_call_chunks(
            "advanced-define",
            "cordis_define",
            {
                "plugin": {"kind": "new", "idPrefix": "snap"},
                "name": "Snapshot Double",
                "purpose": "Expose a deterministic doubling tool for executable snapshot verification.",
                "code": {"host": SNAPSHOT_PLUGIN_CODE},
            },
        )
    if prompt == RESTART_FIRST_PROMPT:
        return text_chunks(RESTART_FIRST_TEXT)
    if prompt == RESTART_SECOND_PROMPT:
        if any(
            isinstance(message, dict)
            and RESTART_FIRST_TEXT in message_text(message.get("content"))
            for message in messages
        ):
            raise AssertionError("second isolated process inherited the first process history")
        return text_chunks(RESTART_SECOND_TEXT)
    if prompt == CODE_PROMPT:
        assert_advertised_tool(body, "run_code")
        return tool_call_chunks(
            "call-code-worker",
            "run_code",
            {"code": "return 6 * 7", "description": "Compute the smoke value"},
        )
    if prompt == WORKFLOW_PROMPT:
        assert_advertised_tool(body, "workflow")
        return tool_call_chunks(
            "call-workflow-worker",
            "workflow",
            {
                "script": "return 6 * 7",
                "meta": {
                    "name": "pkg-worker-smoke",
                    "description": "exercise the packaged workflow worker",
                },
            },
        )
    if prompt == FS_SEARCH_PROMPT:
        assert_advertised_tool(body, "grep")
        assert_advertised_tool(body, "glob")
        return tool_call_chunks(
            "fs-search-grep",
            "grep",
            {"pattern": FS_SEARCH_MARKER, "path": "."},
        )
    if prompt == SPAWN_NODE_PROMPT:
        assert_advertised_tool(body, MINIMAL_SHELL_TOOL)
        return tool_call_chunks(
            SPAWN_NODE_CALL_ID,
            MINIMAL_SHELL_TOOL,
            {"command": SPAWN_NODE_COMMAND, "description": "Report the reachable Node version"},
        )
    if prompt == MCP_PROMPT:
        assert_advertised_tool(body, "mcp__fixture__add")
        return tool_call_chunks(
            "mcp-add",
            "mcp__fixture__add",
            {"a": 19, "b": 23},
        )
    if prompt == PROFILE_PLUGIN_PROMPT:
        system_text = "\n".join(
            message_text(message.get("content"))
            for message in messages
            if isinstance(message, dict) and message.get("role") == "system"
        )
        if PROFILE_PLUGIN_MARKER not in system_text:
            raise AssertionError("external profile plugin contributed no model-visible marker")
        return text_chunks(PROFILE_PLUGIN_TEXT)
    if prompt == NATIVE_EXTERNAL_OPERATION_PROMPT:
        assert_advertised_tool(body, "subagent")
        return tool_call_chunks("native-sdk-external-child", "subagent", {
            "description": "Replay one external Native SDK operation sequence.",
            "prompt": NATIVE_EXTERNAL_OPERATION_CHILD_PROMPT,
        })
    if prompt == NATIVE_EXTERNAL_OPERATION_COLD_PROMPT:
        return text_chunks("cold SDK Session restored")
    if prompt == NATIVE_INBOX_FIRST_TASK:
        return text_chunks(NATIVE_INBOX_FIRST_REPLY)
    if prompt == NATIVE_INBOX_COLD_TASK:
        return text_chunks(NATIVE_INBOX_COLD_REPLY)
    if prompt == NATIVE_SKILLS_FIRST_TASK:
        assert_advertised_tool(body, "skill")
        return tool_call_chunks(NATIVE_SKILLS_TOOL_CALL_ID, "skill", {"name": "review"})
    if prompt == NATIVE_SKILLS_COLD_TASK:
        return text_chunks(NATIVE_SKILLS_COLD_REPLY)
    if prompt in {NATIVE_STAGED_FILES_FIRST_TASK, NATIVE_STAGED_FILES_SECOND_TASK,
                  NATIVE_STAGED_FILES_COLD_TASK, NATIVE_STAGED_FILES_WRITE_TASK}:
        filename = "second.txt" if prompt == NATIVE_STAGED_FILES_SECOND_TASK else "first.txt"
        handle = native_staged_file_handle(body, filename)
        if prompt == NATIVE_STAGED_FILES_WRITE_TASK:
            assert_advertised_tool(body, "write_file")
            return tool_call_chunks("installed-native-staged-write", "write_file",
                                    {"path": handle, "content": "must remain denied"})
        assert_advertised_tool(body, "read_file")
        call_id = {
            NATIVE_STAGED_FILES_FIRST_TASK: "installed-native-staged-first-read",
            NATIVE_STAGED_FILES_SECOND_TASK: "installed-native-staged-second-read",
            NATIVE_STAGED_FILES_COLD_TASK: "installed-native-staged-cold-read",
        }[prompt]
        return tool_call_chunks(call_id, "read_file", {"path": handle})
    return text_chunks(EXPECTED_TEXT)


def native_staged_files_tool_followup(call_id: str, tool_name: str,
                                      tool_text: str) -> list[dict[str, object]] | None:
    """Verify real installed read_file results and the external-path write denial."""
    expected_text = {
        "installed-native-staged-first-read": "First staged attachment: alpha-attachment-bytes",
        "installed-native-staged-second-read": "Second staged attachment: beta-attachment-bytes",
        "installed-native-staged-cold-read": "First staged attachment: alpha-attachment-bytes",
    }
    expected = expected_text.get(call_id)
    if expected is not None:
        if tool_name != "read_file" or expected not in tool_text:
            raise AssertionError(f"installed staged-file read returned unexpected content: {tool_name}: {tool_text}")
        if call_id == "installed-native-staged-second-read":
            return text_chunks(NATIVE_STAGED_FILES_FIRST_REPLY)
        if call_id == "installed-native-staged-cold-read":
            return text_chunks(NATIVE_STAGED_FILES_COLD_REPLY)
        return text_chunks("The first staged file was read.")
    if call_id == "installed-native-staged-write":
        if tool_name != "write_file" or "path outside workspace:" not in tool_text:
            raise AssertionError(f"installed staged-file write was not denied by Native workspace policy: {tool_name}: {tool_text}")
        return text_chunks(NATIVE_STAGED_FILES_WRITE_REPLY)
    return None


def mcp_tool_followup(
    call_id: str,
    tool_name: str,
    tool_text: str,
) -> list[dict[str, object]] | None:
    """Verify one tool call through the packaged MCP client."""
    if call_id != "mcp-add":
        return None
    if tool_name != "mcp__fixture__add" or "42" not in tool_text:
        raise AssertionError(f"packaged MCP call returned an unexpected result: {tool_name}: {tool_text}")
    return text_chunks(MCP_TEXT)


def fs_search_tool_followup(
    call_id: str,
    tool_name: str,
    tool_text: str,
) -> list[dict[str, object]] | None:
    """Exercise both ripgrep-backed tools through the packaged executable."""
    if not call_id.startswith("fs-search-"):
        return None
    if call_id == "fs-search-grep" and tool_name == "grep":
        if "needle.txt" not in tool_text or FS_SEARCH_MARKER not in tool_text:
            raise AssertionError(f"packaged grep returned no marker: {tool_text}")
        return tool_call_chunks(
            "fs-search-glob",
            "glob",
            {"pattern": "**/*.txt"},
        )
    if call_id == "fs-search-glob" and tool_name == "glob":
        if "needle.txt" not in tool_text:
            raise AssertionError(f"packaged glob returned no fixture path: {tool_text}")
        return text_chunks(FS_SEARCH_TEXT)
    raise AssertionError(f"unexpected filesystem-search follow-up: {call_id} {tool_name}: {tool_text}")


def host_node_version() -> str:
    """The machine's own `node --version` line, the required shell resolution target."""
    node = shutil.which("node")
    if node is None:
        raise AssertionError("the spawn-node scenario requires Node on PATH for comparison")
    return subprocess.run(
        [node, "--version"], capture_output=True, text=True, check=True,
    ).stdout.strip()


def spawn_node_tool_followup(
    call_id: str,
    tool_name: str,
    tool_text: str,
) -> list[dict[str, object]] | None:
    """Verify the packaged shell reached the machine's Node with a clean environment."""
    if call_id != SPAWN_NODE_CALL_ID:
        return None
    if tool_name != MINIMAL_SHELL_TOOL:
        raise AssertionError(f"spawn-node follow-up used an unexpected tool: {tool_name}")
    expected = host_node_version()
    if expected not in tool_text:
        raise AssertionError(
            f"packaged shell did not reach the machine's node {expected}: {tool_text}"
        )
    if "PKG_EXECPATH=ABSENT" not in tool_text:
        raise AssertionError(f"PKG_EXECPATH reached the shell child environment: {tool_text}")
    return text_chunks(SPAWN_NODE_TEXT)


def minimal_tool_followup(
    call_id: str,
    tool_name: str,
    tool_text: str,
) -> list[dict[str, object]] | None:
    """Verify the checked-in minimal composition's persistent PTY."""
    if not call_id.startswith("minimal-"):
        return None
    if call_id == "minimal-bash-1" and tool_name == MINIMAL_SHELL_TOOL:
        if "COUNT=1" not in tool_text:
            raise AssertionError(f"first persistent shell call lost its output: {tool_text}")
        return tool_call_chunks(
            "minimal-bash-2",
            MINIMAL_SHELL_TOOL,
            {"command": MINIMAL_SHELL_COMMAND},
        )
    if call_id == "minimal-bash-2" and tool_name == MINIMAL_SHELL_TOOL:
        expected = f"COUNT=2 CWD={MINIMAL_SHELL_SECOND_CWD}"
        if expected.lower() not in tool_text.lower():
            raise AssertionError(f"persistent shell did not retain state: {tool_text}")
        return text_chunks(MINIMAL_TEXT)
    raise AssertionError(f"unexpected minimal-agent follow-up: {call_id} {tool_name}: {tool_text}")


def advanced_tool_followup(
    body: dict[str, object],
    call_id: str,
    tool_name: str,
    tool_text: str,
) -> list[dict[str, object]] | None:
    """Advance the executable snapshot's deterministic parent tool chain."""
    if not call_id.startswith("advanced-"):
        return None
    if call_id == "advanced-define" and tool_name == "cordis_define":
        if "Defined snap-1/pkg-1 (Snapshot Double)" not in tool_text:
            raise AssertionError(f"cordis_define returned no dynamic Package ids: {tool_text}")
        if "snapshot_double" in advertised_tool_names(body):
            raise AssertionError("snapshot_double was advertised before cordis_run")
        assert_advertised_tool(body, "cordis_run")
        return tool_call_chunks(
            "advanced-run",
            "cordis_run",
            {"pluginId": "snap-1", "packageId": "pkg-1", "mode": "run"},
        )
    if call_id == "advanced-run" and tool_name == "cordis_run":
        if "snap-1/pkg-1 is running (run-1)" not in tool_text:
            raise AssertionError(f"cordis_run returned no running Package ids: {tool_text}")
        assert_advertised_tool(body, "run_code")
        assert_advertised_tool(body, "snapshot_double")
        return tool_call_chunks(
            "advanced-code",
            "run_code",
            {
                "code": "return await tools.snapshot_double({ value: 21 })",
                "description": "Run the temporary Plugin tool",
            },
        )
    if call_id == "advanced-code" and tool_name == "run_code":
        if "42" not in tool_text:
            raise AssertionError(f"run_code returned no dynamic-tool value: {tool_text}")
        assert_advertised_tool(body, "subagent")
        return tool_call_chunks(
            "advanced-direct-child",
            "subagent",
            {
                "description": "Check direct child",
                "prompt": SNAPSHOT_DIRECT_CHILD_PROMPT,
            },
        )
    if call_id == "advanced-direct-child" and tool_name == "subagent":
        if "DIRECT_CHILD_OK" not in tool_text:
            raise AssertionError(f"subagent returned no expected child value: {tool_text}")
        assert_advertised_tool(body, "workflow")
        return tool_call_chunks(
            "advanced-workflow",
            "workflow",
            {
                "script": SNAPSHOT_WORKFLOW_SCRIPT,
                "meta": {
                    "name": "advanced-exe-snapshot",
                    "description": "exercise one packaged workflow child",
                },
            },
        )
    if call_id == "advanced-workflow" and tool_name == "workflow":
        if "WORKFLOW_CHILD_OK" not in tool_text:
            raise AssertionError(f"workflow returned no expected child value: {tool_text}")
        assert_advertised_tool(body, "cordis_undefine")
        return tool_call_chunks(
            "advanced-undefine",
            "cordis_undefine",
            {"pluginId": "snap-1"},
        )
    if call_id == "advanced-undefine" and tool_name == "cordis_undefine":
        if "Removed dynamic Plugin snap-1 and all of its Packages." not in tool_text:
            raise AssertionError(f"cordis_undefine returned no removal result: {tool_text}")
        if "snapshot_double" in advertised_tool_names(body):
            raise AssertionError("snapshot_double remained advertised after cordis_undefine")
        return text_chunks(SNAPSHOT_FINAL_TEXT)
    raise AssertionError(f"unexpected advanced tool follow-up: {call_id} {tool_name}: {tool_text}")


def text_chunks(text: str) -> list[dict[str, object]]:
    """Build a complete streaming text response."""
    return [
        {"choices": [{"delta": {"role": "assistant", "content": None, "reasoning_content": ""}}]},
        {"choices": [{"delta": {"content": text}}]},
        {
            "choices": [{"delta": {"content": ""}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 3},
        },
    ]


def tool_call_chunks(call_id: str, name: str, arguments: dict[str, object]) -> list[dict[str, object]]:
    """Build a complete streaming function-call response."""
    return [
        {"choices": [{"delta": {"role": "assistant", "content": None, "reasoning_content": ""}}]},
        {
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": call_id,
                        "type": "function",
                        "function": {"name": name, "arguments": json.dumps(arguments)},
                    }],
                },
            }],
        },
        {
            "choices": [{"delta": {"content": ""}, "finish_reason": "tool_calls"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 3},
        },
    ]


def latest_tool_call(messages: list[object]) -> tuple[str, str]:
    """Find the assistant call id and name paired with the latest tool result."""
    for message in reversed(messages[:-1]):
        if not isinstance(message, dict):
            continue
        calls = message.get("tool_calls")
        if not isinstance(calls, list):
            continue
        for call in reversed(calls):
            if not isinstance(call, dict):
                continue
            function = call.get("function")
            call_id = call.get("id")
            if (
                isinstance(call_id, str)
                and isinstance(function, dict)
                and isinstance(function.get("name"), str)
            ):
                return call_id, function["name"]
    raise AssertionError(f"tool result has no preceding assistant tool call: {messages}")


def message_text(content: object) -> str:
    """Read OpenAI text content in either string or block-list form."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and isinstance(block.get("text"), str)
        )
    return ""


def advertised_tool_names(body: dict[str, object]) -> set[str]:
    """Return the model-facing tool names advertised on one request."""
    tools = body.get("tools")
    if not isinstance(tools, list):
        raise AssertionError(f"model request advertised no tools: {body}")
    names: set[str] = set()
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        function = tool.get("function")
        if isinstance(function, dict) and isinstance(function.get("name"), str):
            names.add(function["name"])
    return names


def assert_advertised_tool(body: dict[str, object], expected: str) -> None:
    """Require the packaged deployment to expose the requested tool."""
    names = advertised_tool_names(body)
    if expected not in names:
        raise AssertionError(f"model request did not advertise {expected}: {names}")


class MockModel:
    def __enter__(self) -> "MockModel":
        MockModelHandler.requests.clear()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), MockModelHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.server.server_address
        self.url = f"http://{host}:{port}"
        return self

    def __exit__(self, _exc_type: object, _exc: object, _tb: object) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--scenario",
        choices=("all", "sdk-default", "sdk-native", "sdk-custom", "sdk-minimal", "sdk-minimal-in-history", "sdk-fs-search", "sdk-spawn-node", "sdk-mcp", "sdk-snapshot", "sdk-restart", "sdk-profile-plugin", "sdk-live", "runner", "direct"),
        default="all",
    )
    parser.add_argument("--exe", type=Path)
    parser.add_argument(
        "--installed-wheel",
        action="store_true",
        help="require a clean virtual environment containing matching installed SDK and runtime wheels",
    )
    parser.add_argument("--update-snapshots", action="store_true")
    args = parser.parse_args()
    if args.installed_wheel and args.exe is not None:
        parser.error("--installed-wheel resolves the wheel's own runtime and cannot be combined with --exe")
    if args.scenario == "sdk-live" and not args.installed_wheel:
        parser.error("--scenario sdk-live requires --installed-wheel")
    if args.scenario == "sdk-profile-plugin" and not args.installed_wheel:
        parser.error("--scenario sdk-profile-plugin requires --installed-wheel")
    if args.scenario == "sdk-native" and not args.installed_wheel:
        parser.error("--scenario sdk-native requires --installed-wheel")
    if args.installed_wheel:
        args.exe = assert_installed_wheel_environment()
    if args.scenario in {"all", "sdk-custom", "sdk-minimal", "sdk-minimal-in-history", "sdk-fs-search", "sdk-spawn-node", "sdk-snapshot", "sdk-restart", "runner", "direct"} and args.exe is None:
        parser.error("--exe is required for custom, minimal, fs-search, spawn-node, snapshot, restart, runner, and direct scenarios")
    if args.update_snapshots and args.scenario not in {"all", "sdk-minimal", "sdk-minimal-in-history", "sdk-snapshot", "sdk-restart"}:
        parser.error("--update-snapshots requires --scenario sdk-minimal, sdk-minimal-in-history, sdk-snapshot, sdk-restart, or all")
    if args.exe is not None and not args.exe.is_file():
        parser.error(f"runtime executable does not exist: {args.exe}")

    if args.scenario in {"all", "runner"}:
        assert args.exe is not None
        smoke_packaged_runner(args.exe.resolve())
    if args.scenario == "runner":
        print("smoke-python-runtime: runner passed")
        return

    if args.scenario == "sdk-live":
        smoke_sdk_live()
        print("smoke-python-runtime: sdk-live passed")
        return

    with MockModel() as model:
        if args.scenario in {"all", "sdk-default"}:
            smoke_sdk_default(model.url)
        if args.scenario == "sdk-native" or (args.scenario == "all" and args.installed_wheel):
            assert args.exe is not None
            smoke_sdk_native(model.url, args.exe.resolve())
        if args.scenario in {"all", "sdk-custom"}:
            assert args.exe is not None
            smoke_sdk_custom(model.url, args.exe.resolve())
        if args.scenario in {"all", "sdk-minimal"}:
            assert args.exe is not None
            smoke_sdk_minimal(model.url, args.exe.resolve(), args.update_snapshots)
        if args.scenario in {"all", "sdk-minimal-in-history"}:
            assert args.exe is not None
            smoke_sdk_minimal(model.url, args.exe.resolve(), args.update_snapshots, in_history=True)
        if args.scenario in {"all", "sdk-fs-search"}:
            assert args.exe is not None
            smoke_sdk_fs_search(model.url, args.exe.resolve())
        if args.scenario in {"all", "sdk-spawn-node"}:
            assert args.exe is not None
            smoke_sdk_spawn_node(model.url, args.exe.resolve())
        if args.scenario in {"all", "sdk-mcp"}:
            smoke_sdk_mcp(model.url, None if args.exe is None else args.exe.resolve())
        if args.scenario in {"all", "sdk-snapshot"}:
            assert args.exe is not None
            smoke_sdk_snapshot(model.url, args.exe.resolve(), args.update_snapshots)
        if args.scenario in {"all", "sdk-restart"}:
            assert args.exe is not None
            smoke_sdk_restart_snapshot(model.url, args.exe.resolve(), args.update_snapshots)
        if args.installed_wheel and args.scenario in {"all", "sdk-profile-plugin"}:
            smoke_sdk_profile_plugin(model.url)
        if args.scenario in {"all", "direct"}:
            assert args.exe is not None
            smoke_direct(model.url, args.exe.resolve())
        if not MockModelHandler.requests:
            raise AssertionError("mock model endpoint received no requests")
    print(f"smoke-python-runtime: {args.scenario} passed")


def assert_installed_wheel_environment() -> Path:
    """Prove that this process imports matching non-editable wheel installations."""
    if sys.prefix == sys.base_prefix:
        raise AssertionError("installed-wheel smoke must run inside a virtual environment")
    if "PYTHONPATH" in os.environ:
        raise AssertionError("installed-wheel smoke requires PYTHONPATH to be unset")
    if "DSH_RUNTIME_MODE" in os.environ:
        raise AssertionError("installed-wheel smoke requires DSH_RUNTIME_MODE to be unset")

    repo_root = Path(__file__).resolve().parents[2]
    cwd = Path.cwd().resolve()
    if cwd.is_relative_to(repo_root):
        raise AssertionError(f"installed-wheel smoke must run outside the repository, got {cwd}")

    sdk_version = importlib.metadata.version("deepseek-harness-sdk")
    runtime_version = importlib.metadata.version("deepseek-harness-runtime-bin")
    if sdk_version != runtime_version:
        raise AssertionError(
            f"installed SDK/runtime versions differ: {sdk_version} != {runtime_version}"
        )
    expected_runtime_requirement = f"deepseek-harness-runtime-bin=={sdk_version}"
    requirements = importlib.metadata.requires("deepseek-harness-sdk") or []
    if expected_runtime_requirement not in requirements:
        raise AssertionError(
            f"installed SDK does not require {expected_runtime_requirement}: {requirements}"
        )

    prefix = Path(sys.prefix).resolve()
    imported: dict[str, Path] = {}
    for name in ("deepseek_harness", "deepseek_harness_runtime"):
        module = importlib.import_module(name)
        module_file = getattr(module, "__file__", None)
        if not isinstance(module_file, str):
            raise AssertionError(f"installed module {name} has no filesystem location")
        path = Path(module_file).resolve()
        if not path.is_relative_to(prefix):
            raise AssertionError(f"installed module {name} came from outside the virtual environment: {path}")
        if path.is_relative_to(repo_root):
            raise AssertionError(f"installed module {name} came from the repository checkout: {path}")
        imported[name] = path

    runtime_module = sys.modules["deepseek_harness_runtime"]
    executable = runtime_module.bundled_runtime_path().resolve()
    runtime_package = imported["deepseek_harness_runtime"].parent
    if not executable.is_relative_to(runtime_package):
        raise AssertionError(f"bundled runtime came from outside the installed runtime wheel: {executable}")
    runtime_files = importlib.metadata.files("deepseek-harness-runtime-bin") or []
    if not any(Path(file).name == executable.name for file in runtime_files):
        raise AssertionError(f"runtime executable is absent from installed distribution records: {executable}")
    return executable


def smoke_sdk_live() -> None:
    """Run a real-model, tool-using two-turn task through installed wheels."""
    from deepseek_harness import DeepSeekHarness

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    base_url = os.environ.get("DEEPSEEK_BASE_URL")
    if not api_key:
        raise AssertionError("sdk-live requires DEEPSEEK_API_KEY")
    if not base_url:
        raise AssertionError("sdk-live requires an explicit DEEPSEEK_BASE_URL")

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-live-") as temporary:
        root = Path(temporary).resolve()
        dsh_home = root / "home"
        sessions = dsh_home / "sessions"
        marker = root / "live-api-marker.txt"
        session_id = "installed-wheel-live-api"
        shell_tool = "pwsh" if IS_WINDOWS else "bash"
        create_prompt = (
            f"Use the {shell_tool} tool to create the file at the absolute path below with exact UTF-8 "
            f"content {LIVE_API_SENTINEL}, with no newline or byte-order mark. "
            f"Then reply with exactly {LIVE_API_SENTINEL}.\n{marker}"
        )
        with DeepSeekHarness(
            provider="deepseek-official",
            model="deepseek-v4-flash",
            cwd=str(root),
            dsh_home=str(dsh_home),
            env={
                "DSH_PERMISSION_MODE": "danger-full-access",
                "DSH_TELEMETRY_DISABLED": "1",
            },
            api_key=api_key,
            base_url=base_url,
            request_timeout_seconds=180,
        ) as harness:
            created = harness.run(create_prompt, session_id=session_id)
            assert_live_turn("create", created)
            if not marker.is_file():
                raise AssertionError(f"create turn did not create {marker}")
            if marker.read_bytes() != LIVE_API_SENTINEL.encode("utf-8"):
                raise AssertionError(f"create turn wrote unexpected bytes to {marker}")

            # The challenge is absent from the prior turn and the verification prompt.
            challenge = secrets.token_hex(32).encode("ascii")
            marker.write_bytes(challenge)
            with tempfile.TemporaryDirectory(prefix="receipt-", dir=root) as receipt_directory:
                receipt = Path(receipt_directory) / "receipt.txt"
                verify_prompt = (
                    "The file created in the previous turn has changed externally. "
                    "Use a tool to read that same file and copy its exact current content to the "
                    "new receipt path below, without changing the source file. "
                    "Preserve every byte; do not add a newline or byte-order mark. "
                    f"{LIVE_API_SENTINEL} is only the completion acknowledgement, "
                    "not a claim about the source or receipt contents. "
                    f"Then reply with exactly {LIVE_API_SENTINEL}.\n{receipt}"
                )
                verified = harness.run(verify_prompt, session_id=session_id)
                assert_live_turn("verify", verified)
                if not receipt.is_file():
                    raise AssertionError(f"verify turn did not create receipt {receipt}")
                if receipt.read_bytes() != challenge:
                    raise AssertionError(f"verify turn wrote unexpected bytes to receipt {receipt}")
                if not marker.is_file() or marker.read_bytes() != challenge:
                    raise AssertionError(f"verify turn changed source file {marker}")
        assert_zstd_session_log(sessions)


def assert_live_turn(label: str, result: RunResult) -> None:
    """Require completed model tool use and the exact smoke answer for each live turn."""
    if result.finish_reason != "completed":
        event_types = [event.get("type") for event in result.events]
        turn_end_data = next(
            (event.get("data") for event in reversed(result.events) if event.get("type") == "turn/end"),
            None,
        )
        turn_end = safe_turn_end(turn_end_data)
        raise AssertionError(
            f"{label} turn ended with {result.finish_reason!r}; "
            f"final={result.final_response!r}; turn_end={turn_end!r}; events={event_types}"
        )
    if not any(event.get("type") == "tool/call" for event in result.events):
        raise AssertionError(
            f"{label} turn made no model-requested tool call; "
            f"final={result.final_response!r}"
        )
    if result.final_response.strip() != LIVE_API_SENTINEL:
        raise AssertionError(f"{label} turn returned {result.final_response!r}")

def safe_turn_end(value: object) -> object:
    """Project a live-provider failure without retaining credential-bearing text."""
    if not isinstance(value, dict):
        return value
    reason = value.get("reason")
    if not isinstance(reason, dict):
        return {"turn": value.get("turn"), "reason": reason}
    error = reason.get("error")
    safe_error = None
    if isinstance(error, dict):
        safe_error = {
            key: error.get(key)
            for key in ("code", "status")
            if error.get(key) is not None
        }
    return {
        "turn": value.get("turn"),
        "reason": {
            "kind": reason.get("kind"),
            **({"error": safe_error} if safe_error is not None else {}),
        },
    }


def smoke_sdk_default(base_url: str) -> None:
    from deepseek_harness import DeepSeekHarness

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-default-") as temporary:
        root = Path(temporary).resolve()
        dsh_home = root / "home"
        sessions = dsh_home / "sessions"
        with DeepSeekHarness(
            provider="deepseek-official",
            model="smoke-model",
            cwd=str(root),
            dsh_home=str(dsh_home),
            env={
                "DSH_PERMISSION_MODE": "danger-full-access",
                "DSH_TELEMETRY_DISABLED": "1",
            },
            api_key="sk-keyless-smoke",
            base_url=base_url,
            request_timeout_seconds=60,
        ) as harness:
            result = harness.run("reply with the smoke text", session_id="default-smoke")
        assert result.final_response == EXPECTED_TEXT, (
            f"final={result.final_response!r} finish={result.finish_reason!r} "
            f"events={[event.get('type') for event in result.events]!r} "
            f"turn_end={safe_turn_end(next((event.get('data', event) for event in reversed(result.events) if event.get('type') == 'turn/end'), {}))!r}"
        )
        assert_zstd_session_log(sessions)


def read_native_sdk_reference(name: str) -> dict[str, object]:
    """Read one explicit, read-only canonical Session reference for installed-wheel replay."""
    manifest = json.loads(NATIVE_SDK_REFERENCES.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or manifest.get("version") != 1:
        raise AssertionError(f"invalid installed Native SDK reference owner: {NATIVE_SDK_REFERENCES}")
    entry = manifest.get(name)
    if not isinstance(entry, dict):
        raise AssertionError(f"invalid installed Native SDK reference owner: {NATIVE_SDK_REFERENCES}")
    session_reference = entry.get("session")
    if not isinstance(session_reference, str):
        raise AssertionError(f"Native SDK reference omitted its canonical Session path: {name}")
    session_path = (NATIVE_SDK_REFERENCES.parent / session_reference).resolve()
    repo_root = Path(__file__).resolve().parents[2]
    if not session_path.is_relative_to(repo_root) or not session_path.is_file():
        raise AssertionError(f"Native SDK canonical reference is missing or outside the checkout: {session_path}")
    version_match = re.fullmatch(r"session\.v([1-9]\d*)\.jsonl", session_path.name)
    if version_match is None:
        raise AssertionError(f"Native SDK reference must name a versioned parent Session: {session_path}")
    selected_parent = selected_snapshot_session_files(session_path.parent).get(0)
    if selected_parent is None or selected_parent.resolve() != session_path:
        raise AssertionError(
            f"Native SDK Session reference is stale: {session_path}; selected parent is {selected_parent}"
        )
    session_text = session_path.read_text(encoding="utf-8")
    records = [json.loads(line) for line in session_text.splitlines() if line]
    if not records:
        raise AssertionError(f"Native SDK canonical reference has a mismatched Session generation: {session_path}")
    owner_path = entry.get("owner")
    if owner_path is not None:
        resolved_owner = (NATIVE_SDK_REFERENCES.parent / str(owner_path)).resolve()
        if not resolved_owner.is_relative_to(repo_root) or not resolved_owner.is_file():
            raise AssertionError(f"Native SDK reference owner is missing or outside the checkout: {resolved_owner}")
        entry["ownerPath"] = resolved_owner
    entry["sessionPath"] = session_path
    entry["records"] = records
    return entry


def native_public_inputs(records: list[dict[str, object]], expected: tuple[str, ...]) -> list[str]:
    """Select only the canonical scenario's explicitly owned public request texts."""
    selected: list[str] = []
    for event in records:
        data = event.get("data")
        message = data if isinstance(data, dict) else None
        if event.get("type") != "user/message" or not isinstance(message, dict) \
                or not isinstance(message.get("source"), dict) or message["source"].get("kind") != "user":
            continue
        text = message_text(message.get("content"))
        if text in expected:
            selected.append(text)
    if tuple(selected) != expected:
        raise AssertionError(f"canonical Native SDK public inputs differ: expected={expected}, actual={selected}")
    return selected


def initialize_installed_native_profile(executable: Path, home: Path, cwd: Path,
                                         installations: list[dict[str, object]]) -> Path:
    """Create the shipped native-sdk profile with the installed runtime before adding user plugins."""
    env = {**os.environ, "DSH_HOME": str(home), "DSH_TELEMETRY_DISABLED": "1"}
    result = subprocess.run(
        [str(executable), "--profile", "native-sdk", "--dump-config"],
        cwd=cwd, env=env, capture_output=True, text=True, timeout=30, check=False,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"installed runtime failed to initialize its shipped native-sdk profile: "
            f"exit={result.returncode}\n{result.stdout}\n{result.stderr}"
        )
    profile = home / "profiles" / "native-sdk"
    config_path = profile / "rsh.profile.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    config["installations"].extend(installations)
    config_path.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return profile


def write_installed_profile_plugin(profile: Path, name: str, source: Path,
                                   requires: list[str], provides: list[str]) -> Path:
    """Install one fixture-owned Native plugin into the external profile directory."""
    package = profile / "node_modules" / name
    package.mkdir(parents=True)
    shutil.copyfile(source, package / "native.mjs")
    (package / "package.json").write_text(json.dumps({
        "name": name,
        "version": "0.0.0",
        "private": True,
        "type": "module",
        "exports": {"./package.json": "./package.json", "./native": "./native.mjs"},
        "dsh": {"native": {"apiVersion": 1, "entry": "./native", "targets": ["host"],
                             "requires": requires, "optional": [], "provides": provides}},
    }), encoding="utf-8")
    return package


def write_native_sdk_model_patch(path: Path, cwd: Path, sessions: Path, base_url: str,
                                 system_prompt: str, extra: list[dict[str, object]] | None = None,
                                 input_modalities: tuple[str, ...] = ("text",)) -> None:
    """Point one shipped Native SDK composition at the keyless model and its isolated Session store."""
    installations: list[dict[str, object]] = [
        {"id": "app", "config": {"systemPrompt": system_prompt, "maxSteps": 4}},
        {"id": "storage", "config": {"root": str(sessions), "compression": "none"}},
        {"id": "fs", "config": {"cwd": str(cwd)}},
        {"id": "pi-ai", "config": {"providers": {"fixture": {
            "apiKeyEnv": "NATIVE_SDK_FIXTURE_KEY",
            "api": "openai-completions",
            "baseURL": f"{base_url}/v1",
            "models": [{"id": "fixture-model", "input": list(input_modalities)}],
        }}}},
    ]
    installations.extend(extra or [])
    path.write_text(json.dumps({"formatVersion": 1, "installations": installations}, indent=2) + "\n",
                    encoding="utf-8")


def run_installed_native_turn(home: Path, cwd: Path, patch: Path, session_id: str, task: str,
                              executable: Path):
    """Run one Native SDK turn through the installed Python package's bundled executable."""
    from deepseek_harness import DeepSeekHarness

    with DeepSeekHarness(
        provider="fixture",
        model="fixture-model",
        cwd=str(cwd),
        dsh_home=str(home),
        profile="native-sdk",
        patches=(str(patch),),
        env={"NATIVE_SDK_FIXTURE_KEY": "fixture-key", "DSH_TELEMETRY_DISABLED": "1",
             "DSH_PERMISSION_MODE": "danger-full-access"},
        request_timeout_seconds=60,
    ) as harness:
        result = harness.start_session(session_id).run(task)
        process = harness.client._proc
        process_id = None if process is None else process.pid
        launch_args = None if process is None else process.args
    if process is None or process.poll() != 0:
        raise AssertionError(
            f"installed Native SDK runtime did not exit cleanly: "
            f"{None if process is None else process.returncode}\nstderr tail:\n"
            + "\n".join(harness.client._stderr_lines)
        )
    if not isinstance(launch_args, (list, tuple)) or not launch_args \
            or Path(str(launch_args[0])).resolve() != executable.resolve():
        raise AssertionError(f"installed SDK launched {launch_args!r}, expected bundled wheel runtime {executable}")
    return result, process_id


def native_notification_events(result: "RunResult", session_id: str,
                               event_types: set[str]) -> list[dict[str, object]]:
    """Project selected full Session events from one public Python SDK notification interval."""
    return [
        event for notification in result.notifications
        if notification.method == "session.event" and notification.payload.get("sessionId") == session_id
        and isinstance((event := notification.payload.get("event")), dict)
        and event.get("type") in event_types
    ]


def native_session_events(records: list[dict[str, object]], event_types: set[str]) -> list[dict[str, object]]:
    """Select full persisted Session events, retaining sequence, time, payload, and lineage fields."""
    return [event for event in records[1:] if event.get("type") in event_types]


def native_request_user_texts(request: dict[str, object]) -> list[str]:
    """Read actual user-message order from one installed runtime wire request."""
    messages = request.get("messages")
    if not isinstance(messages, list):
        raise AssertionError("installed Native SDK model request omitted messages")
    return [message_text(message.get("content")) for message in messages
            if isinstance(message, dict) and message.get("role") == "user"]


def native_staged_file_handle(request: dict[str, object], name: str) -> str:
    """Extract one file path from the installed runtime's actual model-visible input."""
    messages = request.get("messages")
    if not isinstance(messages, list):
        raise AssertionError("installed Native SDK model request omitted messages")
    pattern = re.compile(
        rf'\[File "{re.escape(name)}" \(\d+ bytes, sha256:[0-9a-f]{{8}}\): '
        r'verbatim read-only copy saved at "([^"]+)"\.'
    )
    for message in messages:
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        match = pattern.search(message_text(message.get("content")))
        if match is not None:
            return match.group(1)
    raise AssertionError(f"installed model input has no staged {name} path")


def native_staged_file_refs(records: list[dict[str, object]]) -> dict[str, tuple[str, int]]:
    """Read user FileBlock identities from one canonical or installed Session log."""
    files: dict[str, tuple[str, int]] = {}
    for event in records:
        data = event.get("data")
        if event.get("type") != "user/message" or not isinstance(data, dict):
            continue
        source = data.get("source")
        content = data.get("content")
        if not isinstance(source, dict) or source.get("kind") != "user" or not isinstance(content, list):
            continue
        for block in content:
            attachment = block.get("attachment") if isinstance(block, dict) and block.get("type") == "file" else None
            if not isinstance(attachment, dict):
                continue
            name = attachment.get("name")
            attachment_id = attachment.get("attachmentId")
            size = attachment.get("bytes")
            if not isinstance(name, str) or not isinstance(attachment_id, str) or not isinstance(size, int):
                raise AssertionError(f"installed Native SDK Session has an invalid FileBlock: {attachment}")
            value = (attachment_id, size)
            if name in files and files[name] != value:
                raise AssertionError(f"Native SDK Session reused {name} with a different attachment identity")
            files[name] = value
    return files


def native_staged_tool_event(records: list[dict[str, object]], call_id: str) -> dict[str, object]:
    """Return one durable Native builtin tool-result event by call id."""
    for event in records:
        data = event.get("data")
        if event.get("type") != "tool/result" or not isinstance(data, dict):
            continue
        message = data.get("message")
        source = message.get("source") if isinstance(message, dict) else None
        if isinstance(source, dict) and source.get("callId") == call_id:
            return data
    raise AssertionError(f"Native SDK Session log has no durable result for {call_id}")


def native_staged_tool_result(records: list[dict[str, object]], call_id: str) -> dict[str, object]:
    """Return the result block paired with one Native builtin tool call."""
    data = native_staged_tool_event(records, call_id)
    message = data.get("message")
    content = message.get("content") if isinstance(message, dict) else None
    result = next((block for block in content if isinstance(block, dict)
                   and block.get("type") == "tool-result" and block.get("toolCallId") == call_id), None)         if isinstance(content, list) else None
    if isinstance(result, dict):
        return result
    raise AssertionError(f"Native SDK Session log has no result block for {call_id}")

def smoke_sdk_native(base_url: str, executable: Path) -> None:
    """Replay canonical Native SDK references through installed wheels and cold processes."""
    external = read_native_sdk_reference("externalOperation")
    inbox = read_native_sdk_reference("inboxMoved")
    staged_files = read_native_sdk_reference("stagedFiles")
    smoke_sdk_native_external(base_url, executable, external)
    smoke_sdk_native_inbox(base_url, executable, inbox)
    smoke_sdk_native_staged_files(base_url, executable, staged_files)
    skills = read_native_sdk_reference("skills")
    smoke_sdk_native_skills(base_url, executable, skills)


def smoke_sdk_native_skills(base_url: str, executable: Path, reference: dict[str, object]) -> None:
    """Replay the canonical Skills Session through installed Python wheels and two runtime processes."""
    records = reference["records"]
    if not isinstance(records, list):
        raise AssertionError("Skills reference has no Session rows")
    session_id = str(reference["sessionId"])
    native_public_inputs(records, (NATIVE_SKILLS_FIRST_TASK, NATIVE_SKILLS_COLD_TASK))
    canonical_call = next((event.get("data") for event in records
                           if event.get("type") == "tool/call" and isinstance(event.get("data"), dict)
                           and event["data"].get("callId") == NATIVE_SKILLS_TOOL_CALL_ID), None)
    canonical_result = native_staged_tool_result(records, NATIVE_SKILLS_TOOL_CALL_ID)
    canonical_content = canonical_result.get("content")
    if not isinstance(canonical_call, dict) or canonical_call.get("name") != "skill" \
            or not isinstance(canonical_call.get("arguments"), str) \
            or json.loads(canonical_call["arguments"]) != {"name": "review"} \
            or not isinstance(canonical_content, list) or len(canonical_content) != 1 \
            or not isinstance(canonical_content[0], dict) or not isinstance(canonical_content[0].get("text"), str):
        raise AssertionError("Skills canonical reference omitted its review tool result")
    canonical_text = canonical_content[0]["text"]
    canonical_answers = [
        message_text(event["data"]["message"].get("content"))
        for event in records if event.get("type") == "assistant/message"
        and isinstance(event.get("data"), dict)
        and isinstance(event["data"].get("message"), dict)
        and any(isinstance(block, dict) and block.get("type") == "text"
                for block in event["data"]["message"].get("content", []))
    ]
    if canonical_answers != [NATIVE_SKILLS_TOOL_REPLY, NATIVE_SKILLS_COLD_REPLY]:
        raise AssertionError(f"Skills canonical reference has unexpected final responses: {canonical_answers}")

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-native-skills-") as temporary:
        root = Path(temporary).resolve()
        home, cwd = root / "home", root / "work"
        sessions = home / "sessions"
        cwd.mkdir(parents=True)
        skill_path = cwd / ".agents" / "skills" / "review" / "SKILL.md"
        skill_path.parent.mkdir(parents=True)
        skill_path.write_text(
            "---\nname: review\ndescription: Inspect changes and state concrete findings.\n---\n\n"
            f"{NATIVE_SKILLS_BODY}\n",
            encoding="utf-8",
        )
        initialize_installed_native_profile(executable, home, cwd, [
            {"id": "request-context", "plugin": "@deepseek-ai/dsh-request-context", "scope": "root"},
            {"id": "skills", "plugin": "@deepseek-ai/dsh-skill", "scope": "root"},
            {"id": "skill-filesystem", "plugin": "@deepseek-ai/dsh-skill-filesystem", "scope": "root",
             "config": {"agentsHome": str(home), "dshHome": str(home), "watch": False}},
            {"id": "tool-skill", "plugin": "@deepseek-ai/dsh-tool-skill", "scope": "root"},
        ])
        patch = root / "native.patch.json"
        write_native_sdk_model_patch(patch, cwd, sessions, base_url, "You are a Native Skills fixture.")

        offset = len(MockModelHandler.requests)
        first, first_process = run_installed_native_turn(home, cwd, patch, session_id,
                                                        NATIVE_SKILLS_FIRST_TASK, executable)
        recovery, recovery_process = run_installed_native_turn(home, cwd, patch, session_id,
                                                               NATIVE_SKILLS_COLD_TASK, executable)
        if first.final_response != canonical_answers[0] or recovery.final_response != canonical_answers[1] \
                or first.finish_reason != "completed" or recovery.finish_reason != "completed":
            raise AssertionError("installed Skills Native SDK turns differ from the canonical replies")
        if first_process is None or recovery_process is None or first_process == recovery_process:
            raise AssertionError(f"Skills cold recovery did not use independent runtime processes: {first_process}, {recovery_process}")

        requests = MockModelHandler.requests[offset:]
        if len(requests) != 3 or NATIVE_SKILLS_FIRST_TASK not in native_request_user_texts(requests[0]) \
                or NATIVE_SKILLS_COLD_TASK not in native_request_user_texts(requests[2]) \
                or any(NATIVE_SKILLS_BODY not in json.dumps(request.get("messages", [])) for request in requests):
            raise AssertionError(f"installed Skills model requests omitted prompts or Skill instructions: {len(requests)}")
        assert_advertised_tool(requests[0], "skill")
        expected_result_text = canonical_text.replace(
            "{{cwd}}/.agents/skills/review", str(cwd / ".agents" / "skills" / "review"))
        for request in requests[1:]:
            messages = request.get("messages")
            tool_messages = [message for message in messages if isinstance(message, dict)
                             and message.get("role") == "tool"
                             and message.get("tool_call_id") == NATIVE_SKILLS_TOOL_CALL_ID] \
                if isinstance(messages, list) else []
            if len(tool_messages) != 1 or tool_messages[0].get("content") != expected_result_text:
                raise AssertionError(
                    "installed Skills tool result was not sent to the model and restored after restart")
        first_calls = [event.get("data") for event in first.events if event.get("type") == "tool/call"
                       and isinstance(event.get("data"), dict)
                       and event["data"].get("callId") == NATIVE_SKILLS_TOOL_CALL_ID]
        if len(first_calls) != 1 or first_calls[0].get("name") != canonical_call.get("name") \
                or first_calls[0].get("arguments") != canonical_call.get("arguments"):
            raise AssertionError("installed Skills tool call differs from its canonical call")
        if any(event.get("type") == "tool/call" for event in recovery.events):
            raise AssertionError("cold Skills recovery repeated the original tool call")

        stored = read_session_logs(sessions).get(session_id)
        if stored is None:
            raise AssertionError("installed Skills Session was not cold-readable under its canonical id")
        installed_result = native_staged_tool_result(first.events, NATIVE_SKILLS_TOOL_CALL_ID)
        persisted_result = native_staged_tool_result(stored, NATIVE_SKILLS_TOOL_CALL_ID)
        expected_result = {
            **canonical_result,
            "content": [{
                **canonical_content[0],
                "text": expected_result_text,
            }],
        }
        if installed_result != expected_result or persisted_result != installed_result:
            raise AssertionError("installed Skills tool result differs from its canonical or persisted result")


def smoke_sdk_native_staged_files(base_url: str, executable: Path,
                                  reference: dict[str, object]) -> None:
    """Exercise staged-file receipts, builtin access, denial, and cold recovery in installed wheels."""
    from deepseek_harness import DeepSeekHarness

    global NATIVE_STAGED_FILES_GATE
    records = reference["records"]
    session_path = reference.get("sessionPath")
    if not isinstance(records, list) or not isinstance(session_path, Path):
        raise AssertionError("staged-files reference omitted its canonical Session")
    session_id = str(reference["sessionId"])
    expected_files = native_staged_file_refs(records)
    if set(expected_files) != {"first.txt", "second.txt"}:
        raise AssertionError(f"staged-files canonical reference has unexpected FileBlocks: {expected_files}")
    scene = session_path.parent
    first_bytes = (scene / "first.txt").read_bytes()
    second_bytes = (scene / "second.txt").read_bytes()
    image_bytes = (scene / "image.png").read_bytes()
    for name, data in (("first.txt", first_bytes), ("second.txt", second_bytes)):
        if expected_files[name] != (f"sha256:{hashlib.sha256(data).hexdigest()}", len(data)):
            raise AssertionError(f"staged-files canonical FileBlock differs from {name}")
    image_attachments = [
        block.get("attachment") for event in records if event.get("type") == "user/message"
        and isinstance(event.get("data"), dict)
        and isinstance(event["data"].get("source"), dict)
        and event["data"]["source"].get("kind") == "user"
        and isinstance(event["data"].get("content"), list)
        for block in event["data"]["content"]
        if isinstance(block, dict) and block.get("type") == "image"
    ]
    image_identity = f"sha256:{hashlib.sha256(image_bytes).hexdigest()}"
    if len(image_attachments) != 1 or not isinstance(image_attachments[0], dict) \
            or image_attachments[0].get("attachmentId") != image_identity \
            or image_attachments[0].get("mediaType") != "image/png" \
            or image_attachments[0].get("bytes") != len(image_bytes):
        raise AssertionError("staged-files canonical Session image differs from image.png")
    public_texts = [
        part["text"] for event in records if event.get("type") == "user/message"
        and isinstance(event.get("data"), dict)
        and isinstance(event["data"].get("source"), dict)
        and event["data"]["source"].get("kind") == "user"
        and isinstance(event["data"].get("content"), list)
        for part in event["data"]["content"]
        if isinstance(part, dict) and part.get("type") == "text" and isinstance(part.get("text"), str)
    ]
    prompts = (NATIVE_STAGED_FILES_FIRST_TASK, NATIVE_STAGED_FILES_SECOND_TASK,
               NATIVE_STAGED_FILES_COLD_TASK)
    if not all(prompt in public_texts for prompt in prompts):
        raise AssertionError(f"staged-files canonical Session omitted its public prompts: {public_texts}")
    canonical_paths: dict[str, str] = {}
    for event in native_session_events(records, {"tool/call"}):
        data = event.get("data")
        if not isinstance(data, dict) or data.get("name") != "read_file":
            continue
        arguments = data.get("arguments")
        call = json.loads(arguments) if isinstance(arguments, str) else {}
        path = call.get("path") if isinstance(call, dict) else None
        if isinstance(path, str) and path.startswith("{{home}}/"):
            canonical_paths[Path(path).name] = path
    if set(canonical_paths) != {"first.txt", "second.txt"}:
        raise AssertionError(f"staged-files canonical Session omitted its read handles: {canonical_paths}")

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-native-staged-files-") as temporary:
        root = Path(temporary).resolve()
        home, cwd = root / "home", root / "work"
        sessions = home / "sessions"
        cwd.mkdir(parents=True)
        initialize_installed_native_profile(executable, home, cwd, [])
        patch = root / "native.patch.json"
        write_native_sdk_model_patch(patch, cwd, sessions, base_url,
                                     "Verify installed Native SDK staged-file access.",
                                     input_modalities=("text", "image"))
        request_offset = len(MockModelHandler.requests)
        started, release = threading.Event(), threading.Event()
        NATIVE_STAGED_FILES_GATE = (started, release)
        try:
            with ThreadPoolExecutor(max_workers=1) as executor, DeepSeekHarness(
                provider="fixture", model="fixture-model", cwd=str(cwd), dsh_home=str(home),
                profile="native-sdk", patches=(str(patch),), allowed_tools=("read_file", "write_file"),
                workspace_write_root=str(cwd),
                env={"NATIVE_SDK_FIXTURE_KEY": "fixture-key", "DSH_TELEMETRY_DISABLED": "1",
                     "DSH_PERMISSION_MODE": "workspace-write"},
                request_timeout_seconds=90,
            ) as harness:
                try:
                    session = harness.start_session(session_id)
                    first_receipt = session.upload_file(first_bytes, "first.txt")
                    first_run = executor.submit(session.run, [
                        {"type": "text", "text": NATIVE_STAGED_FILES_FIRST_TASK},
                        {"type": "image", "data": base64.b64encode(image_bytes).decode("ascii"),
                         "mimeType": "image/png"},
                        {"type": "file", "receiptId": first_receipt.receipt_id},
                    ])
                    if not started.wait(timeout=60):
                        raise AssertionError("installed Native SDK made no model request for the staged first file")
                    second_receipt = session.upload_file(second_bytes, "second.txt")
                    if (first_receipt.name, first_receipt.bytes) != ("first.txt", len(first_bytes)) \
                            or (second_receipt.name, second_receipt.bytes) != ("second.txt", len(second_bytes)):
                        raise AssertionError("installed Native SDK upload receipts differ from the canonical files")
                    if not session.steer([
                        {"type": "text", "text": NATIVE_STAGED_FILES_SECOND_TASK},
                        {"type": "file", "receiptId": second_receipt.receipt_id},
                    ]):
                        raise AssertionError("installed Native SDK returned no durable staged-file steer id")
                    release.set()
                    first_result = first_run.result(timeout=90)
                    denied_result = session.run(NATIVE_STAGED_FILES_WRITE_TASK)
                    process = harness.client._proc
                    process_id = None if process is None else process.pid
                    launch_args = None if process is None else process.args
                finally:
                    release.set()
            if process is None or process.poll() != 0 or not isinstance(launch_args, (list, tuple)) \
                    or not launch_args or Path(str(launch_args[0])).resolve() != executable.resolve():
                raise AssertionError("installed staged-file SDK did not exit through the bundled runtime")
            if first_result.final_response != NATIVE_STAGED_FILES_FIRST_REPLY \
                    or denied_result.final_response != NATIVE_STAGED_FILES_WRITE_REPLY:
                raise AssertionError("installed staged-file prompt or write-denial turn did not complete")
        finally:
            NATIVE_STAGED_FILES_GATE = None

        cold_result, cold_process_id = run_installed_native_turn(
            home, cwd, patch, session_id, NATIVE_STAGED_FILES_COLD_TASK, executable,
        )
        if cold_result.final_response != NATIVE_STAGED_FILES_COLD_REPLY or process_id == cold_process_id:
            raise AssertionError("installed staged-file cold recovery did not use a new runtime process")
        requests = MockModelHandler.requests[request_offset:]

        def request_for(prompt: str) -> dict[str, object]:
            request = next((body for body in requests if native_request_user_texts(body)
                            and prompt in native_request_user_texts(body)[-1]), None)
            if request is None:
                raise AssertionError(f"installed staged-file model request omitted {prompt!r}")
            return request

        first_request = request_for(NATIVE_STAGED_FILES_FIRST_TASK)
        image_data_url = f"data:image/png;base64,{base64.b64encode(image_bytes).decode('ascii')}"
        if image_data_url not in json.dumps(first_request, ensure_ascii=False):
            raise AssertionError("installed Native SDK first request omitted the canonical image bytes")
        first_handle = native_staged_file_handle(first_request, "first.txt")
        second_handle = native_staged_file_handle(request_for(NATIVE_STAGED_FILES_SECOND_TASK), "second.txt")
        cold_handle = native_staged_file_handle(request_for(NATIVE_STAGED_FILES_COLD_TASK), "first.txt")
        write_handle = native_staged_file_handle(request_for(NATIVE_STAGED_FILES_WRITE_TASK), "first.txt")
        provider_root = (home / "attachments" / "v1" / "files").resolve()
        if any(not Path(handle).resolve().is_relative_to(provider_root)
               for handle in (first_handle, second_handle, cold_handle, write_handle)):
            raise AssertionError("installed model-visible file path escaped the selected AttachmentProvider")
        expected_first = Path(str(home) + canonical_paths["first.txt"][len("{{home}}"):]).resolve()
        expected_second = Path(str(home) + canonical_paths["second.txt"][len("{{home}}"):]).resolve()
        if Path(first_handle).resolve() != expected_first or Path(second_handle).resolve() != expected_second \
                or cold_handle != first_handle or write_handle != first_handle:
            raise AssertionError("installed model-visible file handles differ from the canonical Session")

        stored = read_session_logs(sessions).get(session_id)
        if stored is None or native_staged_file_refs(stored) != expected_files:
            raise AssertionError("installed Python SDK FileBlocks differ from the staged-files canonical reference")
        calls = {event["data"].get("callId"): event["data"]
                 for event in native_session_events(stored, {"tool/call"})
                 if isinstance(event.get("data"), dict)
                 and event["data"].get("callId", "").startswith("installed-native-staged-")}
        expected_calls = {
            "installed-native-staged-first-read": ("read_file", first_handle),
            "installed-native-staged-second-read": ("read_file", second_handle),
            "installed-native-staged-cold-read": ("read_file", first_handle),
            "installed-native-staged-write": ("write_file", first_handle),
        }
        if set(calls) != set(expected_calls):
            raise AssertionError(f"installed staged-file tool call set differs: {set(calls)}")
        for call_id, (name, handle) in expected_calls.items():
            call = calls[call_id]
            if call.get("name") != name or json.loads(str(call.get("arguments"))).get("path") != handle:
                raise AssertionError(f"installed tool call did not use its model-visible file handle: {call}")
        for call_id, expected_bytes in (
            ("installed-native-staged-first-read", first_bytes),
            ("installed-native-staged-second-read", second_bytes),
            ("installed-native-staged-cold-read", first_bytes),
        ):
            result = native_staged_tool_result(stored, call_id)
            if result.get("isError") is not False \
                    or message_text(result.get("content")) != expected_bytes.decode("utf-8"):
                raise AssertionError(f"installed read_file did not return exact uploaded bytes: {call_id}: {result}")
        denied = native_staged_tool_result(stored, "installed-native-staged-write")
        denial_event = native_staged_tool_event(stored, "installed-native-staged-write")
        error = denial_event.get("error")
        if denied.get("isError") is not True or not isinstance(error, dict) \
                or error.get("code") != "FS_SANDBOX_DENIED" \
                or "path outside workspace:" not in message_text(denied.get("content")) \
                or Path(first_handle).read_bytes() != first_bytes:
            raise AssertionError("installed Native builtin did not deny the outside-workspace staged-file write")

def smoke_sdk_native_external(base_url: str, executable: Path, reference: dict[str, object]) -> None:
    """Drive canonical external-operation facts through the installed Python SDK and runtime."""
    records = reference["records"]
    if not isinstance(records, list):
        raise AssertionError("external-operation reference has no Session rows")
    session_id = str(reference["sessionId"])
    expected_tasks = (NATIVE_EXTERNAL_OPERATION_PROMPT, NATIVE_EXTERNAL_OPERATION_COLD_PROMPT)
    native_public_inputs(records, expected_tasks)
    operation_script = [event["data"] for event in records
                        if event.get("type") == "subagent/external-operation" and isinstance(event.get("data"), dict)]
    if len(operation_script) != 9:
        raise AssertionError(f"external-operation reference has an incomplete operation script: {len(operation_script)}")
    call = next((event.get("data") for event in records
                 if event.get("type") == "tool/call" and isinstance(event.get("data"), dict)
                 and event["data"].get("name") == "subagent"), None)
    if not isinstance(call, dict):
        raise AssertionError("external-operation reference omitted its subagent call")
    result = next((event.get("data") for event in records
                   if event.get("type") == "tool/result" and isinstance(event.get("data"), dict)
                   and event["data"].get("message", {}).get("source", {}).get("callId") == call.get("callId")), None)
    message = result.get("message") if isinstance(result, dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    output = next((block.get("content") for block in content if isinstance(block, dict)
                   and block.get("type") == "tool-result" and block.get("toolCallId") == call.get("callId")), None) \
        if isinstance(content, list) else None
    if not isinstance(output, list):
        raise AssertionError("external-operation reference omitted the recorded child output")

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-native-external-") as temporary:
        root = Path(temporary).resolve()
        home, cwd = root / "home", root / "work"
        sessions = home / "sessions"
        cwd.mkdir(parents=True)
        driver_config = {"operationScript": operation_script, "childOutput": output}
        profile = initialize_installed_native_profile(executable, home, cwd, [
            {"id": "external-driver", "plugin": "native-sdk-installed-external-driver", "scope": "root",
             "config": driver_config},
            {"id": "policy", "plugin": "@deepseek-ai/dsh-fs-observation-policy", "scope": "root"},
            {"id": "file-tools", "plugin": "@deepseek-ai/dsh-tool-fs", "scope": "root"},
        ])
        write_installed_profile_plugin(profile, "native-sdk-installed-external-driver",
                                       NATIVE_SDK_EXTERNAL_DRIVER, [], ["externalSubagentDriver"])
        shutil.copyfile(NATIVE_SDK_EXTERNAL_PATHS, profile / "node_modules" / "native-sdk-installed-external-driver"
                        / "workspace-paths.mjs")
        patch = root / "native.patch.json"
        write_native_sdk_model_patch(patch, cwd, sessions, base_url,
            "Delegate one file creation to the external child.", [
                {"id": "subagents", "config": {"providerName": "external-fixture"}},
                {"id": "workflow-worker", "config": {"subagentProvider": "external-fixture"}},
                {"id": "subagent-tool", "config": {"toolName": "subagent", "maxDepth": 1}},
                {"id": "ralph-tool", "disabled": True},
            ])

        offset = len(MockModelHandler.requests)
        first, first_process = run_installed_native_turn(home, cwd, patch, session_id, expected_tasks[0], executable)
        recovery, recovery_process = run_installed_native_turn(home, cwd, patch, session_id, expected_tasks[1], executable)
        if first.final_response != NATIVE_EXTERNAL_OPERATION_TEXT or first.finish_reason != "completed":
            raise AssertionError(f"installed external-operation first turn differed: {first.final_response!r} {first.finish_reason!r}")
        if recovery.final_response != "cold SDK Session restored" or recovery.finish_reason != "completed":
            raise AssertionError(f"installed external-operation cold turn differed: {recovery.final_response!r} {recovery.finish_reason!r}")
        if first_process is None or recovery_process is None or first_process == recovery_process:
            raise AssertionError(f"external-operation did not use independent runtime processes: {first_process}, {recovery_process}")

        requests = MockModelHandler.requests[offset:]
        if len(requests) != 3 or NATIVE_EXTERNAL_OPERATION_PROMPT not in native_request_user_texts(requests[0]) \
                or NATIVE_EXTERNAL_OPERATION_COLD_PROMPT not in native_request_user_texts(requests[2]):
            raise AssertionError(f"installed external-operation model requests differ: {len(requests)}")
        expected_kinds = [event["kind"] for event in operation_script]
        first_operations = [event for event in first.events if event.get("type") == "subagent/external-operation"]
        recovery_operations = [event for event in recovery.events if event.get("type") == "subagent/external-operation"]
        if [event.get("data", {}).get("kind") for event in first_operations] != expected_kinds or recovery_operations:
            raise AssertionError("installed external-operation SDK events differ from canonical operations or repeated after cold restore")
        event_types = {"subagent/external-operation"}
        if native_notification_events(first, session_id, event_types) != first_operations \
                or native_notification_events(recovery, session_id, event_types) != []:
            raise AssertionError("installed external-operation notifications differ from SDK events or replayed after cold restore")
        stored = read_session_logs(sessions).get(session_id)
        if stored is None or native_session_events(stored, event_types) != first_operations:
            raise AssertionError("installed external-operation durable facts differ from the Python SDK event interval")
        assert_session_log(sessions, cwd, NATIVE_EXTERNAL_OPERATION_TEXT, "cold SDK Session restored")
        expected_workspace = (NATIVE_SDK_EXTERNAL_WORKSPACE / "created.txt").read_bytes()
        actual_workspace = (cwd / "created.txt").read_bytes()
        if actual_workspace != expected_workspace:
            raise AssertionError("installed external-operation wrote bytes that differ from its canonical workspace oracle")


def smoke_sdk_native_inbox(base_url: str, executable: Path, reference: dict[str, object]) -> None:
    """Drive the canonical Inbox owner through the installed Python SDK and a second cold process."""
    records = reference["records"]
    owner_path = reference.get("ownerPath")
    if not isinstance(records, list) or not isinstance(owner_path, Path):
        raise AssertionError("Inbox reference omitted its Session or Native owner source")
    session_id = str(reference["sessionId"])
    expected_tasks = (NATIVE_INBOX_FIRST_TASK, NATIVE_INBOX_COLD_TASK)
    native_public_inputs(records, expected_tasks)
    facts_types = {"agent/inbox/spliced", "agent/inbox/moved"}
    canonical_facts = native_session_events(records, facts_types)
    canonical_moves = [event for event in canonical_facts if event.get("type") == "agent/inbox/moved"]
    canonical_edits = [event for event in canonical_facts
                       if event.get("type") == "agent/inbox/spliced"
                       and event.get("data", {}).get("outcome") == "canceled"]
    canonical_inserted = canonical_edits[0].get("data", {}).get("inserted") if len(canonical_edits) == 1 else None
    if len(canonical_moves) != 1 or len(canonical_edits) != 1 or not isinstance(canonical_inserted, list) \
            or len(canonical_inserted) != 1:
        raise AssertionError("Inbox canonical reference must own one text edit and one move")
    canonical_target = canonical_inserted[0]
    canonical_edit_data = canonical_edits[0]["data"]
    canonical_move_data = canonical_moves[0].get("data")
    canonical_source = canonical_target.get("source") if isinstance(canonical_target, dict) else None
    if not isinstance(canonical_target, dict) or not isinstance(canonical_move_data, dict) \
            or not isinstance(canonical_edit_data, dict) or not isinstance(canonical_source, dict) \
            or canonical_move_data.get("messageId") != canonical_target.get("id") \
            or canonical_edit_data.get("target") != "next-turn" \
            or not isinstance(canonical_edit_data.get("start"), int) \
            or canonical_edit_data.get("removedCount") != 1 \
            or canonical_source.get("kind") != "user" \
            or canonical_target.get("content") != [{"type": "text", "text": "edited target text"}]:
        raise AssertionError("Inbox canonical reference does not describe the same edited message moving to next-step")
    canonical_edit_start = canonical_edit_data.get("start")
    with tempfile.TemporaryDirectory(prefix="dsh-sdk-native-inbox-") as temporary:
        root = Path(temporary).resolve()
        home, cwd = root / "home", root / "work"
        sessions = home / "sessions"
        cwd.mkdir(parents=True)
        owner_state = home / "inbox-owner-state.json"
        profile = initialize_installed_native_profile(executable, home, cwd, [
            {"id": "inbox-owner-fixture", "plugin": "native-sdk-inbox-owner", "scope": "root",
             "config": {"sessionId": session_id, "statePath": str(owner_state)}},
        ])
        write_installed_profile_plugin(profile, "native-sdk-inbox-owner", owner_path,
                                       ["activeSessions"], [])
        patch = root / "native.patch.json"
        write_native_sdk_model_patch(patch, cwd, sessions, base_url, "Verify Native SDK Inbox projection.")

        offset = len(MockModelHandler.requests)
        first, first_process = run_installed_native_turn(home, cwd, patch, session_id, expected_tasks[0], executable)
        recovery, recovery_process = run_installed_native_turn(home, cwd, patch, session_id, expected_tasks[1], executable)
        if first.final_response != NATIVE_INBOX_FIRST_REPLY or recovery.final_response != NATIVE_INBOX_COLD_REPLY \
                or first.finish_reason != "completed" or recovery.finish_reason != "completed":
            raise AssertionError("installed Inbox Native SDK turns did not complete with their recorded replies")
        if first_process is None or recovery_process is None or first_process == recovery_process:
            raise AssertionError(f"Inbox did not use independent runtime processes: {first_process}, {recovery_process}")

        requests = MockModelHandler.requests[offset:]
        if len(requests) != 2:
            raise AssertionError(f"installed Inbox case expected two model requests, got {len(requests)}")
        first_wire = native_request_user_texts(requests[0])
        cold_wire = native_request_user_texts(requests[1])
        if first_wire != ["keep next-step before", "edited target text", expected_tasks[0]]:
            raise AssertionError(f"installed Inbox first request lost steering-before-queued order: {first_wire}")
        if cold_wire.count(expected_tasks[1]) != 1 or cold_wire.count("edited target text") != 1 \
                or "original target text" in cold_wire:
            raise AssertionError(f"installed Inbox cold model input changed restored content: {cold_wire}")

        state = json.loads(owner_state.read_text(encoding="utf-8"))
        if state.get("first", {}).get("edited") != {"kind": "updated"} \
                or state.get("first", {}).get("promoted") != {"kind": "promoted"} \
                or state.get("recovery", {}).get("moveCount") != 1:
            raise AssertionError(f"installed Inbox owner did not record a separate cold-state observation: {state}")
        first_facts = [event for event in first.events if event.get("type") in facts_types]
        recovery_facts = [event for event in recovery.events if event.get("type") in facts_types]
        first_moved = [event for event in first_facts if event.get("type") == "agent/inbox/moved"]
        if len(first_moved) != 1 or recovery_facts and any(event.get("type") == "agent/inbox/moved" for event in recovery_facts):
            raise AssertionError("installed Inbox did not emit exactly one move before cold recovery")
        moved_message_id = first_moved[0].get("data", {}).get("messageId")
        recovery_state = state["recovery"]
        if not isinstance(recovery_state.get("nextTurn"), list) or not isinstance(recovery_state.get("nextStep"), list) \
                or any(isinstance(message, dict) and message.get("id") == moved_message_id
                       for message in [*recovery_state["nextTurn"], *recovery_state["nextStep"]]):
            raise AssertionError(f"installed Inbox cold observation retained the moved message in a pending queue: {state}")
        edit = next((event for event in first_facts if event.get("type") == "agent/inbox/spliced"
                     and event.get("data", {}).get("outcome") == "canceled"
                     and any(message.get("content") == [{"type": "text", "text": "edited target text"}]
                             for message in event.get("data", {}).get("inserted", []))), None)
        if edit is None or edit.get("data", {}).get("target") != "next-turn" \
                or edit.get("data", {}).get("start") != canonical_edit_start \
                or edit.get("data", {}).get("removedCount") != 1 \
                or moved_message_id != edit["data"]["inserted"][0].get("id"):
            raise AssertionError("installed Inbox edit and move did not retain one message identity")
        if native_notification_events(first, session_id, facts_types) != first_facts \
                or native_notification_events(recovery, session_id, facts_types) != recovery_facts:
            raise AssertionError("installed Inbox public notifications differ from Python SDK event intervals")
        stored = read_session_logs(sessions).get(session_id)
        projected = [*first_facts, *recovery_facts]
        sequences = [event.get("seq") for event in projected]
        if any(not isinstance(sequence, int) for sequence in sequences) \
                or sequences != sorted(sequences) or len(set(sequences)) != len(sequences):
            raise AssertionError(f"installed Inbox SDK event intervals are not in durable sequence order: {sequences}")
        if stored is None or native_session_events(stored, facts_types) != projected:
            raise AssertionError("installed Inbox durable facts differ from the Python SDK event intervals")
        edited_messages = [event for event in stored if event.get("type") == "user/message"
                           and event.get("data", {}).get("id") == edit["data"]["inserted"][0].get("id")]
        if len(edited_messages) != 1 or edited_messages[0].get("data", {}).get("content") \
                != [{"type": "text", "text": "edited target text"}]:
            raise AssertionError("installed Inbox durable model input lost the edited target identity or text")
        assert_session_log(sessions, cwd, NATIVE_INBOX_FIRST_REPLY, NATIVE_INBOX_COLD_REPLY)


def smoke_sdk_custom(base_url: str, executable: Path) -> None:
    from deepseek_harness import DeepSeekHarness

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-custom-") as temporary:
        root = Path(temporary).resolve()
        dsh_home = root / "home"
        sessions = dsh_home / "sessions"
        patch = write_advanced_profile_patch(root, "custom.patch.yml", sessions)
        with DeepSeekHarness(
            provider="deepseek-official",
            model="smoke-model",
            cwd=str(root),
            dsh_bin=str(executable),
            dsh_home=str(dsh_home),
            patches=(str(patch),),
            env={
                "DSH_PERMISSION_MODE": "danger-full-access",
                "DSH_TELEMETRY_DISABLED": "1",
            },
            api_key="sk-keyless-smoke",
            base_url=base_url,
            request_timeout_seconds=60,
        ) as harness:
            text_result = harness.run("reply with the smoke text", session_id="custom-smoke")
            assert text_result.final_response == EXPECTED_TEXT, text_result.final_response
            code_result = harness.run(CODE_PROMPT, session_id="custom-smoke")
            assert code_result.final_response == CODE_WORKER_TEXT, (
                "custom SDK code-worker response mismatch: " + sdk_run_diagnostic(code_result)
            )
            workflow_result = harness.run(WORKFLOW_PROMPT, session_id="custom-smoke")
            assert workflow_result.final_response == WORKFLOW_WORKER_TEXT, workflow_result.final_response
        assert_session_log(sessions, root, EXPECTED_TEXT, CODE_WORKER_TEXT, WORKFLOW_WORKER_TEXT)


def sdk_run_diagnostic(result: "RunResult") -> str:
    """Summarize a failed smoke turn without logging model-provided arguments or content."""
    def safe_text(value: object) -> str | None:
        if not isinstance(value, str):
            return None
        text = value
        for fixture_input in (CODE_PROMPT, "return 6 * 7", "Compute the smoke value"):
            text = text.replace(fixture_input, "<smoke input>")
        text = re.split(r"\nCaptured output:\n", text, maxsplit=1)[0]
        text = re.sub(
            r"(?i)(Bearer\s+|(?:api[_ -]?key|authorization|token|secret|password)\s*[:=]\s*)\S+",
            r"\1<redacted>",
            text,
        )
        text = re.sub(r"(?i)\bsk-[a-z0-9_-]+\b", "<redacted>", text)
        return text[:1000]

    def failure(value: object) -> dict[str, object] | None:
        if not isinstance(value, dict):
            return None
        detail = {key: value[key] for key in ("name", "code", "status")
                  if isinstance(value.get(key), (str, int))}
        message = safe_text(value.get("message"))
        if message is not None:
            detail["message"] = message
        return detail

    calls: list[dict[str, object]] = []
    results: list[dict[str, object]] = []
    attempts: list[dict[str, object]] = []
    endings: list[dict[str, object]] = []
    for event in result.events:
        kind = event.get("type")
        data = event.get("data")
        if not isinstance(data, dict):
            continue
        if kind == "tool/call":
            calls.append({"seq": event.get("seq"), "call_id": data.get("callId"), "name": data.get("name")})
        elif kind == "assistant/attempt":
            stream = data.get("stream")
            for record in stream if isinstance(stream, list) else []:
                chunk = record.get("chunk") if isinstance(record, dict) else None
                reason = chunk.get("reason") if isinstance(chunk, dict) and chunk.get("type") == "finish" else None
                if isinstance(reason, dict):
                    item = {"seq": event.get("seq"), "kind": reason.get("kind")}
                    detail = failure(reason.get("failure"))
                    if detail is not None:
                        item["failure"] = detail
                    attempts.append(item)
        elif kind == "tool/result":
            message = data.get("message")
            blocks = message.get("content") if isinstance(message, dict) else None
            block = next((part for part in blocks if isinstance(part, dict)
                          and part.get("type") == "tool-result"), None) if isinstance(blocks, list) else None
            is_error = block.get("isError") if isinstance(block, dict) else None
            item: dict[str, object] = {"seq": event.get("seq"), "is_error": is_error}
            identity = failure(data.get("error"))
            if identity is not None:
                item["error"] = identity
            content = block.get("content") if isinstance(block, dict) else None
            if is_error is True and isinstance(content, list):
                detail = "\n".join(
                    text for part in content
                    if isinstance(part, dict) and part.get("type") == "text"
                    and (text := safe_text(part.get("text"))) is not None
                )
                if detail:
                    item["detail"] = detail[:1000]
            results.append(item)
        elif kind == "turn/end":
            reason = data.get("reason")
            if isinstance(reason, dict):
                item = {"seq": event.get("seq"), "kind": reason.get("kind")}
                detail = failure(reason.get("error"))
                if detail is not None:
                    item["error"] = detail
                endings.append(item)
    summary = {
        "final_response": (
            None if (response := safe_text(result.final_response)) is None else repr(response)
        ),
        "finish_reason": result.finish_reason,
        "events": [{"seq": event.get("seq"), "type": event.get("type")} for event in result.events],
        "tool_calls": calls,
        "tool_results": results,
        "assistant_attempts": attempts,
        "turn_endings": endings,
    }
    return json.dumps(summary, ensure_ascii=False, separators=(",", ":"))


def smoke_sdk_minimal(
    base_url: str, executable: Path, update_snapshots: bool, *, in_history: bool = False,
) -> None:
    """Exercise the shipped standalone minimal profile through the packaged executable."""
    from deepseek_harness import DeepSeekHarness

    # One mock model serves every scenario of a run, so the snapshot takes this turn's slice.
    first_request = len(MockModelHandler.requests)
    with tempfile.TemporaryDirectory(prefix="dsh-sdk-minimal-") as temporary:
        root = Path(temporary).resolve()
        dsh_home = root / "home"
        sessions = dsh_home / "sessions"
        patches = ()
        if in_history:
            patch = root / "in-history.patch.yml"
            patch.write_text(json.dumps([
                {"id": "llm-deepseek", "config": {"models": [
                    {"id": "smoke-model", "systemPromptUpdate": "in-history"},
                ]}},
                {"insert": [{
                    "id": "in-history-prompt",
                    "name": (Path(__file__).resolve().parent / "fixtures/python-sdk-in-history-prompt.mjs").as_uri(),
                }]},
            ]))
            patches = (str(patch),)
        with DeepSeekHarness(
            provider="deepseek-official",
            model="smoke-model",
            cwd=str(root),
            dsh_bin=str(executable),
            dsh_home=str(dsh_home),
            profile="sdk-minimal",
            patches=patches,
            api_key="sk-keyless-smoke",
            base_url=base_url,
            request_timeout_seconds=60,
        ) as harness:
            result = harness.run(MINIMAL_PROMPT, session_id="minimal-agent-smoke")

        event_text = json.dumps(result.events)
        if MINIMAL_TEXT not in event_text:
            raise AssertionError(f"minimal agent run emitted no final response: {result.events}")
        assert_session_log(sessions, root, MINIMAL_TEXT, "COUNT=1", "COUNT=2")

        requests = MockModelHandler.requests[first_request:]
        if in_history:
            logs = read_session_logs(sessions)
            files = build_in_history_snapshot_files(result, requests, logs[result.session_id])
            compare_snapshot_files(
                files, update_snapshots, IN_HISTORY_SNAPSHOT_DIRECTORY, IN_HISTORY_SNAPSHOT_FILENAMES,
            )
        else:
            files = build_minimal_snapshot_files(requests, root)
            compare_snapshot_files(
                files, update_snapshots, MINIMAL_SNAPSHOT_DIRECTORY, MINIMAL_SNAPSHOT_FILENAMES,
            )


def smoke_sdk_fs_search(base_url: str, executable: Path) -> None:
    """Exercise real grep and glob spawns through the packaged executable."""
    from deepseek_harness import DeepSeekHarness

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-fs-search-") as temporary:
        root = Path(temporary).resolve()
        (root / "needle.txt").write_text(f"{FS_SEARCH_MARKER}\n")
        dsh_home = root / "home"
        sessions = dsh_home / "sessions"
        patch = write_profile_patch(root, "fs-search.patch.yml", sessions, [
            {"id": "skill-filesystem", "disabled": True},
            {"id": "tool-fs-search", "config": {"sampleOverCapGlobResults": False}},
        ])
        with DeepSeekHarness(
            provider="deepseek-official",
            model="smoke-model",
            cwd=str(root),
            dsh_bin=str(executable),
            dsh_home=str(dsh_home),
            patches=(str(patch),),
            env={
                "DSH_PERMISSION_MODE": "danger-full-access",
                "DSH_TELEMETRY_DISABLED": "1",
            },
            api_key="sk-keyless-smoke",
            base_url=base_url,
            request_timeout_seconds=60,
        ) as harness:
            result = harness.run(FS_SEARCH_PROMPT, session_id="fs-search-smoke")

        assert result.final_response == FS_SEARCH_TEXT, result.final_response
        assert_session_log(sessions, root, FS_SEARCH_TEXT, FS_SEARCH_MARKER, "needle.txt")


def smoke_sdk_spawn_node(base_url: str, executable: Path) -> None:
    """A shell command starting with `node` must reach the machine's Node, not the executable."""
    from deepseek_harness import DeepSeekHarness

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-spawn-node-") as temporary:
        root = Path(temporary).resolve()
        dsh_home = root / "home"
        sessions = dsh_home / "sessions"
        patch = write_profile_patch(root, "spawn-node.patch.yml", sessions, [])
        with DeepSeekHarness(
            provider="deepseek-official",
            model="smoke-model",
            cwd=str(root),
            dsh_bin=str(executable),
            dsh_home=str(dsh_home),
            patches=(str(patch),),
            env={
                "DSH_PERMISSION_MODE": "danger-full-access",
                "DSH_TELEMETRY_DISABLED": "1",
            },
            api_key="sk-keyless-smoke",
            base_url=base_url,
            request_timeout_seconds=60,
        ) as harness:
            result = harness.run(SPAWN_NODE_PROMPT, session_id="spawn-node-smoke")

        assert result.final_response == SPAWN_NODE_TEXT, result.final_response
        assert_session_log(sessions, root, SPAWN_NODE_TEXT, "PKG_EXECPATH=ABSENT")


def smoke_sdk_mcp(base_url: str, executable: Path | None) -> None:
    """Discover and call an external stdio MCP tool through the packaged client."""
    from deepseek_harness import DeepSeekHarness

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-mcp-") as temporary:
        root = Path(temporary).resolve()
        dsh_home = root / "home"
        sessions = dsh_home / "sessions"
        server_script = root / "mcp_server.py"
        server_script.write_text(MCP_SERVER_SCRIPT)
        patch = write_mcp_patch(root, sessions, server_script)
        discovery_log = server_script.with_suffix(".log")
        with DeepSeekHarness(
            provider="deepseek-official",
            model="smoke-model",
            cwd=str(root),
            dsh_bin=None if executable is None else str(executable),
            dsh_home=str(dsh_home),
            patches=(str(patch),),
            env={
                "DSH_PERMISSION_MODE": "danger-full-access",
                "DSH_TELEMETRY_DISABLED": "1",
            },
            api_key="sk-keyless-smoke",
            base_url=base_url,
            request_timeout_seconds=60,
        ) as harness:
            result = harness.run(MCP_PROMPT, session_id="mcp-smoke")

        assert result.final_response == MCP_TEXT, result.final_response
        assert discovery_log.read_text().splitlines() == [
            "initialize",
            "notifications/initialized",
            "tools/list",
            "tools/call",
        ]
        assert_session_log(sessions, root, MCP_TEXT, "mcp__fixture__add", "42")


def smoke_sdk_profile_plugin(base_url: str) -> None:
    """Install an external bundle through Python's dsh command and load it in the SDK."""
    from deepseek_harness import DeepSeekHarness

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-profile-plugin-") as temporary:
        root = Path(temporary).resolve()
        dsh_home = root / "home"
        plugin = root / "plugin"
        plugin.mkdir()
        (plugin / "package.json").write_text(json.dumps({
            "name": "dsh-python-blackbox-plugin",
            "version": "1.0.0",
            "private": True,
            "type": "module",
            "exports": "./index.js",
            "peerDependencies": {"@deepseek-ai/cordis": "*"},
            "dsh": {"bundle": {"patch": "./cordis.patch.yml"}},
        }, indent=2))
        (plugin / "index.js").write_text(
            "import { Context } from '@deepseek-ai/cordis'\n"
            "export const name = 'python-sdk-blackbox-plugin'\n"
            "export const inject = ['systemPrompt']\n"
            "export function apply(ctx) {\n"
            "  if (!(ctx instanceof Context)) throw new Error('external plugin loaded a second Cordis instance')\n"
            "  ctx.effect(() => ctx.systemPrompt.section({\n"
            "    name: 'python-sdk:blackbox-plugin',\n"
            "    order: 10,\n"
            f"    text: '{PROFILE_PLUGIN_MARKER}',\n"
            "  }))\n"
            "}\n"
        )
        (plugin / "cordis.patch.yml").write_text(json.dumps([{
            "insert": [{"id": "python-sdk-blackbox-plugin", "name": "dsh-python-blackbox-plugin"}],
        }], indent=2))

        dsh = Path(sysconfig.get_path("scripts")) / ("dsh.exe" if IS_WINDOWS else "dsh")
        environment = {**os.environ, "DSH_HOME": str(dsh_home)}
        installed = subprocess.run(
            [str(dsh), "plugin", "--profile", "sdk", "add", f"file:{plugin}"],
            cwd=root,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )
        if installed.returncode != 0:
            raise AssertionError(
                f"Python-installed dsh could not add the external profile plugin: "
                f"returncode={installed.returncode} (0x{installed.returncode & 0xffffffff:08x}) "
                f"stdout={installed.stdout!r} stderr={installed.stderr!r}"
            )
        manifest = json.loads((dsh_home / "profiles" / "sdk" / "package.json").read_text())
        if "dsh-python-blackbox-plugin" not in manifest.get("dependencies", {}):
            raise AssertionError(f"dsh plugin did not record the external dependency: {manifest}")
        if "dsh-python-blackbox-plugin" not in manifest["dsh"]["profile"]["bundles"]:
            raise AssertionError(f"dsh plugin did not activate the external bundle: {manifest}")

        harness = DeepSeekHarness(
            provider="deepseek-official",
            model="smoke-model",
            cwd=str(root),
            dsh_home=str(dsh_home),
            env={
                "DSH_PERMISSION_MODE": "danger-full-access",
                "DSH_TELEMETRY_DISABLED": "1",
            },
            api_key="sk-keyless-smoke",
            base_url=base_url,
            request_timeout_seconds=60,
        )
        try:
            with harness:
                result = harness.run(PROFILE_PLUGIN_PROMPT, session_id="profile-plugin-smoke")
        except Exception as error:
            raise AssertionError(
                f"external profile plugin runtime failed: {harness.client._runtime_diagnostics()}"
            ) from error

        assert result.final_response == PROFILE_PLUGIN_TEXT, result.final_response
        assert_zstd_session_log(dsh_home / "sessions")


def smoke_sdk_snapshot(base_url: str, executable: Path, update_snapshots: bool) -> None:
    """Drive and compare the advanced SDK/executable behavioral snapshot."""
    from deepseek_harness import DeepSeekHarness

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-snapshot-") as temporary:
        root = Path(temporary).resolve()
        dsh_home = root / "home"
        sessions = dsh_home / "sessions"
        patch = write_advanced_profile_patch(root, "snapshot.patch.yml", sessions)
        feedback_patch = write_profile_patch(root, "feedback.patch.yml", sessions, [{"insert": [
            {"id": "snapshot-workflow-order", "name": (
                Path(__file__).resolve().parent / "fixtures/python-snapshot-workflow-order.mjs"
            ).as_uri(), "config": {
                "parentSessionId": SNAPSHOT_SESSION_ID, "prompt": SNAPSHOT_WORKFLOW_CHILD_PROMPT,
            }},
            {"id": "snapshot-message-feedback", "name": "@deepseek-ai/dsh-message-feedback",
             "config": {"maxNoteBytes": 1024}},
            {"id": "snapshot-feedback-producer", "name": (
                Path(__file__).resolve().parents[2] / "snapshots/sdk/text-turn/feedback-producer.mjs"
            ).as_uri()},
        ]}])
        with DeepSeekHarness(
            provider="deepseek-official",
            model="smoke-model",
            cwd=str(root),
            dsh_bin=str(executable),
            dsh_home=str(dsh_home),
            patches=(str(patch), str(feedback_patch)),
            env={
                "DSH_PERMISSION_MODE": "danger-full-access",
                "DSH_TELEMETRY_DISABLED": "1",
            },
            api_key="sk-keyless-smoke",
            base_url=base_url,
            request_timeout_seconds=60,
        ) as harness:
            result = harness.run(SNAPSHOT_PROMPT, session_id=SNAPSHOT_SESSION_ID)

        assert result.final_response == SNAPSHOT_FINAL_TEXT, result.final_response
        feedback_types = [event.get("type") for event in result.events
                          if str(event.get("type")).startswith("feedback/")]
        if feedback_types != ["feedback/record", "feedback/record", "feedback/message-put", "feedback/message-put", "feedback/message-delete"]:
            raise AssertionError(f"advanced snapshot did not exercise all feedback mutations: {feedback_types}")
        methods = [notification.method for notification in result.notifications]
        if methods.count("subagent.started") != 2 or methods.count("subagent.finished") != 2:
            raise AssertionError(f"advanced snapshot emitted unexpected subagent lifecycle: {methods}")
        ptc_events = [event for event in result.events
                      if event.get("type") in ("tool/ptc-dispatch-start", "tool/ptc-dispatch")]
        if [event["type"] for event in ptc_events] != ["tool/ptc-dispatch-start", "tool/ptc-dispatch"]:
            raise AssertionError(f"advanced snapshot emitted unexpected PTC dispatch events: {ptc_events}")
        for event in ptc_events:
            data = event["data"]
            identity = (data.get("rootCallId"), data.get("parentCallId"), data.get("subCallId"))
            if identity != ("advanced-code", "advanced-code", "advanced-code:ptc:1"):
                raise AssertionError(f"advanced snapshot emitted unexpected PTC dispatch identity: {identity}")

        logs = read_session_logs(sessions)
        child_ids = snapshot_child_ids(result)
        expected_ids = {SNAPSHOT_SESSION_ID, *child_ids}
        if set(logs) != expected_ids:
            raise AssertionError(f"advanced snapshot expected parent plus two child logs: {sorted(logs)}")
        if "DIRECT_CHILD_OK" not in render_jsonl(logs[child_ids[0]]):
            raise AssertionError("first advanced child log has no direct-subagent result")
        if "WORKFLOW_CHILD_OK" not in render_jsonl(logs[child_ids[1]]):
            raise AssertionError("second advanced child log has no workflow-subagent result")

        files = build_snapshot_files(result, logs, child_ids, root)
        compare_snapshot_files(
            files, update_snapshots, ADVANCED_SNAPSHOT_DIRECTORY, ADVANCED_SNAPSHOT_FILENAMES,
        )


def smoke_sdk_restart_snapshot(base_url: str, executable: Path, update_snapshots: bool) -> None:
    """Snapshot two isolated sessions across complete SDK runtime restarts."""
    from deepseek_harness import DeepSeekHarness

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-restart-") as temporary:
        root = Path(temporary).resolve()
        dsh_home = root / "home"
        sessions = dsh_home / "sessions"
        patch = write_advanced_profile_patch(root, "restart.patch.yml", sessions)
        first_request = len(MockModelHandler.requests)

        def run(prompt: str, session_id: str) -> "RunResult":
            with DeepSeekHarness(
                provider="deepseek-official",
                model="smoke-model",
                cwd=str(root),
                dsh_bin=str(executable),
                dsh_home=str(dsh_home),
                patches=(str(patch),),
                env={
                    "DSH_PERMISSION_MODE": "danger-full-access",
                    "DSH_TELEMETRY_DISABLED": "1",
                },
                api_key="sk-keyless-smoke",
                base_url=base_url,
                request_timeout_seconds=60,
            ) as harness:
                return harness.run(prompt, session_id=session_id)

        first = run(RESTART_FIRST_PROMPT, RESTART_FIRST_SESSION_ID)
        second = run(RESTART_SECOND_PROMPT, RESTART_SECOND_SESSION_ID)
        requests = MockModelHandler.requests[first_request:]
        if len(requests) != 2:
            raise AssertionError(f"restart snapshot expected two model requests: {requests}")
        if first.final_response != RESTART_FIRST_TEXT or second.final_response != RESTART_SECOND_TEXT:
            raise AssertionError(
                f"restart snapshot responses differ: {first.final_response!r}, {second.final_response!r}"
            )

        logs = read_session_logs(sessions)
        expected_ids = {RESTART_FIRST_SESSION_ID, RESTART_SECOND_SESSION_ID}
        if set(logs) != expected_ids:
            raise AssertionError(f"restart snapshot expected two durable sessions: {sorted(logs)}")
        for session_id, expected in (
            (RESTART_FIRST_SESSION_ID, RESTART_FIRST_TEXT),
            (RESTART_SECOND_SESSION_ID, RESTART_SECOND_TEXT),
        ):
            records = logs[session_id]
            if sum(record.get("type") == "turn/end" for record in records) != 1:
                raise AssertionError(f"restart snapshot {session_id} has an unexpected turn count")
            if expected not in render_jsonl(records):
                raise AssertionError(f"restart snapshot durable log has no {expected}")

        files = build_restart_snapshot_files(
            first,
            second,
            requests,
            logs,
            root,
            sessions,
        )
        compare_snapshot_files(
            files, update_snapshots, RESTART_SNAPSHOT_DIRECTORY, RESTART_SNAPSHOT_FILENAMES,
        )


def smoke_direct(base_url: str, executable: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="dsh-direct-") as temporary:
        root = Path(temporary).resolve()
        dsh_home = root / "home"
        sessions = dsh_home / "sessions"
        patch = write_profile_patch(root, "direct.patch.yml", sessions, [])
        environment = {
            **os.environ,
            "DSH_HOME": str(dsh_home),
            "DSH_PERMISSION_MODE": "danger-full-access",
            "DSH_TELEMETRY_DISABLED": "1",
            "DEEPSEEK_API_KEY": "sk-keyless-smoke",
            "DEEPSEEK_BASE_URL": base_url,
        }
        peer = RuntimePeer(
            [str(executable), "--profile", "sdk", "--patch", str(patch)],
            root,
            environment,
        )
        try:
            peer.send({"jsonrpc": "2.0", "id": "initialize", "method": "initialize", "params": {"cwd": str(root), "provider": "deepseek-official", "model": "smoke-model"}})
            peer.read_until(lambda message: message.get("id") == "initialize")
            peer.send({
                "jsonrpc": "2.0",
                "id": "prompt",
                "method": "session/prompt",
                "params": {"sessionId": "direct-smoke", "contentBlocks": [{"type": "text", "text": "reply with the smoke text"}]},
            })
            messages = peer.read_until(lambda message: message.get("id") == "prompt")
            if not any(is_idle_notification(message) for message in messages):
                messages.extend(peer.read_until(is_idle_notification))
            event_text = json.dumps(messages)
            if EXPECTED_TEXT not in event_text:
                raise AssertionError(f"direct runtime emitted no final response: {messages}")
            peer.send({"jsonrpc": "2.0", "id": "shutdown", "method": "shutdown"})
            peer.read_until(lambda message: message.get("id") == "shutdown")
        finally:
            peer.close()
        assert_session_log(sessions, root, EXPECTED_TEXT)


def smoke_packaged_runner(executable: Path) -> None:
    """Exercise the private subprocess runner through the single-file entry."""
    with tempfile.TemporaryDirectory(prefix="dsh-packaged-runner-") as temporary:
        root = Path(temporary).resolve()
        target_script = (
            "import os,sys; "
            "ok = (os.getcwd() == os.environ['PACKAGED_RUNNER_EXPECTED_CWD'] "
            "and os.environ.get('DSH_SUBPROCESS_RUNNER') == 'target-collision-restored'); "
            "sys.exit(7 if ok else 9)"
        )
        if not IS_WINDOWS:
            request_path = root / "launch-request.json"
            target_env = dict(os.environ)
            target_env["DSH_SUBPROCESS_RUNNER"] = "target-collision-restored"
            target_env["PACKAGED_RUNNER_EXPECTED_CWD"] = str(root)
            request_path.write_text(
                json.dumps({"cwd": str(root), "env": target_env}),
                encoding="utf-8",
            )
            request_path.chmod(0o600)
            environment = dict(os.environ)
            environment["DSH_SUBPROCESS_RUNNER"] = str(request_path)
            result = subprocess.run(
                [str(executable), "--", sys.executable, "-c", target_script],
                cwd=root,
                env=environment,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            if result.returncode != 7 or request_path.exists() or (root / "startup-error.json").exists():
                raise AssertionError(
                    "packaged POSIX runner failed: "
                    f"exit={result.returncode}; stdout={result.stdout!r}; stderr={result.stderr!r}"
                )
            return

        node = shutil.which("node")
        if node is None:
            raise AssertionError("packaged Windows runner smoke requires node on PATH")
        helper = root / "windows-runner-smoke.mjs"
        helper.write_text(
            """import { spawn } from 'node:child_process'
const [runtime, target, cwd, targetScript] = process.argv.slice(2)
const child = spawn(runtime, ['--', target, '-c', targetScript], {
  cwd,
  env: { ...process.env, DSH_SUBPROCESS_RUNNER: 'windows' },
  stdio: ['ignore', 'ignore', 'ignore', 'ipc', 'pipe', 'pipe', 'pipe'],
})
const messages = []
let stdout = ''
let stderr = ''
child.stdio[4].destroy()
child.stdio[5].on('data', chunk => { stdout += chunk.toString() })
child.stdio[6].on('data', chunk => { stderr += chunk.toString() })
child.on('message', message => { messages.push(message) })
const result = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('spawn', () => {
    child.send({
      type: 'start',
      cwd,
      env: {
        ...process.env,
        DSH_SUBPROCESS_RUNNER: 'target-collision-restored',
        PACKAGED_RUNNER_EXPECTED_CWD: cwd,
      },
    }, error => { if (error) reject(error) })
  })
  child.once('close', (exitCode, signal) => { resolve({ exitCode, signal }) })
})
process.stdout.write(JSON.stringify({ ...result, messages, stdout, stderr }))
""",
            encoding="utf-8",
        )
        helper_result = subprocess.run(
            [node, str(helper), str(executable), sys.executable, str(root), target_script],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if helper_result.returncode != 0:
            raise AssertionError(f"packaged Windows runner helper failed: {helper_result.stderr}")
        observed = json.loads(helper_result.stdout)
        expected = {
            "exitCode": 0,
            "signal": None,
            "messages": [{"type": "target-exit", "exitCode": 7}],
            "stdout": "",
            "stderr": "",
        }
        if observed != expected:
            raise AssertionError(f"packaged Windows runner returned unexpected facts: {observed}")


def is_idle_notification(message: dict[str, object]) -> bool:
    """Return whether a JSON-RPC notification marks a session idle."""
    params = message.get("params")
    return (
        message.get("method") == "session.status"
        and isinstance(params, dict)
        and params.get("status") == "idle"
    )


class RuntimePeer:
    def __init__(self, argv: list[str], cwd: Path, environment: dict[str, str]) -> None:
        self.process = subprocess.Popen(
            argv,
            cwd=cwd,
            env=environment,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        self.stdout: queue.Queue[str | None] = queue.Queue()
        self.stderr: list[str] = []
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()

    def send(self, message: dict[str, object]) -> None:
        if self.process.stdin is None:
            raise RuntimeError("runtime stdin is unavailable")
        self.process.stdin.write(json.dumps(message) + "\n")
        self.process.stdin.flush()

    def read_until(self, predicate: Callable[[dict[str, object]], bool]) -> list[dict[str, object]]:
        deadline = time.monotonic() + 60
        messages: list[dict[str, object]] = []
        while time.monotonic() < deadline:
            try:
                line = self.stdout.get(timeout=min(0.25, deadline - time.monotonic()))
            except queue.Empty:
                continue
            if line is None:
                raise RuntimeError(f"runtime exited before expected message; stderr: {''.join(self.stderr)}")
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            messages.append(message)
            if predicate(message):
                return messages
        raise TimeoutError(f"runtime timed out; messages={messages}; stderr={''.join(self.stderr)}")

    def close(self) -> None:
        if self.process.stdin is not None and not self.process.stdin.closed:
            self.process.stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        if self.process.returncode not in {0, -15}:
            raise RuntimeError(f"runtime exited {self.process.returncode}; stderr: {''.join(self.stderr)}")

    def _read_stdout(self) -> None:
        assert self.process.stdout is not None
        for line in self.process.stdout:
            self.stdout.put(line)
        self.stdout.put(None)

    def _read_stderr(self) -> None:
        assert self.process.stderr is not None
        self.stderr.extend(self.process.stderr)


PERSISTED_SESSION_FILENAME = re.compile(r"^session(?:\.v([1-9]\d*))?\.jsonl(\.zstd)?$")
SNAPSHOT_SESSION_FILENAME = re.compile(
    r"^session(?:\.([1-9]\d*))?(?:\.v([1-9]\d*))?\.jsonl$",
)


def persisted_session_filename_version(path: Path, compressed: bool = False) -> int | None:
    """Return one canonical persistence basename's generation for the selected encoding."""
    match = PERSISTED_SESSION_FILENAME.fullmatch(path.name)
    if match is None or (match.group(2) is not None) != compressed:
        return None
    return int(match.group(1) or 0)


def latest_persisted_session_paths(sessions: Path, compressed: bool = False) -> list[Path]:
    """Select the numeric-highest immutable generation in each physical Session directory."""
    pattern = "*.jsonl.zstd" if compressed else "*.jsonl"
    selected: dict[Path, tuple[int, Path]] = {}
    for path in sessions.rglob(pattern):
        version = persisted_session_filename_version(path, compressed)
        if version is None:
            continue
        previous = selected.get(path.parent)
        if previous is None or version > previous[0]:
            selected[path.parent] = (version, path)
    return sorted((entry[1] for entry in selected.values()), key=lambda path: str(path))


def session_header_version(content: str, label: str) -> int:
    """Read a non-negative physical Session generation from the first JSONL record."""
    first = next((line for line in content.splitlines() if line), None)
    if first is None:
        raise AssertionError(f"{label}: Session log is empty")
    header = json.loads(first)
    version = header.get("version") if isinstance(header, dict) and header.get("type") == "session" else None
    if not isinstance(version, int) or isinstance(version, bool) or version < 0:
        raise AssertionError(f"{label}: Session header has no non-negative integer version")
    return version


def assert_current_session_version(version: int, label: str) -> None:
    """Require generated logs to use the source writer generation, independent of goldens."""
    source = Path(__file__).resolve().parents[1] / "Engine/core/session/src/types.ts"
    declarations = re.findall(
        r"^export const SESSION_FORMAT_VERSION = ([0-9]+)$",
        source.read_text(encoding="utf-8"),
        re.MULTILINE,
    )
    if len(declarations) != 1:
        raise AssertionError(f"{source}: expected one literal SESSION_FORMAT_VERSION declaration")
    current_version = int(declarations[0])
    if version != current_version:
        raise AssertionError(
            f"{label}: expected current Session format v{current_version}, got v{version}",
        )


def assert_persisted_session_version(path: Path, content: str) -> int:
    """Require generated persistence filenames and headers to use the current generation."""
    filename_version = persisted_session_filename_version(path)
    if filename_version is None:
        raise AssertionError(f"non-canonical Session persistence filename: {path.name}")
    header_version = session_header_version(content, path.name)
    if filename_version != header_version:
        raise AssertionError(
            f"{path.name}: filename declares Session format v{filename_version}, "
            f"header declares v{header_version}",
        )
    assert_current_session_version(header_version, path.name)
    return header_version


def snapshot_session_filename(index: int, version: int) -> str:
    """Render parent/ordinal snapshot role plus an omitted-v0 generation."""
    if index < 0 or version < 0:
        raise ValueError("snapshot Session index and version must be non-negative")
    ordinal = "" if index == 0 else f".{index}"
    generation = "" if version == 0 else f".v{version}"
    return f"session{ordinal}{generation}.jsonl"


def parse_snapshot_session_filename(name: str) -> tuple[int, int] | None:
    """Parse one canonical parent/ordinal snapshot filename."""
    match = SNAPSHOT_SESSION_FILENAME.fullmatch(name)
    if match is None:
        if name.startswith("session") and name.endswith(".jsonl"):
            raise AssertionError(f"invalid snapshot Session filename: {name}")
        return None
    return int(match.group(1) or 0), int(match.group(2) or 0)


def selected_snapshot_session_files(directory: Path) -> dict[int, Path]:
    """Select one highest-generation expected file per parent/ordinal role."""
    selected: dict[int, tuple[int, Path]] = {}
    for path in directory.iterdir():
        if not path.is_file():
            continue
        parsed = parse_snapshot_session_filename(path.name)
        if parsed is None:
            continue
        index, version = parsed
        content = path.read_text(encoding="utf-8")
        header_version = session_header_version(content, path.name)
        if header_version != version:
            raise AssertionError(
                f"{path.name}: filename declares Session format v{version}, header declares v{header_version}",
            )
        previous = selected.get(index)
        if previous is None or version > previous[0]:
            selected[index] = (version, path)
    return {index: value[1] for index, value in selected.items()}


def assert_session_log(sessions: Path, cwd: Path, *expected_texts: str) -> None:
    logs = latest_persisted_session_paths(sessions)
    if len(logs) != 1:
        raise AssertionError(f"expected one JSONL session log under {sessions}, found {logs}")
    content = logs[0].read_text(encoding="utf-8")
    assert_persisted_session_version(logs[0], content)
    lines = content.splitlines()
    header = json.loads(lines[0])
    if header.get("cwd") != str(cwd):
        raise AssertionError(f"session header cwd is not absolute/canonical: {header}")
    rendered = "\n".join(lines)
    for expected in expected_texts:
        if expected not in rendered:
            raise AssertionError(f"session log has no {expected!r} response: {logs[0]}")


def assert_zstd_session_log(sessions: Path) -> None:
    logs = latest_persisted_session_paths(sessions, compressed=True)
    if len(logs) != 1:
        raise AssertionError(f"expected one Zstandard JSONL session log under {sessions}, found {logs}")
    if not logs[0].read_bytes().startswith(bytes.fromhex("28b52ffd")):
        raise AssertionError(f"session log has no Zstandard magic: {logs[0]}")


def read_session_logs(sessions: Path) -> dict[str, list[dict[str, object]]]:
    """Parse every persisted JSONL session into a map keyed by header id."""
    logs: dict[str, list[dict[str, object]]] = {}
    for path in latest_persisted_session_paths(sessions):
        content = path.read_text(encoding="utf-8")
        assert_persisted_session_version(path, content)
        records = [
            json.loads(line)
            for line in content.splitlines()
            if line
        ]
        if not records or records[0].get("type") != "session":
            raise AssertionError(f"session log has no header: {path}")
        session_id = records[0].get("id")
        if not isinstance(session_id, str):
            raise AssertionError(f"session log header has no string id: {path}")
        if session_id in logs:
            raise AssertionError(f"duplicate persisted session id: {session_id}")
        logs[session_id] = records
    return logs


def snapshot_child_ids(result: "RunResult") -> list[str]:
    """Return the two child session ids in their SDK notification order."""
    child_ids: list[str] = []
    for notification in result.notifications:
        if notification.method != "subagent.started":
            continue
        payload = notification.payload
        if payload.get("parentSessionId") != SNAPSHOT_SESSION_ID:
            continue
        child_id = payload.get("childSessionId")
        if isinstance(child_id, str) and child_id not in child_ids:
            child_ids.append(child_id)
    if len(child_ids) != 2:
        raise AssertionError(f"advanced snapshot expected two child session ids: {child_ids}")
    return child_ids


def build_in_history_snapshot_files(
    result: "RunResult",
    requests: list[dict[str, object]],
    log: list[dict[str, object]],
) -> dict[str, str]:
    """Assert live requests, SDK subscriptions, and persistence retain both prompts."""
    systems = [event for event in result.events if event.get("type") == "system/message"]
    assert len(systems) == 2, systems
    assert [event.get("surfaceOp") for event in systems] == ["append", "append"], systems
    prompts = [message_text(event["data"]["message"]["content"]) for event in systems]
    assert "Python SDK prompt version 1." in prompts[0], prompts
    assert "Python SDK prompt version 2." not in prompts[0], prompts
    assert "Python SDK prompt version 2." in prompts[1], prompts
    assert "Python SDK prompt version 1." not in prompts[1], prompts
    assert prompts[0] != prompts[1], prompts
    assert [event for event in log if event.get("type") == "system/message"] == systems
    subscribed = [
        notification.payload["event"]
        for notification in result.notifications
        if notification.method == "session.event"
        and notification.payload.get("event", {}).get("type") == "system/message"
    ]
    assert subscribed == systems, subscribed
    contexts = [event["data"] for event in result.events if event.get("type") == "request/context"]
    assert contexts and all(context.get("systemPromptUpdate") == "in-history" for context in contexts), contexts
    assert len([event for event in result.events if event.get("type") == "request/header"]) == 1
    assert all(event.get("surfaceOp") in (None, "append") for event in result.events)
    first_tool = next(index for index, event in enumerate(result.events) if event.get("type") == "tool/result")
    assert result.events.index(systems[1]) > first_tool
    assert len(requests) == 3, requests
    request_prompts = []
    for index, request in enumerate(requests):
        messages = request["messages"]
        assert messages[0]["role"] == "system" and message_text(messages[0]["content"]) == prompts[0]
        assert request["tools"] == requests[0]["tools"], "prompt update changed tool schemas"
        positions = [position for position, message in enumerate(messages) if message["role"] == "system"]
        texts = [message_text(messages[position]["content"]) for position in positions]
        assert texts == (prompts[:1] if index == 0 else prompts), texts
        if index > 0:
            assert messages[positions[1] - 1]["role"] == "tool", messages
        request_prompts.append(texts)
    evidence = {
        "requestSystemPrompts": request_prompts,
        "systemMessageOperations": [event["surfaceOp"] for event in systems],
        "subscribedSystemPrompts": prompts,
        "requestContexts": contexts,
    }
    return {"prompt-history.json": json.dumps(evidence, indent=2, ensure_ascii=False) + "\n"}


def build_minimal_snapshot_files(
    requests: list[dict[str, object]],
    cwd: Path,
) -> dict[str, str]:
    """Render the minimal composition's model-visible surface as expected output.

    Every assembled system prompt, advertised tool schema, and system or user message is
    kept verbatim: they carry what the deployment actually shows the model, so a plugin
    that contributes an unintended system section or user message cannot pass unnoticed.
    Assistant and tool payloads keep only their call identity because their text differs
    across the platforms this expected output must replay on. The shipped profile omits
    dynamic runtime context, so every message it emits is compared.
    """
    snapshot = []
    for body in requests:
        messages = body.get("messages")
        if not isinstance(messages, list):
            raise AssertionError(f"minimal model request has no messages: {body}")
        snapshot.append({
            "tools": minimal_snapshot_text(body.get("tools"), cwd),
            "messages": [
                minimal_snapshot_message(message, cwd)
                for message in messages
            ],
        })
    return {"model-visible.json": json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n"}


def minimal_snapshot_message(message: object, cwd: Path) -> dict[str, object]:
    """Reduce one model-visible message to its stable, behavior-carrying parts."""
    if not isinstance(message, dict):
        raise AssertionError(f"minimal model request has an invalid message: {message}")
    role = message.get("role")
    if role in ("system", "user"):
        return {"role": role, "text": minimal_snapshot_text(message_text(message.get("content")), cwd)}
    if role == "assistant":
        calls = message.get("tool_calls")
        if not isinstance(calls, list):
            raise AssertionError(f"minimal assistant message has no tool calls: {message}")
        return {
            "role": role,
            "toolCalls": [
                {"id": call.get("id"), "name": (call.get("function") or {}).get("name")}
                for call in calls
                if isinstance(call, dict)
            ],
        }
    if role == "tool":
        return {"role": role, "toolCallId": message.get("tool_call_id"), "text": "{{tool-result}}"}
    raise AssertionError(f"minimal model request has an unexpected message role: {message}")


def minimal_snapshot_text(value: object, cwd: Path) -> object:
    """Replace the scenario's temporary working directory everywhere it appears."""
    if isinstance(value, str):
        return value.replace(str(cwd), "{{cwd}}")
    if isinstance(value, list):
        return [minimal_snapshot_text(item, cwd) for item in value]
    if isinstance(value, dict):
        return {key: minimal_snapshot_text(item, cwd) for key, item in value.items()}
    return value


def build_snapshot_files(
    result: "RunResult",
    logs: dict[str, list[dict[str, object]]],
    child_ids: list[str],
    cwd: Path,
) -> dict[str, str]:
    """Render the SDK result and three persisted logs into stable expected outputs."""
    replacements = [(str(cwd), "{{cwd}}"), (SNAPSHOT_SESSION_ID, "{{parent}}")]
    replacements.append((snapshot_workflow_run_id(result), "{{workflow-run}}"))
    for index, child_id in enumerate(child_ids, start=1):
        replacements.append((child_id, f"{{{{child-{index}}}}}"))
        agent_id = snapshot_agent_id(result, child_id)
        replacements.append((agent_id, f"{{{{agent-{index}}}}}"))
    command_index = 0
    for record in logs[SNAPSHOT_SESSION_ID]:
        data = record.get("data")
        if record.get("type") == "command/run" and isinstance(data, dict):
            command_index += 1
            replacements.append((data["commandId"], f"{{{{command:{command_index}}}}}"))
        if record.get("type") == "command/done" and isinstance(data, dict):
            anonymous = re.search(r"Anonymous user: ([0-9a-f-]{36})", str(data.get("text")))
            if anonymous is not None:
                replacements.append((anonymous.group(1), "{{anonymous-user}}"))
    feedback_targets = dict.fromkeys(
        record["data"]["item"]["messageId"]
        for record in logs[SNAPSHOT_SESSION_ID]
        if record.get("type") == "feedback/message-put"
    )
    for index, message_id in enumerate(feedback_targets, start=1):
        replacements.append((message_id, f"{{{{message:{index}}}}}"))
    feedback_versions = dict.fromkeys(
        record["data"]["item"]["version"]
        for record in logs[SNAPSHOT_SESSION_ID]
        if record.get("type") == "feedback/message-put"
    )
    for index, version in enumerate(feedback_versions, start=1):
        replacements.append((version, f"{{{{feedback-version:{index}}}}}"))
    replacements.sort(key=lambda pair: len(pair[0]), reverse=True)

    result_value = {
        "session_id": result.session_id,
        "final_response": result.final_response,
        "events": result.events,
        "notifications": [
            {"method": notification.method, "payload": notification.payload}
            for notification in result.notifications
        ],
    }
    normalized_result = normalize_snapshot_value(result_value, replacements)
    parent_records = project_session_snapshot([
        normalize_snapshot_value(record, replacements) for record in logs[SNAPSHOT_SESSION_ID]
    ])
    files = {
        "result.json": json.dumps(normalized_result, indent=2, ensure_ascii=False) + "\n",
        snapshot_session_filename(
            0, session_header_version(render_jsonl(parent_records), "advanced parent"),
        ): render_jsonl(parent_records),
    }
    for index, child_id in enumerate(child_ids, start=1):
        child_records = project_session_snapshot([
            normalize_snapshot_value(record, replacements) for record in logs[child_id]
        ])
        child_content = render_jsonl(child_records)
        files[snapshot_session_filename(
            index, session_header_version(child_content, f"advanced child {index}"),
        )] = child_content
    return files


def build_restart_snapshot_files(
    first: "RunResult",
    second: "RunResult",
    requests: list[dict[str, object]],
    logs: dict[str, list[dict[str, object]]],
    cwd: Path,
    sessions: Path,
) -> dict[str, str]:
    """Render two SDK processes, isolated model histories, and durable logs."""
    replacements = [
        (str(sessions), "{{sessions}}"),
        (str(cwd), "{{cwd}}"),
        (RESTART_FIRST_SESSION_ID, "{{session-1}}"),
        (RESTART_SECOND_SESSION_ID, "{{session-2}}"),
    ]
    result_value = [
        {
            "session_id": result.session_id,
            "final_response": result.final_response,
            "finish_reason": result.finish_reason,
            "eventTypes": [
                event.get("type")
                for event in result.events
            ],
            "notificationMethods": [
                notification.method
                for notification in result.notifications
            ],
        }
        for result in (first, second)
    ]
    request_value = [
        {
            "model": request.get("model"),
            "messages": restart_request_messages(request),
            "toolNames": sorted(advertised_tool_names(request)),
        }
        for request in requests
    ]
    first_records = project_session_snapshot([
        normalize_snapshot_value(record, replacements) for record in logs[RESTART_FIRST_SESSION_ID]
    ])
    second_records = project_session_snapshot([
        normalize_snapshot_value(record, replacements) for record in logs[RESTART_SECOND_SESSION_ID]
    ])
    first_content = render_jsonl(first_records)
    second_content = render_jsonl(second_records)
    return {
        "result.json": json.dumps(
            normalize_snapshot_value(result_value, replacements), indent=2, ensure_ascii=False,
        ) + "\n",
        "requests.json": json.dumps(
            normalize_snapshot_value(request_value, replacements), indent=2, ensure_ascii=False,
        ) + "\n",
        snapshot_session_filename(
            1, session_header_version(first_content, "restart Session 1"),
        ): first_content,
        snapshot_session_filename(
            2, session_header_version(second_content, "restart Session 2"),
        ): second_content,
    }


def restart_request_messages(request: dict[str, object]) -> list[object]:
    """Project model history while tokenizing composition-owned system prose."""
    messages = request.get("messages")
    if not isinstance(messages, list):
        raise AssertionError(f"restart snapshot request has no messages: {request}")
    return [
        {"role": "system", "content": "{{system}}"}
        if isinstance(message, dict) and message.get("role") == "system"
        else message
        for message in messages
    ]


def snapshot_workflow_run_id(result: "RunResult") -> str:
    """Return the one workflow run id emitted by the advanced scenario."""
    run_ids: set[str] = set()
    for event in result.events:
        event_type = event.get("type")
        data = event.get("data")
        if not isinstance(event_type, str) or not event_type.startswith("tool-workflow/"):
            continue
        if isinstance(data, dict) and isinstance(data.get("runId"), str):
            run_ids.add(data["runId"])
    if len(run_ids) != 1:
        raise AssertionError(f"advanced snapshot expected one workflow run id: {sorted(run_ids)}")
    return next(iter(run_ids))


def snapshot_agent_id(result: "RunResult", child_id: str) -> str:
    """Find the successful subagent id paired with one child session."""
    for notification in result.notifications:
        if notification.method != "subagent.finished":
            continue
        payload = notification.payload
        if payload.get("childSessionId") != child_id:
            continue
        if payload.get("provider") != "spawn" or payload.get("status") != "ok":
            raise AssertionError(f"advanced child did not finish successfully: {payload}")
        agent_id = payload.get("agentId")
        if isinstance(agent_id, str):
            return agent_id
    raise AssertionError(f"advanced snapshot has no finished agent for child {child_id}")


def normalize_snapshot_value(
    value: object,
    replacements: list[tuple[str, str]],
) -> object:
    """Scrub volatile values and bulky request headers without losing behavior."""
    if isinstance(value, str):
        normalized = value
        for actual, token in replacements:
            normalized = normalized.replace(actual, token)
        return normalized
    if isinstance(value, list):
        return [normalize_snapshot_value(item, replacements) for item in value]
    if not isinstance(value, dict):
        return value

    normalized = {
        key: normalize_snapshot_value(item, replacements)
        for key, item in value.items()
    }
    if normalized.get("type") == "session" and "createdAt" in normalized:
        normalized["createdAt"] = 0
    if normalized.get("type") == "subagent/catalog":
        data = normalized.get("data")
        if isinstance(data, dict) and "childCreatedAt" in data:
            data["childCreatedAt"] = 0
    if "seq" in normalized and "time" in normalized:
        normalized["time"] = 0
    if normalized.get("type") in ("assistant/message", "assistant/attempt"):
        data = normalized.get("data")
        stream = data.get("stream") if isinstance(data, dict) else None
        if isinstance(stream, list):
            for member in stream:
                if not isinstance(member, dict):
                    continue
                if isinstance(member.get("time"), (int, float)):
                    member["time"] = 0
                if isinstance(member.get("time0"), (int, float)):
                    member["time0"] = 0
                dt = member.get("dt")
                if isinstance(dt, list):
                    member["dt"] = [0] * len(dt)
    if isinstance(normalized.get("id"), str) and normalized.get("role") in ("assistant", "system", "user"):
        if not normalized["id"].startswith("{{message:"):
            normalized["id"] = "{{messageId}}"
    if normalized.get("type") in ("feedback/message-put", "feedback/message-delete"):
        data = normalized.get("data")
        if isinstance(data, dict):
            item = data.get("item") if normalized["type"] == "feedback/message-put" else data
            if isinstance(item, dict):
                if normalized["type"] == "feedback/message-put":
                    item["createdAt"] = 0
                    item["updatedAt"] = 0
    scrub_snapshot_header(normalized)
    scrub_snapshot_system_message(normalized)
    return normalized


def scrub_snapshot_header(value: dict[object, object]) -> None:
    """Tokenize full request-header tool schemas while retaining tool names."""
    data = value.get("data")
    if not isinstance(data, dict):
        return
    if value.get("type") == "request/header":
        header = data.get("header")
        if not isinstance(header, dict):
            return
        tools = header.get("tools")
        if isinstance(tools, list):
            header["tools"] = [
                tool.get("name") if isinstance(tool, dict) else "{{tools}}"
                for tool in tools
            ]


def scrub_snapshot_system_message(value: dict[object, object]) -> None:
    """Tokenize the rendered prompt text of a `system/message` surface node."""
    if value.get("type") != "system/message":
        return
    data = value.get("data")
    message = data.get("message") if isinstance(data, dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, list):
        return
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            block["text"] = "{{system}}"


def render_jsonl(records: list[object]) -> str:
    """Render parsed JSON values as compact, newline-terminated JSONL."""
    return "".join(
        json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
        for record in records
    )


def project_session_snapshot(records: list[dict[str, object]]) -> list[dict[str, object]]:
    """Omit storage sequence/time envelopes from snapshot body records."""
    projected = [dict(record) for record in records]
    for record in projected[1:]:
        for key in ("seq", "time", "seq0", "time0"):
            record.pop(key, None)
    return projected


SESSION_FORMAT_PROVENANCE = "{{sessionFormatVersion}}"


def expand_snapshot_stream_member(member: object) -> list[dict[str, object]]:
    """Expand one compact Assistant stream member into logical provider chunks."""
    if not isinstance(member, dict):
        raise AssertionError(f"snapshot Assistant stream member is not an object: {member!r}")
    member_type = member.get("type")
    if member_type == "chunk":
        chunk = member.get("chunk")
        if not isinstance(chunk, dict):
            raise AssertionError(f"snapshot Assistant chunk member has no chunk: {member!r}")
        return [chunk]
    packed_kinds = {
        "text-chunks": ("texts", "text-delta", "text"),
        "reasoning-chunks": ("texts", "reasoning-delta", "text"),
        "tool-call-chunks": ("args", "tool-call-delta", "argumentsDelta"),
    }
    packed = packed_kinds.get(member_type)
    if packed is None:
        raise AssertionError(f"snapshot Assistant stream has unknown member type: {member_type!r}")
    values_key, chunk_type, value_key = packed
    values = member.get(values_key)
    if not isinstance(values, list):
        raise AssertionError(f"snapshot Assistant stream member has no {values_key}: {member!r}")
    shared = {
        key: member[key]
        for key in ("index", "id", "name")
        if key in member
    }
    return [
        {"type": chunk_type, **shared, value_key: value}
        for value in values
    ]


def expand_snapshot_assistant_event(value: object) -> list[object]:
    """Expand one direct or SDK-wrapped v2 settlement for generation-neutral comparison."""
    if not isinstance(value, dict):
        return [value]
    event = value
    wrapper_key: str | None = None
    wrapper: dict[str, object] | None = None
    if value.get("method") == "session.event":
        for candidate in ("payload", "params"):
            container = value.get(candidate)
            nested = container.get("event") if isinstance(container, dict) else None
            if isinstance(nested, dict):
                event = nested
                wrapper_key = candidate
                wrapper = container
                break
    if event.get("type") not in ("assistant/message", "assistant/attempt"):
        return [value]
    data = event.get("data")
    stream = data.get("stream") if isinstance(data, dict) else None
    if not isinstance(stream, list):
        return [value]

    def wrap(expanded: dict[str, object]) -> object:
        if wrapper_key is None or wrapper is None:
            return expanded
        return {**value, wrapper_key: {**wrapper, "event": expanded}}

    common = {
        key: data[key]
        for key in ("turn", "step")
        if key in data
    }
    expanded = [
        wrap({
            "type": "assistant/chunk",
            "data": {**common, "chunk": chunk},
        })
        for member in stream
        for chunk in expand_snapshot_stream_member(member)
    ]
    if event.get("type") == "assistant/message":
        expanded.append(wrap({
            **event,
            "data": {key: item for key, item in data.items() if key != "stream"},
        }))
    return expanded


def normalize_session_format_comparison(
    value: object,
    source_session_version: int | None = None,
) -> object:
    """Canonicalize only generation provenance that differs across immutable Session files."""
    if isinstance(value, list):
        return [
            normalize_session_format_comparison(expanded, source_session_version)
            for item in value
            for expanded in expand_snapshot_assistant_event(item)
        ]
    if not isinstance(value, dict):
        return value

    normalized = {
        key: normalize_session_format_comparison(item, source_session_version)
        for key, item in value.items()
    }
    if normalized.get("type") == "session" and "version" in normalized:
        normalized["version"] = SESSION_FORMAT_PROVENANCE
        normalized.setdefault("isSeeded", False)
        ordered_header = {
            key: normalized[key]
            for key in ("type", "version", "id", "createdAt", "cwd", "isSeeded", "delegationDepth")
            if key in normalized
        }
        normalized = {
            **ordered_header,
            **{key: item for key, item in normalized.items() if key not in ordered_header},
        }
    if isinstance(normalized.get("type"), str) and "data" in normalized:
        normalized.pop("seq", None)
        normalized.pop("time", None)
    if source_session_version == 1 and normalized.get("type") == "assistant/message":
        normalized.pop("sourceEventSeqs", None)
    return normalized


def normalize_snapshot_comparison_text(name: str, content: str) -> str:
    """Normalize Session generation provenance only while comparing committed expected outputs."""
    if name.startswith("session") and name.endswith(".jsonl"):
        parsed = [json.loads(line) for line in content.splitlines() if line]
        header = parsed[0] if parsed else None
        source_version = header.get("version") if isinstance(header, dict) else None
        if not isinstance(source_version, int):
            raise AssertionError(f"{name}: snapshot Session header has no integer format version")
        records = [
            normalize_session_format_comparison(expanded, source_version)
            for record in parsed
            for expanded in expand_snapshot_assistant_event(record)
        ]
        return render_jsonl(records)
    if name.endswith(".json"):
        return json.dumps(
            normalize_session_format_comparison(json.loads(content)),
            indent=2,
            ensure_ascii=False,
        ) + "\n"
    return content


def compare_snapshot_files(
    files: dict[str, str],
    update: bool,
    directory: Path,
    filenames: tuple[str, ...],
) -> None:
    """Compare ordered artifact roles and Session content across generations, or write generated filenames."""
    scenario = directory.name

    def role_name(name: str) -> str:
        parsed = parse_snapshot_session_filename(name)
        return name if parsed is None else snapshot_session_filename(parsed[0], 0)

    if tuple(map(role_name, files)) != tuple(map(role_name, filenames)):
        raise AssertionError(f"{scenario} snapshot builder produced {tuple(files)}, expected {filenames}")
    for name, content in files.items():
        if parse_snapshot_session_filename(name) is not None:
            assert_current_session_version(session_header_version(content, name), name)
    if update:
        directory.mkdir(parents=True, exist_ok=True)
        for name, content in files.items():
            (directory / name).write_text(content, encoding="utf-8", newline="\n")
        print(f"smoke-python-runtime: updated snapshots in {directory}")

    existing = [path for path in directory.iterdir() if path.is_file()] if directory.is_dir() else []
    expected_non_session = {
        name for name in filenames if parse_snapshot_session_filename(name) is None
    }
    existing_non_session = {
        path.name for path in existing if parse_snapshot_session_filename(path.name) is None
    }
    if existing_non_session != expected_non_session:
        raise AssertionError(
            f"{scenario} snapshot files differ: "
            f"missing={sorted(expected_non_session - existing_non_session)}, "
            f"unexpected={sorted(existing_non_session - expected_non_session)}"
        )
    selected_expected = selected_snapshot_session_files(directory)
    actual_sessions: dict[int, tuple[str, str]] = {}
    for name, content in files.items():
        parsed = parse_snapshot_session_filename(name)
        if parsed is None:
            continue
        index, filename_version = parsed
        header_version = session_header_version(content, name)
        if filename_version != header_version:
            raise AssertionError(
                f"{name}: filename declares Session format v{filename_version}, "
                f"header declares v{header_version}",
            )
        if index in actual_sessions:
            raise AssertionError(f"{scenario} snapshot builder produced duplicate Session role {index}")
        actual_sessions[index] = (name, content)
    if set(selected_expected) != set(actual_sessions):
        raise AssertionError(
            f"{scenario} snapshot Session roles differ: "
            f"expected={sorted(selected_expected)}, actual={sorted(actual_sessions)}",
        )
    for name, actual in files.items():
        parsed = parse_snapshot_session_filename(name)
        expected_path = directory / name if parsed is None else selected_expected[parsed[0]]
        expected_text = expected_path.read_text(encoding="utf-8")
        compared_actual = normalize_snapshot_comparison_text(name, actual)
        compared_expected = normalize_snapshot_comparison_text(expected_path.name, expected_text)
        if compared_actual == compared_expected:
            continue
        diff = "".join(difflib.unified_diff(
            compared_expected.splitlines(keepends=True),
            compared_actual.splitlines(keepends=True),
            fromfile=f"expected/{expected_path.name}",
            tofile=f"actual/{name}",
        ))
        raise AssertionError(
            f"{scenario} executable snapshot mismatch in {name}; "
            "rerun with --update-snapshots after reviewing the behavior\n"
            f"{diff}"
        )


if __name__ == "__main__":
    main()
