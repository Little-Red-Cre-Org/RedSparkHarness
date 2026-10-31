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

"""Where a run is allowed to write.

Pure functions on purpose. This is the rule that keeps an agent inside its
workspace, and the rule is easier to get wrong than it looks: a prefix check
without a separator calls a sibling of the workspace "inside", and comparing
against the wrong root approves a write to a drive root. Keeping the rule free
of processes, threads and timing means it can be tested directly, and anything
that uses it is then only responsible for feeding it the right root.

Failing closed is deliberate: no declared workspace means nothing is inside.
"""

from __future__ import annotations

import re
from pathlib import Path

__all__ = ["decide", "path_is_within", "targets_in_command"]


def path_is_within(path: str | Path, base: str | Path | None) -> bool:
    """Whether `path` is `base` or somewhere beneath it.

    Both sides are resolved first, so `..` and separators cannot be used to
    step outside after the comparison has begun. A relative `path` is taken
    relative to `base`, which is how an agent means it when it says "write
    hello.txt".
    """
    if base is None or path is None:
        return False
    text = str(path).strip()
    if not text:
        return False
    try:
        root = Path(base).resolve()
    except (OSError, ValueError):
        return False
    try:
        target = Path(text)
        if not target.is_absolute():
            target = root / target
        target = target.resolve()
    except (OSError, ValueError):
        return False
    return target == root or root in target.parents


_DESTINATION_FLAGS = (
    r"-LiteralPath\s+'([^']+)'",
    r'-LiteralPath\s+"([^"]+)"',
    r"-FilePath\s+'([^']+)'",
    r'-FilePath\s+"([^"]+)"',
    r"--out(?:put)?[=\s]+'?([A-Za-z]:[^\s'\"]+)'?",
)

_REDIRECT = r">>?\s*'?([A-Za-z]:[^\s'\";|]+)'?"

_BARE_PATH = r"'([A-Za-z]:[^']+)'"


def targets_in_command(command: str) -> list[str]:
    """Absolute paths a shell command writes to.

    Not every path in a command is a destination. A command that writes a file
    also names the interpreter running it, and counting that as a target
    rejected every legitimate write; what matters is where the data lands, so
    this reads the arguments that introduce a destination and ignores the rest.
    """
    text = command or ""
    found: list[str] = []

    def add(value: str) -> None:
        cleaned = value.strip("'\"` ,;()[]")
        if cleaned and cleaned not in found:
            found.append(cleaned)

    for pattern in _DESTINATION_FLAGS:
        for match in re.findall(pattern, text, flags=re.IGNORECASE):
            add(match)
    for match in re.findall(_REDIRECT, text):
        add(match)
    if not found:
        for match in re.findall(_BARE_PATH, text):
            add(match)
    return found


def decide(
    *, kind: str, path: str, command: str, base: str | Path | None
) -> tuple[bool, str]:
    """Whether to allow one approval, and what it was judged on.

    Returns `(allowed, subject)` where `subject` is what the decision was
    actually about, so a caller can record the reasoning and not just the
    verdict.
    """
    if kind == "command":
        targets = targets_in_command(command)
        if not targets:
            # A command that names no destination is not evidence of safety.
            return False, command[:200]
        allowed = all(path_is_within(t, base) for t in targets)
        return allowed, "; ".join(targets)
    return path_is_within(path, base), path
