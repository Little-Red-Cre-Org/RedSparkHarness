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

"""Two numbers the sidebar shows: how long ago, and how much today.

Both are read off the session records alone - no clock state, no service call,
no accumulation kept in memory. A sidebar that counted its own runs since
startup would disagree with the files, and the files are what the window is
showing.

Everything here is pure: numbers in, strings out, Qt nowhere. That is what lets
the window be checked by ordinary tests through this module.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Iterable


@dataclass(frozen=True)
class Usage:
    """What has been spent today, in runs and in tokens."""

    runs: int = 0
    tokens: int = 0

    def __bool__(self) -> bool:
        return bool(self.runs)

    @property
    def text(self) -> str:
        """One line, the way the sidebar footer reads it."""
        if not self.runs:
            return "今天还没有运行"
        return "%s tokens \u00b7 %d 次运行" % (compact(self.tokens), self.runs)


def _date_of(stamp: float) -> Any:
    """The local date a timestamp falls on.

    Local rather than UTC: "today" is a question the reader asks in their own
    timezone, and a run made at nine in the evening should still count that
    evening.
    """
    return time.localtime(stamp)[:3]


def ago(stamp: float, now: float | None = None) -> str:
    """How long before now, in the coarsest unit that still says something."""
    moment = time.time() if now is None else now
    seconds = max(0.0, float(moment) - float(stamp or 0.0))
    if seconds < 60:
        return "刚刚"
    minutes = int(seconds // 60)
    if minutes < 60:
        return "%d 分钟" % minutes
    hours = int(seconds // 3600)
    if hours < 24:
        return "%d 小时" % hours
    days = int(seconds // 86400)
    if days < 30:
        return "%d 天" % days
    return time.strftime("%m-%d", time.localtime(stamp))


def compact(count: int) -> str:
    """A token count short enough for a footer, rounded but not invented."""
    value = int(count or 0)
    if value < 1000:
        return str(value)
    if value < 1_000_000:
        return _trim(value / 1000.0, 1) + "k"
    return _trim(value / 1_000_000.0, 2) + "M"


def _trim(value: float, places: int) -> str:
    text = "%.*f" % (places, value)
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def today(sessions: Iterable[Any], now: float | None = None) -> Usage:
    """What the given sessions have run since midnight, local time."""
    moment = time.time() if now is None else now
    day = _date_of(moment)
    runs = 0
    tokens = 0
    for session in sessions or ():
        for run in getattr(session, "runs", None) or ():
            stamp = float(getattr(run, "created_at", 0.0) or 0.0)
            # A record with no timestamp cannot be placed on a day, so it is
            # left out rather than guessed at as "today".
            if not stamp or _date_of(stamp) != day:
                continue
            runs += 1
            tokens += int(getattr(run, "tokens", 0) or 0)
    return Usage(runs=runs, tokens=tokens)


__all__ = ["Usage", "ago", "compact", "today"]
