#!/usr/bin/env python3
"""Keyless full-turn smoke for the Python SDK runtime and its Native profiles."""

from __future__ import annotations

import argparse
import base64
import hashlib
import importlib
import importlib.metadata
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import sysconfig
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from redspark_harness import RunResult

EXPECTED_TEXT = "runtime smoke ok"
LIVE_API_SENTINEL = "PYTHON_SDK_LIVE_OK"
MCP_PROMPT = "Exercise the packaged MCP client with one external stdio server."
MCP_TEXT = "MCP client smoke ok"
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

def ensure_native_sdk_profile(executable: Path | None, rsh_home: Path, cwd: Path) -> None:
    """Create the shipped Native SDK composition under an explicit custom profile name."""
    dsh = executable or Path(sysconfig.get_path("scripts")) / ("dsh.exe" if IS_WINDOWS else "dsh")
    result = subprocess.run(
        [str(dsh), "--profile", "smoke-sdk", "--from-default-profile", "sdk", "--help"],
        cwd=cwd,
        env={**os.environ, "RSH_HOME": str(rsh_home)},
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"failed to create the native SDK profile: returncode={result.returncode} "
            f"stdout={result.stdout!r} stderr={result.stderr!r}"
        )

def write_native_mcp_patch(root: Path, server_script: Path) -> Path:
    """Write one Native overlay that mounts the packaged MCP client."""
    path = root / "mcp.patch.json"
    path.write_text(json.dumps({"formatVersion": 1, "installations": [{
        "id": "mcp-fixture",
        "plugin": "@redspark/rsh-mcp-client",
        "scope": "root",
        "config": {
            "serverName": "fixture",
            "transport": "stdio",
            "command": sys.executable,
            "args": [str(server_script)],
            "env": {"MCP_SMOKE_LOG": str(server_script.with_suffix(".log"))},
            "failOnStartupError": True,
            "reconnect": {"enabled": False},
        },
    }]}, indent=2))
    return path

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
        raise AssertionError(f"unexpected tool follow-up: {tool_name}")

    user_prompts = [
        message_text(message.get("content"))
        for message in reversed(messages)
        if isinstance(message, dict) and message.get("role") == "user"
    ]
    scenario_prompts = {
        MCP_PROMPT,
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
        choices=("all", "sdk-default", "sdk-native", "sdk-minimal", "sdk-minimal-in-history", "sdk-mcp", "sdk-live", "runner"),
        default="all",
    )
    parser.add_argument("--exe", type=Path)
    parser.add_argument(
        "--installed-wheel",
        action="store_true",
        help="require a clean virtual environment containing matching installed SDK and runtime wheels",
    )
    args = parser.parse_args()
    if args.installed_wheel and args.exe is not None:
        parser.error("--installed-wheel resolves the wheel's own runtime and cannot be combined with --exe")
    if args.scenario == "sdk-live" and not args.installed_wheel:
        parser.error("--scenario sdk-live requires --installed-wheel")
    if args.scenario == "sdk-native" and not args.installed_wheel:
        parser.error("--scenario sdk-native requires --installed-wheel")
    if args.installed_wheel:
        args.exe = assert_installed_wheel_environment()
    if args.scenario in {"all", "sdk-minimal", "sdk-minimal-in-history", "runner"} and args.exe is None:
        parser.error("--exe is required for minimal and runner scenarios")
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

    if args.scenario in {"all", "sdk-minimal", "sdk-minimal-in-history"}:
        assert args.exe is not None
        assert_retired_sdk_minimal(args.exe.resolve())
    if args.scenario in {"sdk-minimal", "sdk-minimal-in-history"}:
        print("smoke-python-runtime: sdk-minimal refused")
        return

    with MockModel() as model:
        if args.scenario in {"all", "sdk-default"}:
            smoke_sdk_default(model.url)
        if args.scenario == "sdk-native" or (args.scenario == "all" and args.installed_wheel):
            assert args.exe is not None
            smoke_sdk_native(model.url, args.exe.resolve())
        if args.scenario in {"all", "sdk-mcp"}:
            smoke_sdk_mcp(model.url, None if args.exe is None else args.exe.resolve())
        if not MockModelHandler.requests:
            raise AssertionError("mock model endpoint received no requests")
    print(f"smoke-python-runtime: {args.scenario} passed")

