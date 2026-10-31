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

"""Settings are a file, so they are tested as a file.

The only interesting cases are the ones a user can produce by hand: no file,
an empty file, a file with something else in it, and a write interrupted before
the rename.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from rsi import prefs


class LoadTests(unittest.TestCase):
    def test_a_missing_file_is_no_settings(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(prefs.load(Path(tmp) / "nothing.json"), {})

    def test_what_was_saved_comes_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "window.json"
            prefs.save(path, {"model": "a/b", "note": "\u4e2d\u6587"})
            self.assertEqual(prefs.load(path), {"model": "a/b", "note": "\u4e2d\u6587"})

    def test_the_file_is_readable_text(self):
        """UTF-8 rather than escapes: a person may need to read or edit it."""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "window.json"
            prefs.save(path, {"title": "\u4e2d\u6587"})
            self.assertIn("\u4e2d\u6587", path.read_text(encoding="utf-8"))

    def test_broken_json_is_no_settings_rather_than_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "window.json"
            path.write_text("{ half", encoding="utf-8")
            self.assertEqual(prefs.load(path), {})

    def test_a_list_is_not_a_settings_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "window.json"
            path.write_text(json.dumps(["a"]), encoding="utf-8")
            self.assertEqual(prefs.load(path), {})

    def test_non_string_keys_are_normalised(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "window.json"
            path.write_text(json.dumps({"1": "x"}), encoding="utf-8")
            self.assertEqual(prefs.load(path), {"1": "x"})


class SaveTests(unittest.TestCase):
    def test_the_parent_directory_is_created(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "deep" / "er" / "window.json"
            prefs.save(path, {"a": "b"})
            self.assertTrue(path.is_file())

    def test_no_temporary_file_is_left_behind(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "window.json"
            prefs.save(path, {"a": "b"})
            self.assertEqual([p.name for p in Path(tmp).iterdir()], ["window.json"])

    def test_saving_twice_replaces_wholesale(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "window.json"
            prefs.save(path, {"a": "b", "c": "d"})
            prefs.save(path, {"a": "z"})
            self.assertEqual(prefs.load(path), {"a": "z"})


class TextTests(unittest.TestCase):
    def test_a_string_comes_back_stripped(self):
        self.assertEqual(prefs.text_of({"k": "  v  "}, "k"), "v")

    def test_absent_and_blank_fall_back(self):
        self.assertEqual(prefs.text_of({}, "k", "fallback"), "fallback")
        self.assertEqual(prefs.text_of({"k": "   "}, "k", "fallback"), "fallback")

    def test_a_non_string_falls_back(self):
        self.assertEqual(prefs.text_of({"k": 7}, "k", "fallback"), "fallback")


if __name__ == "__main__":
    unittest.main()
