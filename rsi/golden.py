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

"""A small, real task used to prove a candidate harness still works.

The adoption gate's L2/L3 levels need to *run* a harness, not just read it. A benchmark
adapter from `harness2.benchmarks` would do that, but it drags in Docker, Pandoc, cloud
credentials and a POSIX process group -- none of which a laptop needs in order to answer
"does this candidate still do the job?".

This is the smallest thing that answers it honestly:

* the task is real work with a checkable answer (sum a signed CSV, print a total);
* the harness supplies the SCRIPT that does the work, so editing the harness changes the
  answer -- a no-op harness and a fixed harness are distinguishable by their output;
* execution is a subprocess with a wall timeout and a process-group kill, so a candidate
  that loops forever is stopped rather than hanging the gate.

It is deliberately *not* a sandbox. A subprocess can still do anything the user can do.
See `rsi.gate` for where that boundary is stated.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from harness2.core import tree as harness_tree
from harness2.core.tree import SurfaceSpec, Tree

SCRIPT_REL = "scripts/summarize.py"


@dataclass(frozen=True)
class GoldenResult:
    """What one run of a golden task produced."""

    ok: bool
    stdout: str = ""
    stderr: str = ""
    returncode: int | None = None
    timed_out: bool = False
    seconds: float = 0.0
    error: str = ""

    @property
    def summary(self) -> str:
        if self.timed_out:
            return f"timed out after {self.seconds:.1f}s"
        if self.error:
            return self.error
        if not self.ok:
            tail = (self.stderr or self.stdout).strip().splitlines()
            return f"exit {self.returncode}: {tail[-1][:160] if tail else '(no output)'}"
        return self.stdout.strip()


def kill_group(proc: subprocess.Popen) -> None:
    """Kill a process and its children, POSIX and Windows.

    Harness2's benchmark adapters use `os.killpg`, which does not exist on Windows. This is
    the portable equivalent used by the gate. `start_new_session` is a no-op on Windows, so
    the two branches are genuinely different mechanisms, not one wrapped twice.
    """
    if os.name == "posix":
        import signal

        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError, OSError):
            proc.kill()
    else:  # Windows: taskkill walks the parent/child tree
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
            capture_output=True,
            check=False,
        )
        try:
            proc.kill()
        except OSError:
            pass


@dataclass
class GoldenTask:
    """One runnable check: a CSV input and the total a correct harness must print."""

    task_id: str
    csv_body: str
    expected: str
    timeout: float = 30.0

    def run(self, surface: SurfaceSpec, tree: Tree) -> GoldenResult:
        """Execute `tree` against this task in a throwaway directory."""
        import time

        start = time.time()
        if SCRIPT_REL not in tree:
            return GoldenResult(ok=False, error=f"harness has no {SCRIPT_REL}")

        with tempfile.TemporaryDirectory(prefix="rsi-golden-") as tmp:
            root = Path(tmp)
            harness_dir = root / "harness"
            harness_dir.mkdir()
            # Write the candidate's own files, byte-identical, so the run is the harness.
            for rel, body in tree.items():
                p = harness_dir / harness_tree.normalize_rel(rel)
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(str(body), encoding="utf-8", newline="\n")

            csv_path = root / "input.csv"
            csv_path.write_text(self.csv_body, encoding="utf-8", newline="\n")

            cmd = [sys.executable, str(harness_dir / SCRIPT_REL), str(csv_path)]
            popen_kw = {"start_new_session": True} if os.name == "posix" else {}
            try:
                proc = subprocess.Popen(
                    cmd,
                    cwd=str(harness_dir),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    **popen_kw,
                )
            except OSError as exc:
                return GoldenResult(ok=False, error=f"could not start: {exc}")

            try:
                out, err = proc.communicate(timeout=self.timeout)
            except subprocess.TimeoutExpired:
                kill_group(proc)
                try:
                    out, err = proc.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    out, err = "", ""
                return GoldenResult(
                    ok=False,
                    stdout=out or "",
                    stderr=err or "",
                    returncode=proc.returncode,
                    timed_out=True,
                    seconds=time.time() - start,
                    error=f"exceeded the {self.timeout:.0f}s wall timeout",
                )

            elapsed = time.time() - start
            return GoldenResult(
                ok=proc.returncode == 0,
                stdout=out or "",
                stderr=err or "",
                returncode=proc.returncode,
                seconds=elapsed,
                error="" if proc.returncode == 0 else f"exit {proc.returncode}",
            )

    def matches(self, result: GoldenResult) -> bool:
        """Whether a run produced the expected answer."""
        return result.ok and result.stdout.strip() == self.expected.strip()

    def looks_like_answer(self, result: GoldenResult) -> bool:
        """Whether a run at least produced a total, correct or not.

        Used by L3 when the live harness is itself wrong about a task: a candidate that
        prints nothing, crashes, or prints unrelated text is not "no worse", it is noise.
        The shape is deliberately loose -- `Total: <number>` -- so it measures "tried to
        answer" and not "happened to agree with us".
        """
        if not result.ok:
            return False
        import re

        return bool(re.search(r"Total:\s*-?\d+(?:\.\d+)?", result.stdout))


def default_tasks() -> list[GoldenTask]:
    """Two small ledgers with credits, so a sign-blind or filter-happy script is caught.

    Both totals are affected by the sign of the negative rows, which is exactly the mistake
    the demo harness makes; neither can be passed by hard-coding one number.
    """
    return [
        GoldenTask(
            task_id="golden-signed-a",
            csv_body="amount\n100.25\n-20.10\n5.00\n",
            expected="Total: 85.15",
        ),
        GoldenTask(
            task_id="golden-signed-b",
            csv_body="amount\n35.50\n-10.25\n-5.00\n",
            expected="Total: 20.25",
        ),
    ]


__all__ = ["GoldenResult", "GoldenTask", "default_tasks", "kill_group", "SCRIPT_REL"]
