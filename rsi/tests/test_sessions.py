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

"""Sessions store runs; they do not decide how a run happens.

These tests drive the store with a stand-in runner. That is the point of the
Runner protocol: if these pass while rsi.agent is never imported, storage and
execution really are separable.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

from harness2.substrate.opencode import OPENCODE_SURFACE

from rsi.sessions import RunRecord, Runner, SessionError, SessionStore


class FakeResult:
    """The shape SessionStore.run reads off whatever it was given."""

    def __init__(self, task: str, final: str, steps: int = 1) -> None:
        self.task = task
        self.model = "fake/model"
        self.final = final
        self.error = ""
        self.seconds = 0.5
        self.steps = [object()] * steps

    @property
    def ok(self) -> bool:
        return not self.error and bool(self.steps)

    def transcript(self) -> str:
        return "[ACTION] finish({'answer': '" + self.final + "'})\n[FINAL] " + self.final

    def to_dict(self) -> dict:
        return {"task": self.task, "steps": len(self.steps)}


class FakeRunner:
    """Satisfies rsi.sessions.Runner without touching the network."""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.result_tokens = (0, 0)

    def run(self, task, workspace, harness, surface, *, on_step=None):
        self.calls.append({"task": task, "workspace": workspace, "harness": harness})
        r = FakeResult(task, "ok-" + str(len(self.calls)))
        r.prompt_tokens, r.completion_tokens = self.result_tokens
        r.stop_reason = "finish" if self.result_tokens[1] else ""
        return r


class SessionStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.sessions = SessionStore(self.root)
        self.session = self.sessions.create(title="t", model="fake/model")

    def test_create_makes_a_workspace(self):
        self.assertTrue(self.session.workspace_dir.is_dir())
        self.assertEqual(self.sessions.get(self.session.id).title, "t")

    def test_list_is_newest_first_and_counts_runs(self):
        runner = FakeRunner()
        self.sessions.run(self.session.id, "a", {}, OPENCODE_SURFACE, agent=runner)
        sessions = self.sessions.list()
        self.assertEqual(len(sessions), 1)
        self.assertEqual(len(sessions[0].runs), 1)

    def test_a_runner_without_on_event_is_still_accepted(self):
        """on_event is optional: a runner that stops at on_step must still run.

        Wiring the live hook by passing it unconditionally turned an optional
        feature into a requirement, and every existing runner broke with a
        TypeError instead of running.
        """
        rec = self.sessions.run(self.session.id, "do it", {}, OPENCODE_SURFACE,
                                agent=FakeRunner(),
                                on_event=lambda kind, data: None)
        self.assertTrue(rec.ok)

    def test_run_persists_transcript_and_meta(self):
        runner = FakeRunner()
        rec = self.sessions.run(self.session.id, "do it", {}, OPENCODE_SURFACE,
                                generation="g0001", agent=runner)
        self.assertIsInstance(rec, RunRecord)
        run_dir = self.session.runs_dir / rec.id
        self.assertIn("[FINAL] ok-1", (run_dir / "transcript.md").read_text())
        meta = json.loads((run_dir / "meta.json").read_text())
        self.assertEqual(meta["generation"], "g0001")
        self.assertEqual(meta["steps"], 1)

    def test_run_without_an_agent_is_refused(self):
        with self.assertRaises(SessionError) as ctx:
            self.sessions.run(self.session.id, "x", {}, OPENCODE_SURFACE)
        self.assertIn("needs an agent", str(ctx.exception))

    def test_system_prompt_is_written_when_given(self):
        runner = FakeRunner()
        rec = self.sessions.run(self.session.id, "x", {}, OPENCODE_SURFACE,
                                agent=runner, system_prompt="HELLO PROMPT")
        p = self.session.runs_dir / rec.id / "system_prompt.md"
        self.assertEqual(p.read_text(), "HELLO PROMPT")

    def test_the_runner_receives_the_workspace_and_harness(self):
        runner = FakeRunner()
        self.sessions.run(self.session.id, "x", {"a.md": "b"}, OPENCODE_SURFACE,
                          agent=runner)
        call = runner.calls[0]
        self.assertEqual(call["harness"], {"a.md": "b"})
        self.assertEqual(Path(call["workspace"].root), self.session.workspace_dir)

    def test_storage_works_without_importing_the_agent_module(self):
        """The separation claim, checked rather than asserted in a comment."""
        runner = FakeRunner()
        self.sessions.run(self.session.id, "x", {}, OPENCODE_SURFACE, agent=runner)
        # A fresh interpreter, so an earlier import elsewhere cannot mask this.
        import subprocess

        code = (
            "import sys;"
            "sys.path.insert(0, r'" + str(Path(__file__).resolve().parents[1]) + "');"
            "import rsi.sessions;"
            "print('rsi.agent' in sys.modules)"
        )
        out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
        self.assertEqual(out.stdout.strip(), "False", out.stderr)

    # -- run state ------------------------------------------------------

    def test_token_usage_lands_in_the_index(self):
        """Cost must be answerable from session.json, not from every meta.json."""
        runner = FakeRunner()
        runner.result_tokens = (120, 30)
        rec = self.sessions.run(self.session.id, "x", {}, OPENCODE_SURFACE,
                                agent=runner)
        self.assertEqual((rec.prompt_tokens, rec.completion_tokens), (120, 30))
        self.assertEqual(rec.tokens, 150)

        reloaded = self.sessions.get(self.session.id)
        self.assertEqual(reloaded.runs[0].tokens, 150)

    def test_a_runner_without_usage_is_still_accepted(self):
        """Runner is the contract; cost accounting stays optional."""
        class Bare(FakeRunner):
            def run(self, task, workspace, harness, surface, *, on_step=None):
                return FakeResult(task, "ok")

        rec = self.sessions.run(self.session.id, "x", {}, OPENCODE_SURFACE,
                                agent=Bare())
        self.assertEqual(rec.tokens, 0)

    def test_reindex_backfills_old_records(self):
        """Sessions written before run state existed must not read as zero forever."""
        runner = FakeRunner()
        rec = self.sessions.run(self.session.id, "x", {}, OPENCODE_SURFACE,
                                agent=runner)
        run_dir = self.session.runs_dir / rec.id
        (run_dir / "meta.json").write_text(json.dumps(
            {"transcript": {"prompt_tokens": 400, "completion_tokens": 40,
                            "stop_reason": "finish"}}
        ))

        # Simulate the older format: usage absent from session.json.
        s = self.sessions.get(self.session.id)
        s.runs[0].prompt_tokens = 0
        s.runs[0].completion_tokens = 0
        s.save()

        out = self.sessions.reindex()
        self.assertEqual(out["runs_filled"], 1)
        self.assertEqual(self.sessions.get(self.session.id).runs[0].tokens, 440)

    def test_unknown_session_is_refused(self):
        with self.assertRaises(SessionError):
            self.sessions.get("deadbeef")

    def test_files_cannot_escape_the_workspace(self):
        with self.assertRaises(SessionError):
            self.sessions.read(self.session.id, "../../../etc/passwd")


if __name__ == "__main__":
    unittest.main()