def assert_installed_wheel_environment() -> Path:
    """Prove that this process imports matching non-editable wheel installations."""
    if sys.prefix == sys.base_prefix:
        raise AssertionError("installed-wheel smoke must run inside a virtual environment")
    if "PYTHONPATH" in os.environ:
        raise AssertionError("installed-wheel smoke requires PYTHONPATH to be unset")
    if "RSH_RUNTIME_MODE" in os.environ:
        raise AssertionError("installed-wheel smoke requires RSH_RUNTIME_MODE to be unset")

    repo_root = Path(__file__).resolve().parents[2]
    cwd = Path.cwd().resolve()
    if cwd.is_relative_to(repo_root):
        raise AssertionError(f"installed-wheel smoke must run outside the repository, got {cwd}")

    sdk_version = importlib.metadata.version("redspark-harness-sdk")
    runtime_version = importlib.metadata.version("redspark-harness-runtime-bin")
    if sdk_version != runtime_version:
        raise AssertionError(
            f"installed SDK/runtime versions differ: {sdk_version} != {runtime_version}"
        )
    expected_runtime_requirement = f"redspark-harness-runtime-bin=={sdk_version}"
    requirements = importlib.metadata.requires("redspark-harness-sdk") or []
    if expected_runtime_requirement not in requirements:
        raise AssertionError(
            f"installed SDK does not require {expected_runtime_requirement}: {requirements}"
        )

    prefix = Path(sys.prefix).resolve()
    imported: dict[str, Path] = {}
    for name in ("redspark_harness", "redspark_harness_runtime"):
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

    runtime_module = sys.modules["redspark_harness_runtime"]
    executable = runtime_module.bundled_runtime_path().resolve()
    runtime_package = imported["redspark_harness_runtime"].parent
    if not executable.is_relative_to(runtime_package):
        raise AssertionError(f"bundled runtime came from outside the installed runtime wheel: {executable}")
    runtime_files = importlib.metadata.files("redspark-harness-runtime-bin") or []
    if not any(Path(file).name == executable.name for file in runtime_files):
        raise AssertionError(f"runtime executable is absent from installed distribution records: {executable}")
    return executable

