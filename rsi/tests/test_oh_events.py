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

"""The translator, tested without the SDK.

`translate` dispatches on `type(event).__name__` rather than on an imported
class, so the events it has to handle can be built here as plain objects. That
is not a testing convenience bolted on afterwards -- it is the same property
that lets `rsi` import on an interpreter with no OpenHands installed, which is
the interpreter this file runs on.

Each case names the SDK behaviour it pins. The behaviours were read off the
installed SDK; the docstring says where, so a later reader can check the claim
instead of trusting the test.
"""

from __future__ import annotations

import unittest
from typing import Any

from rsi.backend import EVENT_KINDS
from rsi.oh_events import thinking_of, translate


class _Content:
    """A `TextContent` by its only field this module reads."""

    def __init__(self, text: str) -> None:
        self.text = text


class _Image:
    """`ImageContent` has no `text`, and must not be read as an empty string."""

    def __init__(self) -> None:
        self.image_urls = ["http://x.test/a.png"]


class _Message:
    def __init__(self, content: list[Any], reasoning: str | None = None) -> None:
        self.content = content
        self.reasoning_content = reasoning


class MessageEvent:
    def __init__(self, source: str, message: _Message | None) -> None:
        self.source = source
        self.llm_message = message


class ActionEvent:
    def __init__(
        self,
        tool_name: str,
        action: Any = None,
        reasoning: str | None = None,
        thought: list[Any] | None = None,
    ) -> None:
        self.tool_name = tool_name
        self.action = action
        self.reasoning_content = reasoning
        self.thought = thought or []


class ObservationEvent:
    def __init__(self, tool_name: str, observation: Any) -> None:
        self.tool_name = tool_name
        self.observation = observation


class AgentErrorEvent:
    def __init__(self, tool_name: str, error: str) -> None:
        self.tool_name = tool_name
        self.error = error


class UserRejectObservation:
    def __init__(self, tool_name: str, reason: str) -> None:
        self.tool_name = tool_name
        self.rejection_reason = reason


class _TerminalAction:
    def __init__(self, command: str) -> None:
        self.command = command


class _FileEditorAction:
    def __init__(self, command: str, path: str) -> None:
        self.command = command
        self.path = path


class _TerminalObservation:
    def __init__(
        self,
        content: Any,
        is_error: bool = False,
        exit_code: int | None = 0,
    ) -> None:
        self.content = content
        self.is_error = is_error
        self.exit_code = exit_code


class _TaskItem:
    def __init__(self, title: str, status: str) -> None:
        self.title = title
        self.status = status


class _TaskObservation:
    def __init__(self, items: list[_TaskItem]) -> None:
        self.content = [_Content("ok")]
        self.is_error = False
        self.task_list = items


class VocabularyTests(unittest.TestCase):
    def test_every_kind_this_module_can_name_is_one_the_backend_accepts(self) -> None:
        """A kind the backend refuses shows up as a blank card, not as an error.

        Pinned here because the two lists live in different files and only one
        of them is enforced at runtime.
        """
        produced = {
            "step.message",
            "tool.called",
            "tool.result",
            "plan.updated",
        }
        self.assertTrue(produced <= set(EVENT_KINDS), produced - set(EVENT_KINDS))


class MessageTests(unittest.TestCase):
    def test_an_agent_message_is_the_assistant_text(self) -> None:
        event = MessageEvent("agent", _Message([_Content("the answer")]))
        self.assertEqual(
            translate(event),
            ("step.message", {"index": 0, "thinking": "", "assistant": "the answer"}),
        )

    def test_a_user_sourced_message_is_not_assistant_output(self) -> None:
        """The SDK sends the caller's task and its own nudges as `source="user"`.

        Reading those as assistant text would put the engine's words in the
        model's mouth -- and the window already shows the task the user typed.
        """
        event = MessageEvent("user", _Message([_Content("please use a tool")]))
        self.assertIsNone(translate(event))

    def test_reasoning_rides_along_with_the_text(self) -> None:
        event = MessageEvent("agent", _Message([_Content("hi")], reasoning="because"))
        self.assertEqual(translate(event)[1]["thinking"], "because")

    def test_an_empty_message_is_not_reported(self) -> None:
        self.assertIsNone(translate(MessageEvent("agent", _Message([]))))
        self.assertIsNone(translate(MessageEvent("agent", _Message([_Image()]))))

    def test_a_message_with_no_payload_at_all_is_refused_quietly(self) -> None:
        self.assertIsNone(translate(MessageEvent("agent", None)))

    def test_several_text_parts_are_one_line_of_output(self) -> None:
        event = MessageEvent("agent", _Message([_Content("a"), _Content("b")]))
        self.assertEqual(translate(event)[1]["assistant"], "ab")


