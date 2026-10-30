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

"""The model catalogue is read from files, so it can be tested as files.

Every case builds an engine home in a temporary directory and reads it. No
engine is started here: the point of the module is that a picker can be filled
before anything runs.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from rsi import models

CONFIG = '''
model_provider = "magpie"
model_catalog_json = "catalog.json"
model = "workbuddy/hy3"
'''

CATALOG = {
    "models": [
        {"slug": "a/one@1k", "display_name": "One @ 1k \u00b7 Provider A"},
        {"slug": "b/two", "display_name": "Two \u00b7 Provider B", "description": "x"},
        {"slug": "", "display_name": "no slug at all"},
        {"display_name": "no identity"},
        "not a dict",
    ]
}


def write_home(base: Path, config: str = CONFIG, catalog: dict | None = CATALOG) -> Path:
    base.mkdir(parents=True, exist_ok=True)
    if config:
        (base / "config.toml").write_text(config, encoding="utf-8")
    if catalog is not None:
        (base / "catalog.json").write_text(json.dumps(catalog), encoding="utf-8")
    return base


class CatalogTests(unittest.TestCase):
    def test_reads_the_file_the_config_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = write_home(Path(tmp) / "engine-home")
            found = models.catalog(home)
            self.assertEqual([m.id for m in found.models], ["a/one@1k", "b/two"])
            self.assertEqual(found.default, "workbuddy/hy3")

    def test_splits_the_display_name_into_model_and_provider(self):
        with tempfile.TemporaryDirectory() as tmp:
            found = models.catalog(write_home(Path(tmp) / "engine-home"))
            one = found.models[0]
            self.assertEqual(one.name, "One @ 1k")
            self.assertEqual(one.provider, "Provider A")
            self.assertEqual(one.label, "One @ 1k  Provider A")

    def test_a_name_without_a_separator_stays_whole(self):
        with tempfile.TemporaryDirectory() as tmp:
            found = models.catalog(
                write_home(
                    Path(tmp) / "engine-home",
                    config='model_catalog_json = "catalog.json"',
                    catalog={"models": [{"slug": "solo", "display_name": "Solo"}]},
                )
            )
            self.assertEqual(found.models[0].provider, "")
            self.assertEqual(found.models[0].label, "Solo")

    def test_rows_without_an_id_are_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            found = models.catalog(write_home(Path(tmp) / "engine-home"))
            self.assertEqual(len(found.models), 2)

    def test_falls_back_to_the_named_catalog_when_the_config_is_silent(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "engine-home"
            home.mkdir()
            (home / models.DEFAULT_CATALOG).write_text(
                json.dumps({"models": [{"slug": "x", "display_name": "X"}]}),
                encoding="utf-8",
            )
            found = models.catalog(home)
            self.assertEqual([m.id for m in found.models], ["x"])


REASONING_ROW = {
    "slug": "grok/one",
    "display_name": "One \u00b7 Grok",
    "default_reasoning_level": "medium",
    "supported_reasoning_levels": [
        {"effort": "low", "description": ""},
        {"effort": "medium", "description": ""},
        {"effort": "xhigh", "description": ""},
    ],
    "context_window": 272000,
    "max_context_window": 500000,
}


def read_rows(rows: list, config: str = 'model_catalog_json = "catalog.json"'):
    """Read one hand-built catalogue, the way every case below wants."""
    with tempfile.TemporaryDirectory() as tmp:
        home = write_home(
            Path(tmp) / "engine-home", config=config, catalog={"models": rows}
        )
        return models.catalog(home)


class ReasoningTests(unittest.TestCase):
    """The reasoning fields are read, never defaulted to a guess."""

    def test_levels_keep_the_catalogue_order(self):
        found = read_rows([REASONING_ROW])
        self.assertEqual(found.models[0].reasoning_levels, ("low", "medium", "xhigh"))
        self.assertEqual(found.models[0].default_reasoning_level, "medium")

    def test_window_sizes_are_read(self):
        one = read_rows([REASONING_ROW]).models[0]
        self.assertEqual(one.context_window, 272000)
        self.assertEqual(one.max_context_window, 500000)

    def test_a_row_that_says_nothing_is_unknown_rather_than_absent(self):
        one = read_rows([{"slug": "x", "display_name": "X"}]).models[0]
        self.assertEqual(one.reasoning_levels, ())
        self.assertEqual(one.default_reasoning_level, "")
        self.assertEqual(one.context_window, 0)

    def test_bare_effort_strings_are_accepted(self):
        """A hand-written catalogue is a file someone edits by hand."""
        one = read_rows(
            [{"slug": "x", "display_name": "X", "supported_reasoning_levels": ["low", "high"]}]
        ).models[0]
        self.assertEqual(one.reasoning_levels, ("low", "high"))

    def test_a_repeated_level_appears_once(self):
        one = read_rows(
            [
                {
                    "slug": "x",
                    "display_name": "X",
                    "supported_reasoning_levels": [
                        {"effort": "low"},
                        {"effort": "low"},
                        {"effort": ""},
                        "high",
                    ],
                }
            ]
        ).models[0]
        self.assertEqual(one.reasoning_levels, ("low", "high"))

    def test_offers_reasoning_needs_more_than_one_choice(self):
        self.assertTrue(read_rows([REASONING_ROW]).models[0].offers_reasoning)
        single = read_rows(
            [{"slug": "x", "display_name": "X", "supported_reasoning_levels": ["low"]}]
        ).models[0]
        self.assertFalse(single.offers_reasoning)

    def test_a_negative_window_is_not_a_window(self):
        one = read_rows(
            [{"slug": "x", "display_name": "X", "context_window": -5}]
        ).models[0]
        self.assertEqual(one.context_window, 0)


class MissingTests(unittest.TestCase):
    """Nothing about an unreadable catalogue may raise: this fills a picker."""

    def test_no_directory_at_all(self):
        with tempfile.TemporaryDirectory() as tmp:
            found = models.catalog(Path(tmp) / "nowhere")
            self.assertFalse(found)
            self.assertEqual(found.models, ())

    def test_config_without_a_catalogue(self):
        with tempfile.TemporaryDirectory() as tmp:
            found = models.catalog(write_home(Path(tmp) / "home", catalog=None))
            self.assertEqual(found.models, ())
            self.assertEqual(found.default, "workbuddy/hy3")

    def test_catalogue_that_is_not_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "home"
            home.mkdir()
            (home / "catalog.json").write_text("{not json", encoding="utf-8")
            self.assertEqual(models.catalog(home).models, ())

    def test_catalogue_without_a_models_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "home"
            home.mkdir()
            (home / "catalog.json").write_text(json.dumps({"rows": []}), encoding="utf-8")
            self.assertEqual(models.catalog(home).models, ())

    def test_config_that_is_not_toml(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "home"
            home.mkdir()
            (home / "config.toml").write_text("this is not = toml [", encoding="utf-8")
            (home / models.DEFAULT_CATALOG).write_text(
                json.dumps({"models": [{"slug": "x", "display_name": "X"}]}),
                encoding="utf-8",
            )
            found = models.catalog(home)
            self.assertEqual([m.id for m in found.models], ["x"])
            self.assertEqual(found.default, "")


class PickTests(unittest.TestCase):
    def setUp(self):
        self.found = models.Catalog(
            models=(models.Model(id="a", name="A"), models.Model(id="b", name="B")),
            default="b",
        )

    def test_what_was_asked_for_wins(self):
        self.assertEqual(self.found.pick("a"), "a")

    def test_the_config_default_is_next(self):
        self.assertEqual(self.found.pick(None), "b")
        self.assertEqual(self.found.pick(""), "b")

    def test_then_the_first_entry(self):
        self.assertEqual(models.Catalog(models=self.found.models).pick(None), "a")

    def test_nothing_at_all(self):
        self.assertEqual(models.Catalog().pick(None), "")
        self.assertEqual(models.Catalog().pick("chosen"), "chosen")

    def test_an_unknown_id_passes_through(self):
        """The catalogue may be stale; the engine is what decides."""
        self.assertEqual(self.found.pick("not-listed"), "not-listed")

    def test_names_resolve_and_unknown_ids_stand_for_themselves(self):
        self.assertEqual(self.found.name_of("a"), "A")
        self.assertEqual(self.found.name_of("zzz"), "zzz")
        self.assertTrue(self.found.name_of(""))


class HomeTests(unittest.TestCase):
    def test_the_sibling_of_the_store_is_preferred(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            (base / "store").mkdir()
            (base / "engine-home").mkdir()
            self.assertEqual(models.home_for(base / "store"), base / "engine-home")

    def test_a_home_inside_the_store_is_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            (base / "store" / "engine-home").mkdir(parents=True)
            self.assertEqual(models.home_for(base / "store"), base / "store" / "engine-home")

    def test_nothing_on_disk_falls_back_to_the_relative_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(models.home_for(Path(tmp) / "store"), models.DEFAULT_HOME)

    def test_no_argument_is_the_relative_default(self):
        self.assertEqual(models.home_for(None), models.DEFAULT_HOME)


if __name__ == "__main__":
    unittest.main()
