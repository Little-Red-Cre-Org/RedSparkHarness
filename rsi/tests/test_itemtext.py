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

"""The one-line description of a tool call.

The payloads here were captured from a live engine rather than written from
the schema, because the schema says which fields may appear and not which of
them carry the readable part. The command case is the one that matters most:
the raw field is a powershell invocation wrapping the actual command, and
showing it verbatim is what made the call site useless.
"""

import unittest

from rsi import itemtext


class BriefTests(unittest.TestCase):
    def test_a_shell_command_is_shown_without_its_wrapper(self):
        # Captured: the engine runs every command through the shell it chose.
        item = {
            "type": "commandExecution",
            "command": '"C:\\\\WINDOWS\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe"'
            " -Command 'echo HELLO-ITEM-PROBE'",
            "cwd": "D:\\\\RSIHarness\\\\.probe\\\\itemprobe",
            "commandActions": [{"type": "unknown", "command": "echo HELLO-ITEM-PROBE"}],
            "status": "inProgress",
        }
        said = itemtext.brief(item)
        self.assertEqual("echo HELLO-ITEM-PROBE", said)

    def test_the_engine_parse_beats_the_raw_command(self):
        # A read is better said as "read this path" than as the shell line.
        item = {
            "type": "commandExecution",
            "command": "powershell.exe -Command Get-Content notes.md",
            "commandActions": [{"type": "read", "path": "notes.md", "name": "notes.md"}],
        }
        self.assertIn("读 notes.md", itemtext.brief(item))

    def test_a_search_says_what_it_looks_for(self):
        item = {
            "type": "commandExecution",
            "commandActions": [{"type": "search", "query": "generation", "path": "src"}],
        }
        said = itemtext.brief(item)
        self.assertIn("搜索", said)
        self.assertIn("generation", said)

    def test_a_file_change_names_the_path_it_touched(self):
        # Captured: one changes entry per path, with the diff attached.
        item = {
            "type": "fileChange",
            "changes": [
                {
                    "path": "D:\\\\RSIHarness\\\\.probe\\\\fcprobe\\\\notes.md",
                    "kind": {"type": "add"},
                    "diff": "alpha\n",
                }
            ],
            "status": "completed",
        }
        self.assertIn("notes.md", itemtext.brief(item))

    def test_an_mcp_call_names_the_server_and_tool(self):
        item = {"type": "mcpToolCall", "server": "graph", "tool": "create_goal"}
        self.assertEqual("graph/create_goal", itemtext.brief(item))

    def test_a_search_tool_says_the_query(self):
        item = {"type": "webSearch", "query": "codex app-server turn/steer"}
        self.assertEqual("codex app-server turn/steer", itemtext.brief(item))

    def test_nothing_to_say_is_the_empty_string(self):
        self.assertEqual("", itemtext.brief({"type": "commandExecution"}))
        self.assertEqual("", itemtext.brief({}))
        self.assertEqual("", itemtext.brief(None))

    def test_a_long_brief_is_clipped(self):
        item = {"type": "webSearch", "query": "x" * 400}
        said = itemtext.brief(item)
        self.assertLessEqual(len(said), 100)
        self.assertTrue(said.endswith("…"))

    def test_a_multiline_command_stays_one_line(self):
        item = {
            "type": "commandExecution",
            "commandActions": [{"type": "unknown", "command": "echo a\necho b"}],
        }
        said = itemtext.brief(item)
        self.assertNotIn("\n", said)
        self.assertIn("echo a", said)
        self.assertIn("echo b", said)


class LabelTests(unittest.TestCase):
    def test_known_types_are_named_in_chinese(self):
        self.assertEqual("命令", itemtext.label("commandExecution"))
        self.assertEqual("改文件", itemtext.label("fileChange"))
        self.assertEqual("MCP", itemtext.label("mcpToolCall"))

    def test_an_unknown_type_is_passed_through(self):
        self.assertEqual("somethingNew", itemtext.label("somethingNew"))
        self.assertEqual("?", itemtext.label(""))


class OutcomeTests(unittest.TestCase):
    def test_a_completed_command_with_a_zero_exit_succeeded(self):
        item = {"type": "commandExecution", "status": "completed", "exitCode": 0, "durationMs": 79}
        self.assertEqual((True, 79), itemtext.outcome(item))

    def test_a_nonzero_exit_is_a_failure(self):
        # The engine reports the status as completed even when the command failed.
        item = {"type": "commandExecution", "status": "completed", "exitCode": 1, "durationMs": 12}
        ok, _ = itemtext.outcome(item)
        self.assertFalse(ok)

    def test_a_failed_status_is_a_failure(self):
        self.assertFalse(itemtext.outcome({"type": "commandExecution", "status": "failed"})[0])

    def test_a_declined_command_is_not_a_success(self):
        # Declined means the run was refused the write; reporting that as ok
        # would hide the refusal, which is the one thing to notice.
        self.assertFalse(itemtext.outcome({"type": "commandExecution", "status": "declined"})[0])

    def test_a_file_change_that_failed_is_a_failure(self):
        self.assertFalse(itemtext.outcome({"type": "fileChange", "status": "failed"})[0])
        self.assertTrue(itemtext.outcome({"type": "fileChange", "status": "completed"})[0])

    def test_an_mcp_error_is_a_failure(self):
        item = {"type": "mcpToolCall", "status": "completed", "error": {"message": "boom"}}
        self.assertFalse(itemtext.outcome(item)[0])

    def test_a_tool_flagging_itself_unsuccessful_is_a_failure(self):
        item = {"type": "dynamicToolCall", "status": "completed", "success": False}
        self.assertFalse(itemtext.outcome(item)[0])

    def test_a_missing_duration_reads_as_zero(self):
        self.assertEqual((True, 0), itemtext.outcome({"type": "webSearch"}))
        self.assertEqual((True, 0), itemtext.outcome({"durationMs": "not a number"}))


if __name__ == "__main__":
    unittest.main()