class ActionTests(unittest.TestCase):
    def test_a_terminal_call_leads_with_its_command(self) -> None:
        """`terminal` alone says nothing; the command says what is happening."""
        event = ActionEvent("terminal", _TerminalAction("npm test"))
        kind, data = translate(event)
        self.assertEqual(kind, "tool.called")
        self.assertEqual(data["name"], "terminal")
        self.assertEqual(data["arguments"]["brief"], "npm test")

    def test_a_file_edit_names_the_command_and_the_path(self) -> None:
        event = ActionEvent("file_editor", _FileEditorAction("str_replace", "rsi/x.py"))
        self.assertEqual(
            translate(event)[1]["arguments"]["brief"], "str_replace rsi/x.py"
        )

    def test_the_reasoning_is_read_from_the_event_not_from_the_call_line(self) -> None:
        """The SDK stamps reasoning on the first action of a response only.

        It has to be emitted before the call it belongs to, and `translate`
        answers one pair per event, so the reasoning is a separate read rather
        than a key in the call payload that no listener would look at.
        """
        event = ActionEvent("terminal", _TerminalAction("ls"), reasoning="look around")
        self.assertEqual(thinking_of(event), "look around")
        self.assertNotIn("thinking", translate(event)[1])

    def test_reasoning_falls_back_to_the_thought_blocks(self) -> None:
        event = ActionEvent("terminal", _TerminalAction("ls"), thought=[_Content("hmm")])
        self.assertEqual(thinking_of(event), "hmm")

    def test_a_call_with_no_reasoning_answers_the_empty_string(self) -> None:
        self.assertEqual(thinking_of(ActionEvent("terminal", _TerminalAction("ls"))), "")

    def test_a_long_command_is_clipped_to_one_line(self) -> None:
        event = ActionEvent("terminal", _TerminalAction("x" * 400))
        brief = translate(event)[1]["arguments"]["brief"]
        self.assertLessEqual(len(brief), 100)
        self.assertTrue(brief.endswith("\u2026"))

    def test_a_multiline_command_is_flattened(self) -> None:
        event = ActionEvent("terminal", _TerminalAction("cd a\n  &&  ls"))
        self.assertEqual(translate(event)[1]["arguments"]["brief"], "cd a && ls")

    def test_a_tool_with_nothing_to_quote_falls_back_to_its_name(self) -> None:
        event = ActionEvent("browser_tool_set", object())
        self.assertEqual(translate(event)[1]["arguments"]["brief"], "browser_tool_set")

    def test_an_action_with_no_tool_name_is_not_a_call(self) -> None:
        self.assertIsNone(translate(ActionEvent("", _TerminalAction("ls"))))


