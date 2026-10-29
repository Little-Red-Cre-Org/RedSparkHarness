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

"""Reading tool calls back out of a stored transcript.

The transcripts below are the shape the writer actually produces, not a tidied
version of it: an observation is either the tool's own output or the whole raw
item, and only the second one carries a duration. Getting that distinction wrong
would put a number on screen that came from parsing plain text as a payload.
"""

import unittest

from rsi import transcript

REAL = """\
[THINKING] We need execute list files, create file using apply_patch ideally.
[ASSISTANT] 当前目录初始为空，我已创建 brief-check.md 并写入 BRIEF-OK。
[ACTION] 命令({"brief": "Get-ChildItem -Force | Select-Object Mode,Length,LastWriteTime,Name"})
[OBSERVATION] {"type": "commandExecution", "id": "call_00_uk", "status": "completed", "aggregatedOutput": null, "exitCode": 0, "durationMs": 102}
[ACTION] 改文件({"brief": "D:\\\\RSIHarness\\\\.probe\\\\brief-check.md"})
[OBSERVATION] {"type": "fileChange", "status": "completed", "changes": [{"path": "brief-check.md", "diff": "BRIEF-OK\\n"}]}
[FINAL] 当前目录初始为空，我已创建 brief-check.md 并写入 BRIEF-OK。
"""


class CallsTests(unittest.TestCase):
    def test_a_transcript_gives_up_its_calls_in_order(self):
        found = transcript.calls(REAL)
        self.assertEqual(["命令", "改文件"], [c.name for c in found])

    def test_an_item_type_is_shown_as_its_name(self):
        # The writer stores what the engine called the item; the window shows
        # what the reader calls it. Both spellings are in the same field.
        found = transcript.calls("[ACTION] commandExecution({})\n")
        self.assertEqual("命令", found[0].name)

    def test_the_row_shows_the_brief_the_engine_wrote(self):
        # The engine already summarised the call; the transcript keeps that, so
        # there is nothing left to derive from the raw payload here.
        self.assertEqual(
            "Get-ChildItem -Force | Select-Object Mode,Length,LastWriteTime,Name",
            transcript.calls(REAL)[0].brief,
        )

    def test_a_completed_call_is_ok_and_keeps_its_duration(self):
        first = transcript.calls(REAL)[0]
        self.assertIs(True, first.ok)
        self.assertEqual(102, first.ms)

    def test_a_call_whose_item_has_no_duration_still_reads_as_ok(self):
        second = transcript.calls(REAL)[1]
        self.assertIs(True, second.ok)
        self.assertEqual(0, second.ms)

    def test_a_failed_observation_marks_the_call_failed(self):
        text = (
            "[ACTION] 命令({\"brief\": \"exit 1\"})\n"
            '[OBSERVATION ERROR] {"type": "commandExecution", "exitCode": 1, "durationMs": 7}\n'
        )
        call = transcript.calls(text)[0]
        self.assertIs(False, call.ok)
        self.assertEqual(7, call.ms)

    def test_a_plain_text_observation_does_not_donate_a_duration(self):
        # An observation is often just what the tool printed. Reading a number
        # out of that would be a coincidence, not a measurement.
        text = (
            '[ACTION] 命令({"brief": "echo"})\n'
            '[OBSERVATION] {"durationMs": 999}\n'
        )
        self.assertEqual(0, transcript.calls(text)[0].ms)

    def test_a_multiline_observation_stays_one_record(self):
        text = (
            '[ACTION] 命令({"brief": "ls"})\n'
            "[OBSERVATION] one\ntwo\nthree\n"
            '[ACTION] 改文件({"brief": "a.md"})\n'
            "[OBSERVATION] done\n"
        )
        found = transcript.calls(text)
        self.assertEqual(["命令", "改文件"], [c.name for c in found])
        self.assertIs(True, found[0].ok)

    def test_a_call_still_running_has_no_verdict(self):
        # The writer emits both lines together, so this only happens for a
        # transcript cut short - an interrupted run. Printing either verdict
        # would be a claim the run never made.
        found = transcript.calls('[ACTION] 命令({"brief": "sleep 100"})\n')
        self.assertEqual(1, len(found))
        self.assertIsNone(found[0].ok)

    def test_the_result_is_the_line_that_follows_not_a_matching_name(self):
        text = (
            '[ACTION] 命令({"brief": "first"})\n'
            '[OBSERVATION ERROR] {"type": "commandExecution", "exitCode": 1}\n'
            '[ACTION] 命令({"brief": "second"})\n'
            '[OBSERVATION] {"type": "commandExecution", "exitCode": 0}\n'
        )
        first, second = transcript.calls(text)
        self.assertIs(False, first.ok)
        self.assertIs(True, second.ok)

    def test_an_empty_transcript_has_no_calls(self):
        self.assertEqual([], transcript.calls(""))
        self.assertEqual([], transcript.calls(REAL.split("[ACTION]")[0]))


