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

"""Closing the window must also close the engine behind it.

The engine is not the process Popen returns. On Windows, `codex` on PATH is a
batch shim that starts node, which starts the real engine, so terminating the
owned process ends the shim and leaves a grandchild running with nothing left
holding a handle to it. That was measured, not theorised: after a closed
window, one engine with a `node.exe` parent was still alive and still holding
its workspace open.

These tests use a throwaway process tree shaped the same way -- a parent that
spawns a child which outlives it -- because the point is the shape, not the
engine. A run that needs a model is not a test.
"""

import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from rsi.engine import _end_process


def _alive(pid: int) -> bool:
    """Whether a pid is still running, without importing a platform module."""
    if os.name == "nt":
        out = subprocess.run(
            ["tasklist", "/FI", "PID eq " + str(pid), "/NH"],
            capture_output=True,
            text=True,
        )
        return str(pid) in (out.stdout or "")
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


class EndProcessTests(unittest.TestCase):
    def test_a_child_started_by_the_launcher_does_not_outlive_close(self):
        """The failure that was measured: the grandchild survived close."""
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / "child.pid"
            # A parent that starts a long-lived child and then waits. This is
            # the shim shape: the process Popen owns is not the one doing work.
            script = (
                "import pathlib, subprocess, sys, time\n"
                "p = subprocess.Popen([sys.executable, '-c',"
                " 'import time; time.sleep(120)'])\n"
                "pathlib.Path(sys.argv[1]).write_text(str(p.pid))\n"
                "time.sleep(120)\n"
            )
            proc = subprocess.Popen(
                [sys.executable, "-c", script, str(marker)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            try:
                deadline = time.time() + 20
                while time.time() < deadline and not marker.exists():
                    time.sleep(0.05)
                self.assertTrue(marker.exists(), "the child never started")
                child = int(marker.read_text().strip())
                self.assertTrue(_alive(child), "the child should be running")
                # Without this the test proves nothing: if the launcher has
                # already exited, there is no tree left to end and the
                # assertion below passes for the wrong reason.
                self.assertIsNone(
                    proc.poll(), "the launcher exited before close() was called"
                )

                _end_process(proc)

                deadline = time.time() + 20
                while time.time() < deadline and _alive(child):
                    time.sleep(0.05)
                self.assertFalse(
                    _alive(child),
                    "the child outlived close; the tree was not ended",
                )
            finally:
                if proc.poll() is None:
                    proc.kill()

    def test_closing_an_already_finished_process_is_harmless(self):
        """close() runs on every teardown path, including ones already gone."""
        proc = subprocess.Popen(
            [sys.executable, "-c", "pass"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        proc.wait(timeout=30)
        _end_process(proc)  # must not raise
        self.assertIsNotNone(proc.poll())


if __name__ == "__main__":
    unittest.main()
