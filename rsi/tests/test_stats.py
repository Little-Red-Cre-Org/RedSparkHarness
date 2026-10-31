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

"""Tests for the two numbers in the sidebar footer.

The times are built relative to a fixed "now" rather than read off the clock:
a test that says "two hours ago" has to mean the same thing at every hour.
"""

import time
import unittest
from types import SimpleNamespace

from rsi import stats

# Any Friday afternoon. Only its local-date boundaries matter here.
NOW = time.mktime((2026, 5, 8, 15, 30, 0, 0, 0, -1))

class AgoTests(unittest.TestCase):
    def test_under_a_minute_is_just_now(self):
        self.assertEqual(stats.ago(NOW - 5, NOW), "刚刚")

    def test_minutes(self):
        self.assertEqual(stats.ago(NOW - 60 * 7, NOW), "7 分钟")

    def test_hours(self):
        self.assertEqual(stats.ago(NOW - 3600 * 5, NOW), "5 小时")

    def test_days(self):
        self.assertEqual(stats.ago(NOW - 86400 * 3, NOW), "3 天")

    def test_past_a_month_shows_the_date(self):
        # "47 天" is a number nobody converts; the date is what gets read.
        old = time.mktime((2026, 1, 2, 9, 0, 0, 0, 0, -1))
        self.assertEqual(stats.ago(old, NOW), "01-02")

    def test_a_clock_that_jumps_backwards_still_reads_sanely(self):
        # Machine clocks are corrected, and a run stamped in the future is a
        # record of something that happened, not an error to render.
        self.assertEqual(stats.ago(NOW + 600, NOW), "刚刚")

    def test_missing_timestamp_falls_back_to_the_date(self):
        # A record saved without a time is old by definition; strftime on a
        # zero stamp is a date, and a date is a truthful thing to show.
        self.assertIsInstance(stats.ago(0, NOW), str)
        self.assertNotIn("None", stats.ago(0, NOW))


class CompactTests(unittest.TestCase):
    def test_small_counts_are_exact(self):
        self.assertEqual(stats.compact(0), "0")
        self.assertEqual(stats.compact(999), "999")

    def test_thousands(self):
        self.assertEqual(stats.compact(1000), "1k")
        self.assertEqual(stats.compact(1500), "1.5k")
        self.assertEqual(stats.compact(12500), "12.5k")

    def test_millions(self):
        self.assertEqual(stats.compact(2_000_000), "2M")
        self.assertEqual(stats.compact(1_880_000), "1.88M")

    def test_trailing_zeroes_are_dropped(self):
        # "1.0M" spends a character to say nothing.
        self.assertEqual(stats.compact(1_000_000), "1M")


class UsageTests(unittest.TestCase):
    def test_empty_usage_says_so_rather_than_zero(self):
        empty = stats.Usage()
        self.assertFalse(empty)
        self.assertEqual(empty.text, "今天还没有运行")

    def test_usage_reads_as_one_line(self):
        usage = stats.Usage(runs=22, tokens=1_880_000)
        self.assertTrue(usage)
        self.assertEqual(usage.text, "1.88M tokens \u00b7 22 次运行")

    def test_few_tokens(self):
        self.assertEqual(stats.Usage(runs=1, tokens=42).text, "42 tokens \u00b7 1 次运行")


def _session(runs):
    return SimpleNamespace(runs=runs)


def _run(stamp, tokens=100):
    return SimpleNamespace(created_at=stamp, tokens=tokens)


class TodayTests(unittest.TestCase):
    def test_counts_only_runs_from_today(self):
        yesterday = NOW - 86400
        sessions = [
            _session([_run(NOW - 600), _run(NOW - 60)]),
            _session([_run(yesterday)]),
        ]
        usage = stats.today(sessions, NOW)
        self.assertEqual(usage.runs, 2)
        self.assertEqual(usage.tokens, 200)

    def test_a_run_earlier_this_morning_counts(self):
        # Local midnight, not UTC: a run at nine in the evening belongs to that
        # evening even if UTC has already rolled over.
        morning = time.mktime((2026, 5, 8, 0, 5, 0, 0, 0, -1))
        usage = stats.today([_session([_run(morning)])], NOW)
        self.assertEqual(usage.runs, 1)

    def test_a_record_without_a_timestamp_is_skipped(self):
        usage = stats.today([_session([_run(0), _run(NOW)])], NOW)
        self.assertEqual(usage.runs, 1)

    def test_sessions_without_runs_are_fine(self):
        self.assertEqual(stats.today([SimpleNamespace()], NOW).runs, 0)
        self.assertEqual(stats.today([], NOW).runs, 0)


if __name__ == "__main__":
    unittest.main()