class OlderFormatTests(unittest.TestCase):
    """Transcripts written before the brief made it into the arguments.

    They are not hypothetical: every run recorded before that change has an
    empty argument object and the whole raw item after it. Reading the row back
    out of the item is what keeps those runs from reopening as two anonymous
    words and a blank line.
    """

    # Captured from .probe/gui_final, a run recorded one revision earlier.
    OLD = (
        "[ACTION] commandExecution({})\n"
        '[OBSERVATION] {"type": "commandExecution", "command": "\\"C:\\\\WINDOWS\\\\'
        'powershell.exe\\" -Command \'Get-ChildItem\'", "commandActions": '
        '[{"type": "unknown", "command": "Get-ChildItem"}], "status": "completed", '
        '"exitCode": 0, "durationMs": 420}\n'
        "[ACTION] fileChange({})\n"
        '[OBSERVATION] {"type": "fileChange", "changes": [{"path": "notes/findings.md", '
        '"kind": {"type": "add"}}], "status": "completed"}\n'
    )

    def test_the_call_row_is_read_from_the_observation(self):
        found = transcript.calls(self.OLD)
        self.assertEqual("Get-ChildItem", found[0].brief)
        self.assertIn("findings.md", found[1].brief)

    def test_the_verdict_and_duration_are_unchanged(self):
        found = transcript.calls(self.OLD)
        self.assertIs(True, found[0].ok)
        self.assertEqual(420, found[0].ms)

    def test_a_failed_old_call_still_reads_as_failed(self):
        text = (
            "[ACTION] commandExecution({})\n"
            '[OBSERVATION ERROR] {"type": "commandExecution", "command": "exit 1", '
            '"exitCode": 1}\n'
        )
        self.assertIs(False, transcript.calls(text)[0].ok)


class ActionLineTests(unittest.TestCase):
    def test_arguments_that_are_not_json_are_shown_as_written(self):
        found = transcript.calls("[ACTION] 工具(not json at all)\n")
        self.assertEqual("工具", found[0].name)
        self.assertEqual("not json at all", found[0].brief)

    def test_a_name_without_arguments_is_still_a_call(self):
        found = transcript.calls("[ACTION] 工具\n")
        self.assertEqual("工具", found[0].name)
        self.assertEqual("", found[0].brief)

    def test_a_long_argument_line_is_clipped_to_one_row(self):
        long = "x" * 400
        found = transcript.calls('[ACTION] 命令({"brief": "' + long + '"})\n')
        self.assertEqual(120, len(found[0].brief))
        self.assertTrue(found[0].brief.endswith("\u2026"))


class BriefOfTests(unittest.TestCase):
    def test_the_engines_brief_is_preferred(self):
        self.assertEqual("读 notes.md", transcript.brief_of({"brief": "读 notes.md", "path": "x"}))

    def test_a_plain_string_is_its_own_brief(self):
        self.assertEqual("hello", transcript.brief_of("hello"))

    def test_other_arguments_fall_back_to_json(self):
        self.assertEqual('{"path": "a.md"}', transcript.brief_of({"path": "a.md"}))

    def test_nothing_to_say_is_empty(self):
        for empty in (None, "", {}, []):
            self.assertEqual("", transcript.brief_of(empty))


if __name__ == "__main__":
    unittest.main()
