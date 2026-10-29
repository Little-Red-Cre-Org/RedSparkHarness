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

"""The window's own settings, in a file beside the store.

Not qconfig: that config object holds the theme engine's keys and is rewritten
whole on every save, so a key of ours stored there would be dropped the first
time the theme changed. Not the session records either -- these are choices
about the window, and a session that was run with one model should keep saying
so after the default is changed.

The file is deliberately dumb: a flat dict of strings, read once at startup and
written whenever something changes. A settings store that can fail is worse than
one that is small, so every read is total and every write is atomic.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

# Beside desktop.json (the theme) rather than inside it, for the reason above.
DEFAULT_NAME = "window.json"


def load(path: Path | str) -> dict[str, Any]:
    """Whatever is in the file, or an empty dict. Never raises."""
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return {}
    if not isinstance(payload, dict):
        return {}
    return {str(key): value for key, value in payload.items()}


def save(path: Path | str, values: dict[str, Any]) -> None:
    """Write the settings whole, atomically.

    Written to a temporary file first: the window can be closed at any moment,
    and a half-written file would come back as "no settings" rather than "the
    last ones that worked".
    """
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(values, ensure_ascii=False, indent=2, sort_keys=True)
    temporary = target.with_name(target.name + ".tmp")
    temporary.write_text(payload + "\n", encoding="utf-8")
    os.replace(temporary, target)


def text_of(values: dict[str, Any], key: str, fallback: str = "") -> str:
    """One string setting, with a fallback for anything that is not a string."""
    value = values.get(key)
    return value.strip() if isinstance(value, str) and value.strip() else fallback


__all__ = ["DEFAULT_NAME", "load", "save", "text_of"]