class ObservationTests(unittest.TestCase):
    def test_a_successful_result_carries_its_output(self) -> None:
        event = ObservationEvent("terminal", _TerminalObservation("all good"))
        kind, data = translate(event)
        self.assertEqual(kind, "tool.result")
        self.assertTrue(data["ok"])
        self.assertEqual(data["output"], "all good")

    def test_content_as_a_text_content_list_is_read_as_its_text(self) -> None:
        """The shape the SDK actually uses, and the one a stand-in misses.

        An observation's `content` is `list[TextContent]`; `str()` on it gives
        `"[TextContent(cache_prompt=False, ...)]"`, which is what reaches a
        report when nobody checked. Found by running this module against the
        real SDK, so it is pinned here rather than left to be found again.
        """
        observation = _TerminalObservation([_Content("all good")])
        self.assertEqual(translate(ObservationEvent("terminal", observation))[1]["output"], "all good")

    def test_several_content_parts_are_joined(self) -> None:
        observation = _TerminalObservation([_Content("a"), _Content("b")])
        self.assertEqual(translate(ObservationEvent("terminal", observation))[1]["output"], "ab")

    def test_is_error_marks_a_failed_call(self) -> None:
        event = ObservationEvent("terminal", _TerminalObservation("boom", is_error=True))
        self.assertFalse(translate(event)[1]["ok"])

    def test_a_nonzero_exit_code_is_a_failure_even_when_is_error_is_false(self) -> None:
        """The SDK sets `is_error` for the tool's own failures, and a shell that
        exited 1 without the tool noticing is still a failed command."""
        event = ObservationEvent("terminal", _TerminalObservation("nope", exit_code=1))
        self.assertFalse(translate(event)[1]["ok"])

    def test_a_missing_exit_code_is_not_read_as_failure(self) -> None:
        event = ObservationEvent("terminal", _TerminalObservation("ok", exit_code=None))
        self.assertTrue(translate(event)[1]["ok"])

    def test_a_long_output_is_capped(self) -> None:
        event = ObservationEvent("terminal", _TerminalObservation("y" * 5000))
        self.assertEqual(len(translate(event)[1]["output"]), 2000)

    def test_a_task_list_becomes_the_plan_instead_of_a_result(self) -> None:
        """Both readings would draw the same list twice; the plan is the useful one."""
        observation = _TaskObservation(
            [_TaskItem("read it", "done"), _TaskItem("edit it", "in_progress")]
        )
        kind, data = translate(ObservationEvent("task_tracker", observation))
        self.assertEqual(kind, "plan.updated")
        self.assertEqual(
            data["steps"],
            [
                {"status": "completed", "title": "read it"},
                {"status": "in_progress", "title": "edit it"},
            ],
        )

    def test_an_unknown_task_status_does_not_claim_completion(self) -> None:
        observation = _TaskObservation([_TaskItem("x", "somewhere_else")])
        steps = translate(ObservationEvent("task_tracker", observation))[1]["steps"]
        self.assertEqual(steps[0]["status"], "pending")

    def test_an_empty_task_list_is_a_result_not_an_empty_plan(self) -> None:
        """An empty plan would blank the panel; the observation is still real."""
        observation = _TaskObservation([])
        kind, _ = translate(ObservationEvent("task_tracker", observation))
        self.assertEqual(kind, "tool.result")


class FailureTests(unittest.TestCase):
    def test_a_tool_the_sdk_refused_is_a_failed_call(self) -> None:
        """The codex engine reports a bad call as a call that did not work.

        Nothing retries it -- the tool never ran -- so `model.retry` would send
        a reader looking for a failure that is not coming.
        """
        kind, data = translate(AgentErrorEvent("terminal", "Tool not found"))
        self.assertEqual(kind, "tool.result")
        self.assertFalse(data["ok"])
        self.assertEqual(data["output"], "Tool not found")

    def test_a_rejected_call_is_a_failed_call(self) -> None:
        kind, data = translate(UserRejectObservation("terminal", "user said no"))
        self.assertEqual(kind, "tool.result")
        self.assertFalse(data["ok"])
        self.assertEqual(data["output"], "user said no")

    def test_a_rejection_without_a_reason_still_says_something(self) -> None:
        _, data = translate(UserRejectObservation("terminal", ""))
        self.assertEqual(data["output"], "rejected")


class IgnoredTests(unittest.TestCase):
    def test_events_with_no_listener_meaning_are_ignored(self) -> None:
        """State updates, token frames, hook notes: real, and not this listener's."""
        for name in (
            "ConversationStateUpdateEvent",
            "SystemPromptEvent",
            "TokenEvent",
            "StreamingDeltaEvent",
            "PauseEvent",
            "InterruptEvent",
            "CondensationRequest",
            "SecurityAnalysisEvent",
            "HookExecutionEvent",
        ):
            event = type(name, (), {})()
            self.assertIsNone(translate(event), name)

    def test_an_object_that_is_not_an_event_is_ignored_not_raised(self) -> None:
        """The callback runs inside SDK dispatch; raising there loses the run."""
        self.assertIsNone(translate(object()))
        self.assertIsNone(translate(None))


if __name__ == "__main__":
    unittest.main()
