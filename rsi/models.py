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

"""Which models the engine will accept, read from the engine's own catalogue.

The obvious source is a live endpoint: ask the gateway what it serves. That is
the right answer for a hosted API and the wrong one here. This install talks to
a local gateway whose catalogue is a *file* the engine reads when it starts, and
that file is what the engine validates a requested model id against. Asking the
gateway would return ids the engine rejects, or nothing at all.

So the list comes from the same file the engine reads. It is a plain JSON read:
no engine import, no network, no running process, which is what lets the window
fill the picker before anyone has typed a task.

The catalogue is not the only place a model can come from -- the engine also has
a default in its config -- so this reads both.
"""

from __future__ import annotations

import json
import tomllib
from dataclasses import dataclass
from pathlib import Path

# The file a config names when it does not say otherwise. Kept as a fallback
# rather than as the primary: the config is the authority.
DEFAULT_CATALOG = "magpie-models.json"

# Where the engine keeps its home when nothing says otherwise, relative to the
# directory rsi is started from. Mirrors rsi.engine.Engine's own default; spelled
# out here rather than imported so this module stays clear of the engine.
DEFAULT_HOME = Path(".rsi") / "engine-home"

_SPLIT = "\u00b7"


@dataclass(frozen=True)
class Model:
    """One entry the engine will accept, described the way a person reads it.

    The reasoning fields are empty for a model the catalogue says nothing
    about, which is a different statement from a model that offers no levels:
    the first means "unknown, ask the engine", the second means "one setting
    only". A picker builds itself from `reasoning_levels` and is left alone
    when that tuple is empty.
    """

    id: str
    name: str
    provider: str = ""
    # The effort the engine picks when a run does not name one.
    default_reasoning_level: str = ""
    # The efforts this model accepts, in the catalogue's own order: that order
    # is the model's ranking, so it is what a picker should show.
    reasoning_levels: tuple[str, ...] = ()
    context_window: int = 0
    max_context_window: int = 0

    @property
    def label(self) -> str:
        return self.name + ("  " + self.provider if self.provider else "")

    @property
    def offers_reasoning(self) -> bool:
        """Whether choosing an effort is a choice at all for this model."""
        return len(self.reasoning_levels) > 1


@dataclass(frozen=True)
class Catalog:
    models: tuple[Model, ...] = ()
    default: str = ""

    def __bool__(self) -> bool:
        return bool(self.models)

    def pick(self, wanted: str | None) -> str:
        """The id to run with, given what the caller asked for.

        An id that is not in the catalogue is passed through unchanged: the
        catalogue may be stale, and the engine is the thing that decides.
        """
        if wanted:
            return wanted
        if self.default:
            return self.default
        return self.models[0].id if self.models else ""

    def name_of(self, model_id: str) -> str:
        for entry in self.models:
            if entry.id == model_id:
                return entry.name
        return model_id or "\u9ed8\u8ba4\u6a21\u578b".encode().decode("unicode_escape")


def home_for(store_root: Path | str | None = None) -> Path:
    """The engine home for a given store root.

    rsi lays a base directory out as base/store for the generations and
    base/engine-home for the engine, so the sibling of the store is the first
    guess and a directory inside it is the second. The default location is the
    fallback, for a store pointed somewhere else entirely.
    """
    if store_root is not None:
        base = Path(store_root)
        sibling = base.parent / "engine-home"
        if sibling.is_dir():
            return sibling
        nested = base / "engine-home"
        if nested.is_dir():
            return nested
    return DEFAULT_HOME


def _count(value: object) -> int:
    """A window size, or 0 for anything that is not a positive whole number."""
    if isinstance(value, bool) or not isinstance(value, int):
        return 0
    return value if value > 0 else 0


def _effort(value: object) -> str:
    """One level name, or empty. The catalogue's spelling is kept as written."""
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _levels(value: object) -> tuple[str, ...]:
    """The effort names a row offers, in the order it lists them.

    Rows carry objects with an `effort` key; a bare string is accepted too,
    because a hand-written catalogue is a file someone will edit by hand. Order
    is preserved and duplicates are dropped - a repeated level would show up
    twice in a picker and choose the same thing both times.
    """
    if not isinstance(value, list):
        return ()
    seen: dict[str, None] = {}
    for row in value:
        if isinstance(row, dict):
            name = _effort(row.get("effort"))
        else:
            name = _effort(row)
        if name and name not in seen:
            seen[name] = None
    return tuple(seen)


def catalog(home: Path | str | None = None) -> Catalog:
    """Read the catalogue the engine would read. Never raises."""
    root = Path(home) if home is not None else DEFAULT_HOME
    default = ""
    catalog_path = root / DEFAULT_CATALOG
    try:
        config = tomllib.loads((root / "config.toml").read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError, UnicodeDecodeError):
        config = {}
    if isinstance(config, dict):
        named = config.get("model_catalog_json")
        if isinstance(named, str) and named.strip():
            catalog_path = root / named.strip()
        chosen = config.get("model")
        if isinstance(chosen, str):
            default = chosen.strip()

    try:
        payload = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return Catalog(models=(), default=default)
    if not isinstance(payload, dict):
        return Catalog(models=(), default=default)
    rows = payload.get("models")
    if not isinstance(rows, list):
        return Catalog(models=(), default=default)

    found: list[Model] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        model_id = str(row.get("slug") or row.get("id") or "").strip()
        if not model_id:
            continue
        display = str(row.get("display_name") or row.get("name") or model_id).strip()
        # The display name in this catalogue is "<model> dot <provider>". Split
        # so the two can be laid out differently: the model is what is being
        # chosen, the provider is who serves it.
        name, _, provider = display.partition(_SPLIT)
        found.append(
            Model(
                id=model_id,
                name=name.strip() or model_id,
                provider=provider.strip(),
                default_reasoning_level=_effort(row.get("default_reasoning_level")),
                reasoning_levels=_levels(row.get("supported_reasoning_levels")),
                context_window=_count(row.get("context_window")),
                max_context_window=_count(row.get("max_context_window")),
            )
        )
    return Catalog(models=tuple(found), default=default)


__all__ = ["DEFAULT_CATALOG", "DEFAULT_HOME", "Catalog", "Model", "catalog", "home_for"]