def smoke_sdk_live() -> None:
    """Run a real-model, tool-using two-turn task through installed wheels."""
    from redspark_harness import RedSparkHarness

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    base_url = os.environ.get("DEEPSEEK_BASE_URL")
    if not api_key:
        raise AssertionError("sdk-live requires DEEPSEEK_API_KEY")
    if not base_url:
        raise AssertionError("sdk-live requires an explicit DEEPSEEK_BASE_URL")

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-live-") as temporary:
        root = Path(temporary).resolve()
        rsh_home = root / "home"
        sessions = rsh_home / "sessions"
        marker = root / "live-api-marker.txt"
        session_id = "installed-wheel-live-api"
        shell_tool = "pwsh" if IS_WINDOWS else "bash"
        create_prompt = (
            f"Use the {shell_tool} tool to create the file at the absolute path below with exact UTF-8 "
            f"content {LIVE_API_SENTINEL}, with no newline or byte-order mark. "
            f"Then reply with exactly {LIVE_API_SENTINEL}.\n{marker}"
        )
        with RedSparkHarness(
            provider="deepseek-official",
            model="deepseek-v4-flash",
            cwd=str(root),
            rsh_home=str(rsh_home),
            env={
                "RSH_PERMISSION_MODE": "danger-full-access",
                "RSH_TELEMETRY_DISABLED": "1",
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
    from redspark_harness import RedSparkHarness

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-default-") as temporary:
        root = Path(temporary).resolve()
        rsh_home = root / "home"
        sessions = rsh_home / "sessions"
        with RedSparkHarness(
            provider="deepseek-official",
            model="smoke-model",
            cwd=str(root),
            rsh_home=str(rsh_home),
            env={
                "RSH_PERMISSION_MODE": "danger-full-access",
                "RSH_TELEMETRY_DISABLED": "1",
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
    env = {**os.environ, "RSH_HOME": str(home), "RSH_TELEMETRY_DISABLED": "1"}
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
    from redspark_harness import RedSparkHarness

    with RedSparkHarness(
        provider="fixture",
        model="fixture-model",
        cwd=str(cwd),
        rsh_home=str(home),
        profile="native-sdk",
        patches=(str(patch),),
        env={"NATIVE_SDK_FIXTURE_KEY": "fixture-key", "RSH_TELEMETRY_DISABLED": "1",
             "RSH_PERMISSION_MODE": "danger-full-access"},
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
            {"id": "request-context", "plugin": "@redspark/rsh-request-context", "scope": "root"},
            {"id": "skills", "plugin": "@redspark/rsh-skill", "scope": "root"},
            {"id": "skill-filesystem", "plugin": "@redspark/rsh-skill-filesystem", "scope": "root",
             "config": {"agentsHome": str(home), "dshHome": str(home), "watch": False}},
            {"id": "tool-skill", "plugin": "@redspark/rsh-tool-skill", "scope": "root"},
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
    from redspark_harness import RedSparkHarness

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
            with ThreadPoolExecutor(max_workers=1) as executor, RedSparkHarness(
                provider="fixture", model="fixture-model", cwd=str(cwd), rsh_home=str(home),
                profile="native-sdk", patches=(str(patch),), allowed_tools=("read_file", "write_file"),
                workspace_write_root=str(cwd),
                env={"NATIVE_SDK_FIXTURE_KEY": "fixture-key", "RSH_TELEMETRY_DISABLED": "1",
                     "RSH_PERMISSION_MODE": "workspace-write"},
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
            {"id": "policy", "plugin": "@redspark/rsh-fs-observation-policy", "scope": "root"},
            {"id": "file-tools", "plugin": "@redspark/rsh-tool-fs", "scope": "root"},
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

def assert_retired_sdk_minimal(executable: Path) -> None:
    """The packaged executable refuses the sdk-minimal profile name."""
    with tempfile.TemporaryDirectory(prefix="dsh-sdk-minimal-refused-") as temporary:
        root = Path(temporary).resolve()
        rsh_home = root / "home"
        rsh_home.mkdir()
        env = {**os.environ, "RSH_HOME": str(rsh_home)}
        checks = (
            (
                [str(executable), "--profile", "sdk-minimal", "--dump-config"],
                'profile "sdk-minimal" no longer boots',
            ),
            (
                [
                    str(executable), "--profile", "rescue",
                    "--from-default-profile", "sdk-minimal", "--dump-config",
                ],
                '--from-default-profile "sdk-minimal" no longer initializes',
            ),
        )
        for command, expected in checks:
            result = subprocess.run(
                command,
                cwd=root,
                env=env,
                text=True,
                capture_output=True,
                check=False,
                timeout=60,
            )
            if result.returncode == 0 or expected not in result.stderr or "use --profile sdk" not in result.stderr:
                raise AssertionError(
                    "sdk-minimal was not refused: "
                    f"command={command!r} returncode={result.returncode} "
                    f"stdout={result.stdout!r} stderr={result.stderr!r}"
                )
        for name in ("sdk-minimal", "rescue"):
            created = rsh_home / "profiles" / name
            if created.exists():
                raise AssertionError(f"refused profile name created {created}")

def smoke_sdk_mcp(base_url: str, executable: Path | None) -> None:
    """Discover and call an external stdio MCP tool through the packaged client."""
    from redspark_harness import RedSparkHarness

    with tempfile.TemporaryDirectory(prefix="dsh-sdk-mcp-") as temporary:
        root = Path(temporary).resolve()
        rsh_home = root / "home"
        sessions = rsh_home / "sessions"
        server_script = root / "mcp_server.py"
        server_script.write_text(MCP_SERVER_SCRIPT)
        ensure_native_sdk_profile(executable, rsh_home, root)
        patch = write_native_mcp_patch(root, server_script)
        discovery_log = server_script.with_suffix(".log")
        with RedSparkHarness(
            provider="deepseek-official",
            model="smoke-model",
            cwd=str(root),
            dsh_bin=None if executable is None else str(executable),
            rsh_home=str(rsh_home),
            profile="smoke-sdk",
            patches=(str(patch),),
            env={
                "RSH_PERMISSION_MODE": "danger-full-access",
                "RSH_TELEMETRY_DISABLED": "1",
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

def smoke_packaged_runner(executable: Path) -> None:
    """Exercise the private subprocess runner through the single-file entry."""
    with tempfile.TemporaryDirectory(prefix="dsh-packaged-runner-") as temporary:
        root = Path(temporary).resolve()
        target_script = (
            "import os,sys; "
            "ok = (os.getcwd() == os.environ['PACKAGED_RUNNER_EXPECTED_CWD'] "
            "and os.environ.get('RSH_SUBPROCESS_RUNNER') == 'target-collision-restored'); "
            "sys.exit(7 if ok else 9)"
        )
        if not IS_WINDOWS:
            request_path = root / "launch-request.json"
            target_env = dict(os.environ)
            target_env["RSH_SUBPROCESS_RUNNER"] = "target-collision-restored"
            target_env["PACKAGED_RUNNER_EXPECTED_CWD"] = str(root)
            request_path.write_text(
                json.dumps({"cwd": str(root), "env": target_env}),
                encoding="utf-8",
            )
            request_path.chmod(0o600)
            environment = dict(os.environ)
            environment["RSH_SUBPROCESS_RUNNER"] = str(request_path)
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
  env: { ...process.env, RSH_SUBPROCESS_RUNNER: 'windows' },
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
        RSH_SUBPROCESS_RUNNER: 'target-collision-restored',
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

if __name__ == "__main__":
    main()
