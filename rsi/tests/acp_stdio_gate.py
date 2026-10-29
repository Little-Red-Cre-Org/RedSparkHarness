"""Start `rsi.acp_stdio` on real pipes with a stand-in executor.

The spawned-process gate needs the real transport, the real dispatch and the
real prompt relay, but not a real model: a unit test that needs the SDK, a
provider and a network round trip is a test that fails for reasons unrelated to
this transport.

`rsi.acp_stdio.main` has no injection hook and is not getting one -- a hook in
production code that exists only for a test is a hook that ships. So this script
is the entry point instead: it calls `serve_stdio` directly with the fake, which
is the same function `main` calls one frame later.

Prints nothing to stdout. The test reads stdout as ACP frames.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rsi import acp_stdio  # noqa: E402


class _Run:
    """The fields the prompt relay reads off a finished run."""

    def __init__(self, final: str) -> None:
        self.final = final
        self.error = ""
        self.steps: list[object] = []


class FakeBackend:
    """Emits one scripted event stream and returns it as a finished run."""

    kind = "fake"

    def start(self) -> None:
        pass

    def stop(self) -> None:
        pass

    def run(self, task, workspace, harness, surface, *, on_step=None, on_event=None,
            model=None, conversation=None, reasoning=None):
        events = [
            ("step.started", {"index": 0}),
            ("step.message", {"index": 0, "thinking": "considering", "assistant": ""}),
            ("tool.called", {"index": 0, "name": "probe", "arguments": {"x": 1}}),
            ("tool.result", {"index": 0, "name": "probe", "ok": True, "output": "fine"}),
            ("step.message", {"index": 0, "thinking": "", "assistant": "FAKE-ANSWER " + task}),
            ("run.finished", {"ok": True, "steps": 1, "stop_reason": "finish"}),
        ]
        for kind, data in events:
            if on_event is not None:
                on_event(kind, data)
        if on_step is not None:
            on_step(None)
        return _Run(final="FAKE-ANSWER " + task)


if __name__ == "__main__":
    home = sys.argv[1] if len(sys.argv) > 1 else ""
    acp_stdio.serve_stdio(home=home or None, backend_factory=FakeBackend)
