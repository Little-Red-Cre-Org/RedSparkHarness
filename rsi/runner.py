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

"""Which object executes a task.

RSI Harness runs tasks in three places -- a session from the desktop client, a
proposal round inside the improvement loop, and one task inside a task-set run
-- and they must all use the same engine. When they did not, each site built
its own agent and the three silently drifted: the loop kept the old loop, so an
improvement round and the thing it was improving were not the same actor, and a
number from one could not be compared with the other.

This module is the one answer, so a swap reaches every caller at once.
"""

from __future__ import annotations

from typing import Any

__all__ = ["make_runner", "runner_kind"]

#: Which executor a run uses. OpenHands is the current engine: RSI grew up on
#: a codex app-server, and that runner stays for the improvement loop's own
#: comparisons, but a session runs on OpenHands.
ENGINE = "openhands"


def make_runner(*, model: str | None = None, timeout: float | None = None) -> Any:
    """A runner that satisfies rsi.sessions.Runner.

    The engine is chosen here rather than at each of the three call sites, so a
    swap reaches every caller at once. The engine home is resolved the same way
    the model catalogue resolves it, so the list on screen and the engine
    behind it cannot name two different installations.
    """
    from .backend import make_backend
    from .models import DEFAULT_HOME

    if ENGINE == "openhands":
        return make_backend(
            "openhands",
            home=DEFAULT_HOME,
            model=model,
            timeout=float(timeout) if timeout else 900.0,
        )

    return make_backend(
        "engine",
        model=model,
        timeout=float(timeout) if timeout else 900.0,
    )


def runner_kind() -> str:
    """A short label for logs and proposal records."""
    return ENGINE
