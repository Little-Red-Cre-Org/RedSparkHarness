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

"""The workspace bound, proven as a pure function before it is trusted.

An approval adjudicator is security code, and the first attempt at one here was
wrong four times in a row while looking right each time: it approved a write to
a drive root because the root it compared against was the engine's own working
directory rather than the run's workspace, and it approved a shell command
because the whole command string was treated as a path.

None of that was visible from the outside. The audit log said "allowed" and the
run carried on; only checking the filesystem afterwards showed the write had
landed outside. So the rules are separated from the engine and tested here
directly: no process, no model, no timing. If these pass, the rule is right.
Whether it is wired up correctly is a separate question, and one the engine
must answer by being honest about what it enforces.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rsi.boundary import path_is_within, targets_in_command


class PathBoundaryTests(unittest.TestCase):
    BASE = Path("C:/runs/session-a/workspace")

    def assertInside(self, path: str, base: Path | None = None) -> None:
        self.assertTrue(
            path_is_within(path, base or self.BASE),
            "expected inside: " + repr(path),
        )

    def assertOutside(self, path: str, base: Path | None = None) -> None:
        self.assertFalse(
            path_is_within(path, base or self.BASE),
            "expected outside: " + repr(path),
        )

    def test_a_file_directly_in_the_workspace_is_inside(self):
        self.assertInside("C:/runs/session-a/workspace/hello.txt")

    def test_a_nested_file_is_inside(self):
        self.assertInside("C:/runs/session-a/workspace/sub/dir/notes.md")

    def test_the_workspace_itself_is_inside(self):
        self.assertInside("C:/runs/session-a/workspace")

    def test_a_sibling_directory_is_outside(self):
        self.assertOutside("C:/runs/session-b/workspace/hello.txt")

    def test_the_parent_of_the_workspace_is_outside(self):
        self.assertOutside("C:/runs/session-a")

    def test_a_drive_root_is_outside(self):
        """The exact path the first attempt let through."""
        self.assertOutside("D:/escape_probe.txt")
        self.assertOutside("C:/")

    def test_a_path_that_merely_starts_with_the_workspace_name_is_outside(self):
        # Prefix matching without a separator would call this inside.
        self.assertOutside("C:/runs/session-a/workspace-evil/x.txt")

    def test_traversal_that_escapes_is_outside(self):
        self.assertOutside("C:/runs/session-a/workspace/../../../escape.txt")

    def test_traversal_that_stays_inside_is_inside(self):
        self.assertInside("C:/runs/session-a/workspace/sub/../ok.txt")

    def test_backslashes_are_treated_as_separators(self):
        self.assertInside("C:\\runs\\session-a\\workspace\\x.txt")
        self.assertOutside("C:\\runs\\session-b\\workspace\\x.txt")

    def test_a_relative_path_is_resolved_against_the_workspace(self):
        self.assertInside("hello.txt")
        self.assertInside("sub/hello.txt")

    def test_a_relative_traversal_is_outside(self):
        self.assertOutside("../escape.txt")

    def test_an_empty_path_is_outside(self):
        self.assertOutside("")

    def test_no_workspace_means_nothing_is_inside(self):
        """A missing bound must fail closed, not open."""
        self.assertFalse(path_is_within("C:/anything.txt", None))


class CommandTargetTests(unittest.TestCase):
    def test_a_literal_path_flag_names_a_target(self):
        cmd = "Set-Content -LiteralPath 'D:\\inside.txt' -Value ABC"
        self.assertEqual(targets_in_command(cmd), ["D:\\inside.txt"])

    def test_the_interpreter_is_not_a_target(self):
        """The bug that rejected every legitimate write."""
        cmd = (
            '"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" '
            "-NoProfile -Command Set-Content -LiteralPath 'C:\\ws\\out.txt' -Value ABC"
        )
        targets = targets_in_command(cmd)
        self.assertIn("C:\\ws\\out.txt", targets)
        self.assertNotIn("C:/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe", targets)
        self.assertFalse(
            any("powershell" in t.lower() for t in targets),
            "the interpreter must not be counted as a write target",
        )

    def test_redirection_names_a_target(self):
        self.assertEqual(targets_in_command("echo hi > D:\\out.txt"), ["D:\\out.txt"])
        self.assertEqual(targets_in_command("echo hi >> D:\\out.txt"), ["D:\\out.txt"])

    def test_a_bare_quoted_path_is_a_target(self):
        self.assertEqual(targets_in_command("copy a.txt 'D:\\dst.txt'"), ["D:\\dst.txt"])

    def test_a_command_with_no_path_names_nothing(self):
        self.assertEqual(targets_in_command("Get-Location"), [])

    def test_an_empty_command_names_nothing(self):
        self.assertEqual(targets_in_command(""), [])


if __name__ == "__main__":
    unittest.main()
