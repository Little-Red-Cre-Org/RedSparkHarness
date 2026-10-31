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

"""The reasoning level's route to the engine, and the config edit's effect.

Two pieces of the runner fail silently when they go wrong, which is why both
are exercised here rather than left to the integration run.

The level: the app-server accepts any non-empty string as an effort and falls
back to its own default when it does not recognise one (measured -- "bogus"
came back accepted, with no error). A level the model does not advertise would
therefore look applied while doing nothing, so the runner validates it against
the catalogue instead of forwarding it.

The config: a thread binds its provider at thread/start and never re-reads the
config. Measured against a live engine, repointing base_url at a dead port left
an existing thread answering normally while a fresh thread failed to connect.
An edit that did not drop the cached thread would run the new settings' task on
the old provider.

Neither check needs a model or a working provider, so the engine here is a stub
that records what it was asked to do. The logic under test is the real
AgentRunner.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rsi.agent import Workspace
from rsi.engine import AgentRunner, workspace_root

# One model with a level list that differs from every other model's, so a test
# that passes by accident on a shared vocabulary cannot pass here.
MODEL_ID = "acme/test-model"
LEVELS = ["low", "high"]
DEFAULT = "high"


def write_catalog(home: Path, *, levels: list[str] | None = None, default=DEFAULT) -> None:
    """A catalogue the real rsi.models.catalog can read from `home`.

    `levels=None` writes the standard list and `levels=[]` writes a model that
    offers none, which the catalogue reads as "one setting only" -- a different
    statement from a model it says nothing about.
    """
    names = LEVELS if levels is None else levels
    rows = [
        {
            "id": MODEL_ID,
            "display_name": "test-model \u00b7 acme",
            "supported_reasoning_levels": [{"effort": name} for name in names],
            "default_reasoning_level": default,
        }
    ]
    (home / "magpie-models.json").write_text(
        json.dumps({"models": rows}), encoding="utf-8"
    )


class StubWorkspace:
    """A workspace double, for the tests that only need a root to work in.

    Kept separate from `rsi.agent.Workspace`: that one resolves and creates its
    directory on construction, which is more than these cases need.
    """

    def __init__(self, root: Path) -> None:
        self.root = root


class WorkspaceRootTests(unittest.TestCase):
    """A run's working directory, whichever way the caller passes it.

    `Path` has its own `.root` -- the drive root on Windows -- so reading the
    attribute without checking the type would read a bare path as "\\". Every
    caller in this tree passes a Workspace, so the wrong reading never reached a
    run; a bare path is still an accepted argument, and these cases hold the
    distinction that keeps it working.
    """

    def test_a_bare_path_is_taken_as_the_workspace(self):
        where = Path("C:/runs/session-a/workspace")
        self.assertEqual(workspace_root(where), where)

    def test_a_bare_path_string_is_taken_as_the_workspace(self):
        self.assertEqual(workspace_root("C:/runs/session-a/workspace"), Path("C:/runs/session-a/workspace"))

    def test_a_workspace_object_is_read_through_its_root(self):
        where = Path("C:/runs/session-a/workspace")
        self.assertEqual(workspace_root(Workspace(where)), where.resolve())

    def test_a_path_is_not_read_through_its_own_root_attribute(self):
        """The mistake this guards: Path("C:/x").root is "\\", so reading the
        attribute off a path argument would point the run at the drive root."""
        where = Path("C:/runs/session-a/workspace")
        self.assertNotEqual(workspace_root(where), Path(where.root))


class StubEngine:
    """Records the JSON-RPC calls a runner makes, answers none of them.

    `subscribe` hands back a queue nobody writes to: the runner's consume loop
    reads it until its deadline, finds nothing, and settles the turn the way it
    would after an engine that went quiet.
    """

    def __init__(self) -> None:
        import queue

        self.calls: list[tuple[str, dict]] = []
        self.workspace_root = None
        self.audit_sink = None
        self._queue = queue.Queue()

    def call(self, method: str, params: dict | None = None, timeout: float | None = None):
        self.calls.append((method, params or {}))
        if method == "thread/start":
            return {"thread": {"id": "thread-1"}}
        if method == "turn/start":
            return {"turn": {"id": "turn-1"}}
        return {}

    def subscribe(self, thread_id: str):
        return self._queue

    def unsubscribe(self, thread_id: str, box) -> None:
        pass

    def bind_thread(self, thread_id: str, workdir) -> None:
        pass

    def params_for(self, method: str) -> dict:
        for name, params in self.calls:
            if name == method:
                return params
        raise AssertionError("no call to " + method + "; saw " + repr(self.calls))


class EffortTests(unittest.TestCase):
    """Levels the catalogue knows are passed through; others are not."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name)
        write_catalog(self.home)
        self.addCleanup(self._tmp.cleanup)

    def runner(self) -> AgentRunner:
        """A real runner bound to the temp home, with no process behind it."""
        return AgentRunner(engine=StubEngine(), home=self.home, timeout=0.2)

    def test_an_advertised_level_is_passed_through(self):
        self.assertEqual(self.runner()._resolve_effort("high", MODEL_ID), "high")
        self.assertEqual(self.runner()._resolve_effort("low", MODEL_ID), "low")

    def test_an_unadvertised_level_is_replaced_by_the_default(self):
        """The dangerous case: a level the model does not offer must not reach
        the engine, because the engine would accept it and quietly ignore it."""
        resolved = self.runner()._resolve_effort("bogus", MODEL_ID)
        self.assertNotEqual(resolved, "bogus")
        self.assertEqual(resolved, DEFAULT)

    def test_a_level_of_unknown_case_is_not_silently_accepted(self):
        # Level names are the catalogue's spelling. "HIGH" is a different string
        # and the engine's own matching is exact, so forwarding it changes
        # nothing while looking like it did.
        self.assertEqual(self.runner()._resolve_effort("HIGH", MODEL_ID), DEFAULT)

    def test_no_level_asks_for_nothing(self):
        """Empty means "leave the engine's default alone", not "medium"."""
        self.assertEqual(self.runner()._resolve_effort("", MODEL_ID), "")
        self.assertEqual(self.runner()._resolve_effort(None, MODEL_ID), "")
        self.assertEqual(self.runner()._resolve_effort("   ", MODEL_ID), "")

    def test_an_unlisted_model_says_nothing(self):
        """A model the catalogue does not describe has no levels to check
        against, and an unverifiable level is not sent."""
        self.assertEqual(self.runner()._resolve_effort("bogus", "nobody/knows-me"), "")

    def test_a_model_that_offers_no_levels_says_nothing(self):
        """`levels=[]` is a real statement -- the model has one setting -- and
        the requested level is not one of them."""
        write_catalog(self.home, levels=[])
        self.assertEqual(self.runner()._resolve_effort("bogus", MODEL_ID), "")

    def test_an_unreadable_catalogue_says_nothing(self):
        """rsi.models.catalog never raises: an unreadable home reads as a
        catalogue with no models, so nothing can be verified and nothing is
        sent. This is the branch `except` used to cover, without the except."""
        runner = AgentRunner(engine=StubEngine(), home=self.home / "no-such-home", timeout=0.2)
        self.assertEqual(runner._resolve_effort("high", MODEL_ID), "")

    def test_the_turn_carries_the_resolved_effort(self):
        """End to end through run(): what the catalogue approved is what the
        turn asks for, under the app-server's own field name."""
        runner = self.runner()
        runner.run("do nothing", StubWorkspace(self.home), {}, surface=None, model=MODEL_ID, reasoning="low")
        self.assertEqual(runner.engine.params_for("turn/start")["effort"], "low")

    def test_an_unadvertised_level_sends_the_default_instead(self):
        runner = self.runner()
        runner.run("do nothing", StubWorkspace(self.home), {}, surface=None, model=MODEL_ID, reasoning="bogus")
        self.assertEqual(runner.engine.params_for("turn/start")["effort"], DEFAULT)

    def test_no_level_sends_no_effort_field(self):
        """Absent, not empty: an empty string is not a value the engine was
        asked about, and leaving the field out is what keeps the default."""
        runner = self.runner()
        runner.run("do nothing", StubWorkspace(self.home), {}, surface=None, model=MODEL_ID)
        self.assertNotIn("effort", runner.engine.params_for("turn/start"))

    def test_every_advertised_level_reaches_the_turn(self):
        """Each level a model actually offers survives the trip intact.

        The cases above prove a level is checked; this proves the check does
        not narrow `low`/`high`/`xhigh` into one another or into the default,
        which is the failure a single-level test cannot see.
        """
        write_catalog(self.home, levels=["low", "high", "xhigh"], default="high")
        for level in ("low", "high", "xhigh"):
            with self.subTest(level=level):
                runner = self.runner()
                runner.run(
                    "do nothing", StubWorkspace(self.home), {},
                    surface=None, model=MODEL_ID, reasoning=level,
                )
                self.assertEqual(runner.engine.params_for("turn/start")["effort"], level)

    def test_a_level_one_model_offers_is_refused_on_another(self):
        """Levels are per model: `xhigh` reaching a model that lists only
        low/high is refused here, not silently forwarded for the engine to
        ignore. This is the defence that has to hold because codex accepts an
        unknown level without complaint."""
        runner = self.runner()
        runner.run("do nothing", StubWorkspace(self.home), {}, surface=None, model=MODEL_ID, reasoning="xhigh")
        self.assertEqual(runner.engine.params_for("turn/start")["effort"], DEFAULT)


