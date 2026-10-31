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

"""The executor seam, tested without the executor.

Nothing here imports OpenHands. That is the point of the module and therefore
the first thing worth pinning: this file runs on the interpreter the rest of the
suite uses, which has no SDK in it, so an import that crept up to module scope
fails here rather than on a machine that happens to have the SDK installed.

The second thing worth pinning is the event vocabulary. `on_event` is a wire
between an executor and everything that watches runs, and a translator that
invents a kind would show up as a blank pane in the window rather than as an
error. A wrong kind is refused here, out loud.
"""

from __future__ import annotations

import inspect
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

from rsi import backend
from rsi.backend import (
    EVENT_KINDS,
    Backend,
    BackendError,
    CodexBackend,
    OpenHandsBackend,
    harness_prefix,
    make_backend,
    workspace_root,
)
from rsi.oh_config import ConfigError
from rsi.sessions import Runner


class _Workspace:
    """The one field `workspace_root` is allowed to read."""

    def __init__(self, root: Path) -> None:
        self.root = root


class WorkspaceTests(unittest.TestCase):
    def test_a_bare_path_is_the_directory_itself(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(workspace_root(tmp), Path(tmp))

    def test_a_workspace_object_is_its_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(workspace_root(_Workspace(Path(tmp))), Path(tmp))

    def test_a_path_object_is_not_read_as_its_drive_root(self) -> None:
        """`Path` has a `.root` of its own, and on Windows it is `D:\\`.

        Reading the attribute instead of the type is how "D:\\proj" becomes
        "D:\\" and a run writes to a drive root. The distinction is the whole
        reason this function exists rather than a `getattr` at the call site.
        """
        path = Path("D:/proj") if Path("D:/").drive else Path("/proj")
        self.assertEqual(workspace_root(path), path)

    def test_an_object_with_no_root_is_refused_by_name(self) -> None:
        with self.assertRaises(BackendError) as caught:
            workspace_root(object())
        self.assertIn("has no root", str(caught.exception))


class HarnessPrefixTests(unittest.TestCase):
    def test_the_documents_come_in_the_engine_order(self) -> None:
        text = harness_prefix(
            {"LongTermMEMORY.md": "m", "systemprompt.md": "s", "guardrails.md": "g"}
        )
        self.assertLess(text.index("systemprompt.md"), text.index("guardrails.md"))
        self.assertLess(text.index("guardrails.md"), text.index("LongTermMEMORY.md"))

    def test_a_blank_document_contributes_nothing(self) -> None:
        self.assertEqual(harness_prefix({"systemprompt.md": "   "}), "")

    def test_no_harness_is_the_empty_string_not_a_heading(self) -> None:
        """An empty heading tells the model a file exists and is blank."""
        self.assertEqual(harness_prefix({}), "")


class VocabularyTests(unittest.TestCase):
    def test_the_eight_kinds_are_the_ones_the_engine_emits(self) -> None:
        self.assertEqual(
            set(EVENT_KINDS),
            {
                "step.started",
                "step.message",
                "tool.called",
                "tool.result",
                "plan.updated",
                "model.retry",
                "run.finished",
                "approval.decided",
            },
        )


class _Translator:
    """A stand-in for `rsi.oh_events` that answers whatever the test wants."""

    def __init__(self, answer: Any) -> None:
        self.answer = answer

    def translate(self, event: Any) -> Any:
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


class _Thoughtful(_Translator):
    """A stand-in that also answers `thinking_of`, the way `oh_events` does."""

    def __init__(self, answer: Any, thought: Any = "") -> None:
        super().__init__(answer)
        self.thought = thought

    def thinking_of(self, event: Any) -> str:
        if isinstance(self.thought, Exception):
            raise self.thought
        return self.thought


class FeedTests(unittest.TestCase):
    """What one SDK event turns into on the way out."""

    def setUp(self) -> None:
        self.seen: list[tuple[str, dict]] = []
        self.turn = backend._Turn()

    def feed(self, answer: Any) -> None:
        backend._feed(_Translator(answer), object(), self.emit, self.turn)

    def feed_thought(self, answer: Any, thought: Any) -> None:
        backend._feed(_Thoughtful(answer, thought), object(), self.emit, self.turn)

    def emit(self, kind: str, data: dict) -> None:
        self.seen.append((kind, data))

    def test_a_translated_event_is_emitted_as_the_translator_said(self) -> None:
        self.feed(("step.message", {"index": 0, "thinking": "", "assistant": "hi"}))
        self.assertEqual(self.seen, [("step.message", {"index": 0, "thinking": "", "assistant": "hi"})])

    def test_an_ignored_event_emits_nothing(self) -> None:
        self.feed(None)
        self.assertEqual(self.seen, [])

    def test_an_unknown_kind_is_refused_rather_than_emitted(self) -> None:
        self.feed(("step.whatever", {}))
        self.assertEqual([kind for kind, _ in self.seen], ["model.retry"])
        self.assertIn("unknown event", self.seen[0][1]["reason"])

    def test_a_raising_translator_becomes_one_reported_event(self) -> None:
        """The callback runs inside SDK dispatch; an exception there loses the run."""
        self.feed(ValueError("bad payload"))
        self.assertEqual([kind for kind, _ in self.seen], ["model.retry"])
        self.assertIn("bad payload", self.seen[0][1]["reason"])

    def test_a_message_delta_lands_in_the_turn(self) -> None:
        self.feed(("step.message", {"index": 0, "thinking": "hm", "assistant": "ab"}))
        self.feed(("step.message", {"index": 0, "thinking": "", "assistant": "cd"}))
        self.assertEqual(self.turn.thinking, ["hm"])
        self.assertEqual(self.turn.assistant, ["ab", "cd"])

    def test_a_tool_call_and_its_result_land_in_the_turn(self) -> None:
        self.feed(("tool.called", {"index": 0, "name": "terminal", "arguments": {"cmd": "ls"}}))
        self.feed(("tool.result", {"index": 0, "name": "terminal", "ok": False, "output": "no"}))
        self.assertEqual(self.turn.calls, [{"name": "terminal", "arguments": {"cmd": "ls"}}])
        self.assertEqual(self.turn.results, [{"output": "no", "error": True}])

    def test_a_result_without_output_is_still_a_result(self) -> None:
        self.feed(("tool.result", {"index": 0, "name": "terminal", "ok": True}))
        self.assertEqual(self.turn.results, [{"output": "", "error": False}])

    def test_the_finish_tool_carries_the_agent_answer(self) -> None:
        """OpenHands' agent answers by calling `finish`, not as a message.

        A run that only ever called `finish` used to settle with an empty final,
        so the window drew "完成" above nothing at all -- observed on a real run
        that had created its file and reported the byte count.
        """
        self.feed(("tool.result", {"index": 0, "name": "finish", "ok": True, "output": "  24 bytes  "}))
        self.assertEqual(self.turn.answer, ["24 bytes"])

    def test_a_failed_finish_is_not_an_answer(self) -> None:
        self.feed(("tool.result", {"index": 0, "name": "finish", "ok": False, "output": "refused"}))
        self.assertEqual(self.turn.answer, [])

    def test_another_tool_never_becomes_the_answer(self) -> None:
        """Only `finish` speaks for the agent; a terminal's output does not."""
        self.feed(("tool.result", {"index": 0, "name": "terminal", "ok": True, "output": "hi"}))
        self.assertEqual(self.turn.answer, [])

    def test_reasoning_on_a_call_is_emitted_before_the_call(self) -> None:
        """The SDK stamps reasoning on the action, so the call is what carries it.

        A reader shows reasoning above the work, so the order here is the
        rendering, not a detail: reasoning emitted after the call would describe
        work that already appeared.
        """
        self.feed_thought(
            ("tool.called", {"index": 0, "name": "terminal", "arguments": {"brief": "ls"}}),
            "I should look first.",
        )
        self.assertEqual(
            self.seen,
            [
                ("step.message", {"index": 0, "thinking": "I should look first.", "assistant": ""}),
                ("tool.called", {"index": 0, "name": "terminal", "arguments": {"brief": "ls"}}),
            ],
        )
        self.assertEqual(self.turn.thinking, ["I should look first."])

    def test_no_reasoning_means_no_extra_line(self) -> None:
        """Only the first action of a response carries it; the rest must be quiet."""
        self.feed_thought(
            ("tool.called", {"index": 0, "name": "terminal", "arguments": {"brief": "ls"}}),
            "",
        )
        self.assertEqual([kind for kind, _ in self.seen], ["tool.called"])

    def test_reasoning_is_not_emitted_for_anything_but_a_call(self) -> None:
        """A message already carries its own thinking, so doubling it would repeat."""
        self.feed_thought(("tool.result", {"index": 0, "name": "terminal", "ok": True}), "hm")
        self.assertEqual([kind for kind, _ in self.seen], ["tool.result"])

    def test_a_translator_without_thinking_contributes_nothing(self) -> None:
        self.feed(("tool.called", {"index": 0, "name": "terminal", "arguments": {}}))
        self.assertEqual([kind for kind, _ in self.seen], ["tool.called"])

    def test_unreadable_reasoning_does_not_stop_the_run(self) -> None:
        self.feed_thought(
            ("tool.called", {"index": 0, "name": "terminal", "arguments": {}}),
            ValueError("bad thought"),
        )
        self.assertEqual([kind for kind, _ in self.seen], ["model.retry", "tool.called"])
        self.assertIn("reasoning could not be read", self.seen[0][1]["reason"])


class SeamTests(unittest.TestCase):
    def test_both_backends_name_every_keyword_the_protocol_names(self) -> None:
        """A swap is a change of class, so a keyword may not go missing.

        Checked against the Protocol rather than against a copied literal:
        `sessions.Runner` is the thing a caller holds, and it is the thing that
        grows a parameter next.
        """
        wanted = set(inspect.signature(Runner.run).parameters) - {"self"}
        for cls in (CodexBackend, OpenHandsBackend):
            got = set(inspect.signature(cls.run).parameters) - {"self"}
            self.assertEqual(wanted, got, cls.__name__)

    def test_both_backends_are_acceptances_of_the_runner_protocol(self) -> None:
        self.assertIsInstance(Backend, type)
        for name in set(inspect.signature(Runner.run).parameters) - {"self"}:
            self.assertIn(name, inspect.signature(Backend.run).parameters)

    def test_an_unknown_executor_lists_the_ones_that_exist(self) -> None:
        with self.assertRaises(BackendError) as caught:
            make_backend("codex")
        self.assertIn("engine and openhands", str(caught.exception))

    def test_the_codex_backend_answers_with_the_engine_kind(self) -> None:
        self.assertEqual(make_backend("engine").kind, "engine")
        self.assertEqual(OpenHandsBackend.kind, "openhands")


class WithoutTheSdkTests(unittest.TestCase):
    """The behaviours that must hold on an interpreter with no OpenHands.

    Each case pins the behaviour by removing the dependency rather than by
    relying on this interpreter not having it: the SDK lives in the project's
    other venv, so a test that read the environment would turn red or green
    depending on which interpreter ran it.
    """

    def test_importing_this_module_does_not_import_openhands(self) -> None:
        """No top-level import may name the SDK.

        Checked on the source rather than on `sys.modules` because the modules
        already loaded by the rest of the suite would make the answer depend on
        test order. An indented import is the late one and is allowed; an
        unindented one runs when `rsi` is imported, on interpreters that have no
        SDK in them.
        """
        source = Path(backend.__file__).read_text(encoding="utf-8")
        top_level = [
            line
            for line in source.splitlines()
            if line.startswith(("import ", "from ")) and "openhands" in line
        ]
        self.assertEqual(top_level, [])

    def test_building_an_openhands_backend_without_the_sdk_names_the_sdk(self) -> None:
        with mock.patch.dict(sys.modules, {"openhands": None, "openhands.sdk": None}):
            with self.assertRaises(BackendError) as caught:
                make_backend("openhands", home=".")
        message = str(caught.exception)
        self.assertIn("openhands", message)
        self.assertIn("not installed", message)

    def test_a_run_stops_at_the_missing_translator_not_at_the_sdk(self) -> None:
        """The order of the two checks is a decision, so it is pinned.

        A missing translator reported as an SDK ImportError from inside a
        pydantic model reads like a bug in this file; reported as a missing
        module it reads like work that is not done yet. The translator is
        removed here instead of being absent, so this stays true once it exists.
        """
        with tempfile.TemporaryDirectory() as tmp:
            runner = OpenHandsBackend(home=tmp)
            seen: list[tuple[str, dict]] = []
            with mock.patch.object(backend, "_translator", side_effect=BackendError("no translator")):
                run = runner.run(
                    "say hi",
                    Path(tmp),
                    {},
                    None,
                    on_event=lambda kind, data: seen.append((kind, data)),
                )
        self.assertEqual(run.stop_reason, "error")
        self.assertIn("no translator", run.error)
        self.assertEqual([kind for kind, _ in seen], ["run.finished"])

    def test_start_reports_a_config_it_cannot_use_before_a_run_needs_it(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            runner = OpenHandsBackend(home=tmp)
            with self.assertRaises(BackendError) as caught:
                runner.start()
        self.assertIsInstance(caught.exception.__cause__, ConfigError)

    def test_start_is_idempotent_and_stop_clears_it(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "config.toml").write_text(
                'model_provider = "a"\nmodel = "m"\n'
                '[model_providers.a]\nbase_url = "http://x.test/v1"\n'
                'experimental_bearer_token = "k"\n',
                encoding="utf-8",
            )
            runner = OpenHandsBackend(home=tmp)
            runner.start()
            runner.start()
            self.assertTrue(runner._started)
            runner.stop()
            self.assertFalse(runner._started)
            self.assertEqual(runner._conversations, {})


class SettleTests(unittest.TestCase):
    """What a run reports about itself when the conversation simply stops.

    `_conversation` and `_send` are replaced rather than the SDK, so these run on
    the interpreter the rest of the suite uses. The case they cover was found by
    watching a real run: a completed turn was reported as `stop_reason: timeout`
    with `ok: false`, because nothing set a reason and the settle step read the
    absence as a turn that never ended.
    """

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.seen: list[tuple[str, dict]] = []
        self.runner = OpenHandsBackend(home=self.tmp.name)

    def patch(self, send: Any = None) -> Any:
        runner = self.runner
        conversation = object()
        patches = [
            mock.patch.object(backend, "_translator", return_value=_Translator(None)),
            mock.patch.object(runner, "_conversation", return_value=conversation),
            mock.patch.object(runner, "_send", side_effect=send or (lambda *a, **k: None)),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        return conversation

    def go(self) -> Any:
        return self.runner.run(
            "say hi",
            Path(self.tmp.name),
            {},
            None,
            on_event=lambda kind, data: self.seen.append((kind, data)),
        )

    def test_a_stopped_conversation_is_a_finished_run(self) -> None:
        self.patch()
        run = self.go()
        self.assertEqual(run.stop_reason, "finish")
        self.assertEqual(run.error, "")
        self.assertTrue(run.ok)
        finished = [data for kind, data in self.seen if kind == "run.finished"]
        self.assertEqual(len(finished), 1)
        self.assertTrue(finished[0]["ok"])
        self.assertEqual(finished[0]["stop_reason"], "finish")
        self.assertEqual(finished[0]["error"], "")

    def test_a_failing_send_is_an_error_not_a_finish(self) -> None:
        self.patch(send=RuntimeError("the wire dropped"))
        run = self.go()
        self.assertEqual(run.stop_reason, "error")
        self.assertFalse(run.ok)
        self.assertIn("the wire dropped", run.error)

    def test_a_finished_run_reports_the_step_it_settled(self) -> None:
        """on_step fires before run.finished, so a reader cannot see an empty step."""
        steps: list[Any] = []
        self.patch()
        self.runner.run(
            "say hi",
            Path(self.tmp.name),
            {},
            None,
            on_step=steps.append,
            on_event=lambda kind, data: self.seen.append((kind, data)),
        )
        self.assertEqual(len(steps), 1)
        kinds = [kind for kind, _ in self.seen]
        self.assertEqual(kinds[-1], "run.finished")


class EffortTests(unittest.TestCase):
    """Which effort reaches the provider, and which never does.

    `_llm` used to put whatever the caller said straight into
    `reasoning_effort`. OpenHands checks that field against the provider's own
    enum, so a level the model never advertised is either refused or silently
    read as something nobody chose -- and codex accepted a bogus level without
    complaint, which is what made the engine's whitelist the only place that
    could tell the difference.
    """

    def test_a_level_the_model_advertises_is_used(self) -> None:
        self.assertEqual(
            backend.resolve_effort(".", "high", "m"), "high", "no catalogue means no levels"
        )

    def test_an_unknown_level_falls_back_to_the_models_default(self) -> None:
        """The case that motivated the whitelist: codex accepted `bogus-level`.

        The default is the fallback rather than an empty string, because an
        empty effort means "the engine chooses" and that is a different claim
        from "this model's own default".
        """
        from rsi.models import Catalog, Model

        catalog = Catalog(models=(Model(id="m", name="m", default_reasoning_level="low",
                                        reasoning_levels=("low", "high")),))
        with mock.patch("rsi.models.catalog", return_value=catalog):
            self.assertEqual(backend.resolve_effort(".", "bogus-level", "m"), "low")
            self.assertEqual(backend.resolve_effort(".", "high", "m"), "high")

    def test_no_level_given_is_the_models_default(self) -> None:
        from rsi.models import Catalog, Model

        catalog = Catalog(models=(Model(id="m", name="m", default_reasoning_level="high",
                                        reasoning_levels=("low", "high")),))
        with mock.patch("rsi.models.catalog", return_value=catalog):
            self.assertEqual(backend.resolve_effort(".", None, "m"), "high")

    def test_a_model_the_catalogue_does_not_know_gets_the_level_it_asked_for(self) -> None:
        """No entry means no levels to check against, so the request stands."""
        self.assertEqual(backend.resolve_effort(".", "xhigh", "absent"), "xhigh")

    def test_the_wire_prefix_does_not_hide_the_catalogue_entry(self) -> None:
        """`openai/` is litellm's routing prefix, not part of the model's name.

        `_llm` passes the id `resolve` produced, which carries that prefix, but
        the catalogue files models without one. Comparing only the bare id never
        matched, so every level looked unknown and the whitelist passed
        everything straight through -- a real run sent `bogus-level` to the
        gateway while the check above was green.
        """
        from rsi.models import Catalog, Model

        catalog = Catalog(models=(Model(id="workbuddy/deepseek-v4.1-flash",
                                        name="flash", default_reasoning_level="high",
                                        reasoning_levels=("low", "high", "max")),))
        with mock.patch("rsi.models.catalog", return_value=catalog):
            prefixed = "openai/workbuddy/deepseek-v4.1-flash"
            self.assertEqual(backend.resolve_effort(".", "bogus-level", prefixed), "high")
            self.assertEqual(backend.resolve_effort(".", "max", prefixed), "max")
            # The bare spelling keeps working for any caller that never prefixed.
            self.assertEqual(
                backend.resolve_effort(".", "bogus-level", "workbuddy/deepseek-v4.1-flash"),
                "high",
            )

    def test_the_llm_is_built_at_the_validated_level(self) -> None:
        """The whitelist is only a defence if `_llm` is the one that uses it.

        Pinned separately from `resolve_effort` because a correct function that
        nothing calls passes every test of the function itself: deleting the
        call left them all green.
        """
        from rsi.models import Catalog, Model

        catalog = Catalog(
            models=(
                Model(
                    id="m",
                    name="m",
                    default_reasoning_level="low",
                    reasoning_levels=("low", "high"),
                ),
            )
        )
        seen: dict[str, Any] = {}

        class _LLM:
            def __init__(self, **kwargs: Any) -> None:
                seen.update(kwargs)

        module = mock.MagicMock()
        module.LLM = _LLM
        modules = {"openhands.sdk.llm.llm": module}
        with mock.patch.dict(sys.modules, modules), mock.patch.object(
            backend, "resolve", return_value={"model": "m", "base_url": "http://x.test"}
        ), mock.patch("rsi.models.catalog", return_value=catalog):
            backend._llm(".", None, "bogus-level")
        self.assertEqual(seen["reasoning_effort"], "low")


class ConversationWiringTests(unittest.TestCase):
    """The four `Conversation` arguments that make a run resumable and quiet.

    Each was correct in `oh_runner` and missing here, and each fails silently:
    a deleted event log looks like a fresh session, a visualizer looks like a
    console full of transcript nobody asked for, a browser-enabled tool set
    looks like a slow first run. The SDK is faked rather than imported so this
    stays on the interpreter the rest of the suite uses.
    """

    def _build(self, tmp: str, key: str = "session-1") -> dict[str, Any]:
        seen: dict[str, Any] = {}

        class _Conversation:
            def __init__(self, **kwargs: Any) -> None:
                seen.update(kwargs)

        class _Agent:
            def __init__(self, **kwargs: Any) -> None:
                seen["tools"] = kwargs["tools"]

        fake = mock.MagicMock()
        fake.Agent = _Agent
        fake.Conversation = _Conversation
        modules = {
            "openhands": fake,
            "openhands.sdk": fake,
            "openhands.tools": mock.MagicMock(
                get_default_tools=lambda **kw: seen.update(tools_kwargs=kw) or ["t"]
            ),
        }
        runner = OpenHandsBackend(home=tmp)
        with mock.patch.dict(sys.modules, modules), mock.patch.object(
            backend, "_llm", return_value=object()
        ):
            runner._conversation(
                key, Path(tmp), None, None, _Translator(None), lambda *a: None, backend._Turn()
            )
        return seen

    def test_the_event_log_survives_the_conversation_closing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            seen = self._build(tmp)
        self.assertFalse(seen["delete_on_close"])
        self.assertTrue(str(seen["persistence_dir"]).startswith(tmp))

    def test_no_visualizer_prints_into_the_service_console(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(self._build(tmp)["visualizer"])

    def test_the_browser_tools_stay_off(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            seen = self._build(tmp)
        self.assertFalse(seen["tools_kwargs"]["enable_browser"])

    def test_two_sessions_in_one_folder_get_their_own_event_log(self) -> None:
        """A conversation is filed under its session id, not its folder.

        Two sessions working in one folder are two dialogues; sharing an event
        log would hand each of them the other's side of the conversation.
        """
        with tempfile.TemporaryDirectory() as tmp:
            first = self._build(tmp, "session-a")["persistence_dir"]
            second = self._build(tmp, "session-b")["persistence_dir"]
        self.assertNotEqual(first, second)

    def test_the_event_log_path_leaves_room_for_what_the_sdk_appends(self) -> None:
        """The filed-away name must be short enough to survive a deep workspace.

        The SDK appends a conversation id and a temporary suffix to the
        persistence directory, and the directory sits inside the workspace, so a
        name built from the whole conversation key overflowed Windows' 260
        character limit for a real session and the run died with
        FileNotFoundError before the model was called. This pins the name to a
        fixed budget so a future key change cannot reintroduce it.
        """
        deep = "C:/Users/someone/AppData/Local/Programs/" + "rsi-harness/" * 8 + "workspace"
        key = backend._conversation_key("0123456789ab", Path(deep))
        name = backend._safe(key)
        self.assertLessEqual(len(name), 41)
        # Still unique per key: two sessions in one folder must not collide.
        self.assertNotEqual(name, backend._safe(backend._conversation_key("ba9876543210", Path(deep))))
        # And readable, so a directory listing still says what it is.
        self.assertTrue(name.startswith("conversation-0123456789ab-"))


class EffortRepointTests(unittest.TestCase):
    """A reused conversation must pick up this run's reasoning level.

    A conversation is built once per key and reused, so the level that built it
    would otherwise be the level for the life of the session: the picker moves,
    every later run keeps the first choice, and nothing reports a problem.
    `Agent` and `LLM` are frozen pydantic models, so re-pointing has to derive a
    new object rather than assign into the old one.
    """

    def _conversation(self, level: str) -> Any:
        class _LLM:
            def __init__(self, reasoning_effort: str) -> None:
                self.reasoning_effort = reasoning_effort

        class _Agent:
            def __init__(self, llm: Any) -> None:
                self.llm = llm

            def model_copy(self, update: dict[str, Any]) -> "_Agent":
                return _Agent(update.get("llm", self.llm))

        class _Conversation:
            def __init__(self, agent: Any) -> None:
                self.agent = agent

        return _Conversation(_Agent(_LLM(level)))

    def test_a_reused_conversation_moves_to_the_level_this_run_asked_for(self) -> None:
        conversation = self._conversation("low")
        built: dict[str, Any] = {}

        def _fake_llm(home: Any, model: Any, reasoning: Any) -> Any:
            built["reasoning"] = reasoning
            held = conversation.agent.llm
            held.reasoning_effort = reasoning
            return held

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(backend, "_llm", _fake_llm):
            OpenHandsBackend(home=tmp)._repoint(conversation, None, "xhigh")

        self.assertEqual(built["reasoning"], "xhigh")
        self.assertEqual(conversation.agent.llm.reasoning_effort, "xhigh")

    def test_an_unchanged_level_leaves_the_conversation_alone(self) -> None:
        """Re-pointing every run would rebuild the agent for no reason."""
        conversation = self._conversation("low")
        original = conversation.agent
        calls: list[Any] = []

        def _fake_llm(home: Any, model: Any, reasoning: Any) -> Any:
            calls.append(reasoning)
            return conversation.agent.llm

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(backend, "_llm", _fake_llm):
            OpenHandsBackend(home=tmp)._repoint(conversation, None, "low")

        self.assertIs(conversation.agent, original)
        self.assertEqual(calls, ["low"])


class UsageTests(unittest.TestCase):
    """What one turn cost, read off the SDK's cumulative counters.

    The SDK accumulates per-LLM usage for the life of a conversation, so the
    only honest reading for one turn is a difference. Reporting the cumulative
    total would make the second run in a session look more expensive than the
    first for reasons the user never caused, and reporting nothing -- which is
    what happened before -- left every row in the window showing no tokens.
    """

    def conversation(self, prompt: int, completion: int) -> Any:
        usage = type(
            "Usage", (), {"prompt_tokens": prompt, "completion_tokens": completion}
        )()
        metrics = type("Metrics", (), {"accumulated_token_usage": usage})()
        stats = type("Stats", (), {"get_combined_metrics": lambda self: metrics})()
        return type("Conv", (), {"conversation_stats": stats})()

    def test_the_difference_between_two_readings_is_the_turn(self) -> None:
        before = backend._usage_totals(self.conversation(100, 10))
        spent = backend._read_usage(self.conversation(160, 24), before)
        self.assertEqual(spent, (60, 14))

    def test_a_conversation_with_no_counters_costs_nothing(self) -> None:
        self.assertEqual(backend._usage_totals(object()), (0, 0))
        self.assertEqual(backend._read_usage(object(), (0, 0)), (0, 0))

    def test_counters_that_reset_never_report_a_negative_cost(self) -> None:
        """A re-pointed LLM starts its own count; a negative cost is a lie."""
        self.assertEqual(backend._read_usage(self.conversation(5, 1), (900, 40)), (0, 0))

    def test_a_raising_stats_reader_is_reported_as_no_cost(self) -> None:
        """Cost accounting is optional; it must not fail the run that produced it."""

        def explode(self: Any) -> Any:
            raise RuntimeError("the registry went away")

        stats = type("Stats", (), {"get_combined_metrics": explode})()
        conversation = type("Conv", (), {"conversation_stats": stats})()
        self.assertEqual(backend._usage_totals(conversation), (0, 0))


if __name__ == "__main__":
    unittest.main()