class ConfigChangeTests(unittest.TestCase):
    """A cached thread belongs to the config it was started under."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name)
        write_catalog(self.home)
        self.config = self.home / "config.toml"
        self.config.write_text('model = "acme/test-model"\n', encoding="utf-8")
        self.addCleanup(self._tmp.cleanup)

    def runner(self) -> AgentRunner:
        return AgentRunner(engine=StubEngine(), home=self.home, timeout=0.2)

    def test_the_stamp_follows_the_provider(self):
        runner = self.runner()
        first = runner._config_stamp()
        self.assertNotEqual(first, (0, 0))
        self.config.write_text(
            'model = "acme/test-model"\nmodel_provider = "other"\n', encoding="utf-8"
        )
        self.assertNotEqual(runner._config_stamp(), first)

    def test_a_comment_only_edit_is_not_a_config_change(self):
        """The narrowing is the point: a thread is only bound to the keys
        thread/start reads, so an edit to anything else must not cost this
        conversation its earlier turns."""
        runner = self.runner()
        first = runner._config_stamp()
        self.config.write_text(
            'model = "acme/test-model"\n# a note, not a setting\n', encoding="utf-8"
        )
        self.assertEqual(runner._config_stamp(), first)

    def test_an_approval_policy_edit_keeps_the_thread(self):
        """approvalPolicy is sent per turn, so the running thread picks it up
        without being replaced."""
        runner = self.runner()
        runner.run("first", StubWorkspace(self.home), {}, surface=None, model=MODEL_ID)
        self.config.write_text(
            'model = "acme/test-model"\napproval_policy = "on-request"\n', encoding="utf-8"
        )
        runner.run("second", StubWorkspace(self.home), {}, surface=None, model=MODEL_ID)
        starts = [p for name, p in runner.engine.calls if name == "thread/start"]
        self.assertEqual(len(starts), 1, "an approval-policy edit must not open a new thread")

    def test_a_provider_base_url_edit_drops_the_thread(self):
        """The case the whole narrowing exists for: the thread holds the
        connection, so repointing base_url has to reach a new thread."""
        self.config.write_text(
            'model = "acme/test-model"\n'
            'model_provider = "magpie"\n'
            '[model_providers.magpie]\n'
            'base_url = "http://127.0.0.1:1/v1"\n',
            encoding="utf-8",
        )
        runner = self.runner()
        runner.run("first", StubWorkspace(self.home), {}, surface=None, model=MODEL_ID)
        self.config.write_text(
            'model = "acme/test-model"\n'
            'model_provider = "magpie"\n'
            '[model_providers.magpie]\n'
            'base_url = "http://127.0.0.1:2/v1"\n',
            encoding="utf-8",
        )
        runner.run("second", StubWorkspace(self.home), {}, surface=None, model=MODEL_ID)
        starts = [p for name, p in runner.engine.calls if name == "thread/start"]
        self.assertEqual(len(starts), 2, "a base_url edit must open a new thread")

    def test_unparseable_config_falls_back_to_the_whole_file(self):
        """A config we cannot read is treated as changed rather than unchanged:
        one extra thread costs less than running new settings on the connection
        they were meant to replace."""
        runner = self.runner()
        first = runner._config_stamp()
        self.config.write_text("this is not toml [[[\n", encoding="utf-8")
        after = runner._config_stamp()
        self.assertNotEqual(after, first)
        self.assertEqual(len(after), 2, "the fallback is the file's (mtime_ns, size)")

    def test_a_missing_config_is_not_an_error(self):
        runner = self.runner()
        self.config.unlink()
        self.assertEqual(runner._config_stamp(), (0, 0))

    def test_an_edited_config_drops_the_cached_thread(self):
        runner = self.runner()
        runner._thread_ids["session-a"] = "thread-1"
        runner._config_stamp_seen = (0, 0)  # as if the thread predates any config
        runner._forget_threads_if_config_changed()
        self.assertEqual(runner._thread_ids, {})

    def test_an_unchanged_config_keeps_the_cached_thread(self):
        """The converse matters as much: dropping threads on every run would
        silently discard the conversation's earlier turns each time."""
        runner = self.runner()
        runner._thread_ids["session-a"] = "thread-1"
        runner._config_stamp_seen = runner._config_stamp()
        runner._forget_threads_if_config_changed()
        self.assertEqual(runner._thread_ids, {"session-a": "thread-1"})

    def test_a_run_after_an_edit_starts_a_new_thread(self):
        """The end-to-end statement: the second run is not the first one."""
        runner = self.runner()
        runner.run("first", StubWorkspace(self.home), {}, surface=None, model=MODEL_ID)
        self.assertEqual(runner.engine.params_for("thread/start")["cwd"], str(self.home))

        self.config.write_text(
            'model = "acme/test-model"\nmodel_provider = "other"\n', encoding="utf-8"
        )
        runner.run("second", StubWorkspace(self.home), {}, surface=None, model=MODEL_ID)
        starts = [p for name, p in runner.engine.calls if name == "thread/start"]
        self.assertEqual(len(starts), 2, "an edited config must open a fresh thread")

    def test_no_edit_reuses_the_thread(self):
        """One thread per conversation is the reason the cache exists; a test
        that only proves the invalidation would not notice a cache that never
        worked at all."""
        runner = self.runner()
        runner.run("first", StubWorkspace(self.home), {}, surface=None, model=MODEL_ID)
        runner.run("second", StubWorkspace(self.home), {}, surface=None, model=MODEL_ID)
        starts = [p for name, p in runner.engine.calls if name == "thread/start"]
        self.assertEqual(len(starts), 1, "an unchanged config must reuse the thread")

    def test_a_running_turn_keeps_its_steering_handle(self):
        """Clearing the reusable-thread map must not take steering away from a
        turn that is still running: that map holds live turn ids."""
        runner = self.runner()
        runner._thread_ids["session-a"] = "thread-1"
        runner._threads["session-a"] = ("thread-1", "turn-1")
        runner._config_stamp_seen = (0, 0)
        runner._forget_threads_if_config_changed()
        self.assertEqual(runner._thread_ids, {})
        self.assertEqual(runner._threads["session-a"], ("thread-1", "turn-1"))


if __name__ == "__main__":
    unittest.main()
