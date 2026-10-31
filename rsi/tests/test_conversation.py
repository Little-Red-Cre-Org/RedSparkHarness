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

"""Two conversations never share one dialogue, even in the same folder.

The engine used to file its threads by directory, so two sessions that worked
in the same folder resumed the same thread and each saw the other's turns. All
the filtering happens on plain dicts here, which is what a notification is; the
process that produces them is not involved.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from rsi.engine import _ours, conversation_key


class ConversationKeyTests(unittest.TestCase):
    def test_two_conversations_in_one_folder_get_two_keys(self) -> None:
        workdir = Path("/work/shared")
        first = conversation_key("aaa", workdir)
        second = conversation_key("bbb", workdir)
        self.assertNotEqual(first, second)

    def test_one_conversation_in_one_folder_keeps_its_key(self) -> None:
        a = conversation_key("aaa", Path("/work/one"))
        b = conversation_key("aaa", Path("/work/one"))
        self.assertEqual(a, b)

    def test_moving_a_conversation_to_another_folder_starts_a_new_thread(self) -> None:
        # A thread's working directory is fixed when it is created, so resuming
        # it after a move would keep running commands in the old folder.
        a = conversation_key("aaa", Path("/work/one"))
        b = conversation_key("aaa", Path("/work/two"))
        self.assertNotEqual(a, b)

    def test_a_caller_that_names_no_conversation_gets_its_own(self) -> None:
        # Falling back to one shared thread is the defect; falling back to the
        # directory only risks the old behaviour, and only for a caller that
        # declined to identify itself.
        self.assertEqual(conversation_key(None, Path("/w")), "workspace:" + str(Path("/w")))
        self.assertEqual(conversation_key("  ", Path("/w")), "workspace:" + str(Path("/w")))


class NotificationOwnershipTests(unittest.TestCase):
    """Every notification carries threadId and turnId; a run believes only its own."""

    def test_another_thread_is_rejected(self) -> None:
        self.assertFalse(_ours({"threadId": "other", "turnId": "t1"}, "mine", "t1"))

    def test_another_turn_on_the_same_thread_is_rejected(self) -> None:
        # A thread reused for a second run can still have the first one's
        # late notifications in flight; they are not this run's words.
        self.assertFalse(_ours({"threadId": "mine", "turnId": "t0"}, "mine", "t1"))

    def test_our_own_notification_is_accepted(self) -> None:
        self.assertTrue(_ours({"threadId": "mine", "turnId": "t1"}, "mine", "t1"))

    def test_a_message_with_neither_id_is_not_a_run_notification(self) -> None:
        self.assertFalse(_ours({}, "mine", "t1"))

    def test_an_unknown_thread_does_not_swallow_everything(self) -> None:
        # Without a thread id there is nothing to compare against, and the
        # message is still routed by its turn.
        self.assertTrue(_ours({"turnId": "t1"}, "", "t1"))


class NotificationRoutingTests(unittest.TestCase):
    """A notification goes to the run watching its thread, not to whoever polls first."""

    def setUp(self) -> None:
        from rsi.engine import Engine

        self.engine = Engine()

    def _drain(self, box) -> list:
        import queue

        held = []
        while True:
            try:
                held.append(box.get(timeout=0.05))
            except queue.Empty:
                return held

    def test_one_thread_gets_only_its_own_messages(self) -> None:
        mine = self.engine.subscribe("t1")
        other = self.engine.subscribe("t2")
        self.engine._dispatch({"method": "item/agentMessage/delta", "params": {"threadId": "t1"}})
        self.engine._dispatch({"method": "item/agentMessage/delta", "params": {"threadId": "t2"}})
        self.assertEqual([m["params"]["threadId"] for m in self._drain(mine)], ["t1"])
        self.assertEqual([m["params"]["threadId"] for m in self._drain(other)], ["t2"])

    def test_two_runs_on_one_thread_both_see_it(self) -> None:
        # The same conversation can be watching twice while a follower
        # attaches; neither may be starved of the turn it is following.
        first = self.engine.subscribe("t1")
        second = self.engine.subscribe("t1")
        self.engine._dispatch({"method": "turn/completed", "params": {"threadId": "t1"}})
        self.assertEqual(len(self._drain(first)), 1)
        self.assertEqual(len(self._drain(second)), 1)

    def test_an_unwatched_thread_falls_back_to_the_general_queue(self) -> None:
        self.engine._dispatch({"method": "thread/started", "params": {"threadId": "nobody"}})
        self.assertEqual(len(self._drain(self.engine.events())), 1)

    def test_unsubscribing_stops_delivery(self) -> None:
        box = self.engine.subscribe("t1")
        self.engine.unsubscribe("t1", box)
        self.engine._dispatch({"method": "turn/completed", "params": {"threadId": "t1"}})
        self.assertEqual(self._drain(box), [])
        self.assertEqual(len(self._drain(self.engine.events())), 1)

    def test_unsubscribing_twice_is_harmless(self) -> None:
        box = self.engine.subscribe("t1")
        self.engine.unsubscribe("t1", box)
        self.engine.unsubscribe("t1", box)
        self.assertEqual(self.engine._subs, {})


class _Result:
    """The shape SessionStore.run reads off whatever it was given."""

    task = "t"
    model = "m"
    final = "done"
    error = ""
    seconds = 0.1
    steps = [object()]

    @property
    def ok(self) -> bool:
        return True

    def transcript(self) -> str:
        return "[FINAL] done"

    def to_dict(self) -> dict:
        return {"task": "t"}


class _Recorder:
    """A runner that does accept the conversation keyword."""

    def __init__(self) -> None:
        self.seen: dict = {}

    def run(self, task, workspace, harness, surface, *, on_step=None, conversation=None):
        self.seen["conversation"] = conversation
        self.seen["workspace"] = workspace
        return _Result()


class _PlainRunner:
    """A runner that predates the keyword and must still work."""

    def run(self, task, workspace, harness, surface, *, on_step=None):
        return _Result()


class SessionWorkspaceTests(unittest.TestCase):
    """A session may work anywhere; the choice is stored with it."""

    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "base"
        from rsi.sessions import SessionStore

        self.store = SessionStore(self.root)

    def test_a_new_session_starts_in_its_private_folder(self) -> None:
        session = self.store.create(title="t", model="m")
        self.assertEqual(session.workspace, "")
        self.assertTrue(session.private_workspace)
        self.assertEqual(
            session.workspace_dir, self.store.root / "sessions" / session.id / "workspace"
        )

    def test_a_chosen_folder_is_used_and_survives_a_reload(self) -> None:
        session = self.store.create(title="t", model="m")
        chosen = Path(self.root).parent / "elsewhere"
        self.store.set_workspace(session.id, chosen)
        again = self.store.get(session.id)
        self.assertEqual(Path(again.workspace), chosen.resolve())
        self.assertEqual(again.workspace_dir, chosen.resolve())
        self.assertFalse(again.private_workspace)

    def test_a_chosen_folder_is_created_when_it_does_not_exist(self) -> None:
        session = self.store.create(title="t", model="m")
        fresh = Path(self.root).parent / "not" / "there" / "yet"
        self.assertFalse(fresh.exists())
        self.store.set_workspace(session.id, fresh)
        self.assertTrue(fresh.is_dir())

    def test_a_file_is_not_a_workspace(self) -> None:
        session = self.store.create(title="t", model="m")
        a_file = Path(self.root).parent / "a.txt"
        a_file.write_text("x", encoding="utf-8")
        with self.assertRaises(Exception):
            self.store.set_workspace(session.id, a_file)

    def test_clearing_the_choice_returns_to_the_private_folder(self) -> None:
        session = self.store.create(title="t", model="m")
        self.store.set_workspace(session.id, Path(self.root).parent / "elsewhere")
        back = self.store.set_workspace(session.id, "")
        self.assertEqual(back.workspace, "")
        self.assertTrue(back.workspace_dir.is_dir())

    def test_two_sessions_may_share_a_folder_and_stay_separate(self) -> None:
        # This is the arrangement that used to leak: same directory, two
        # conversations. The store keeps them apart; the engine keys the
        # dialogue by session, not by directory.
        shared = Path(self.root).parent / "shared"
        one = self.store.create(title="one", model="m")
        two = self.store.create(title="two", model="m")
        self.store.set_workspace(one.id, shared)
        self.store.set_workspace(two.id, shared)
        self.assertEqual(
            self.store.get(one.id).workspace_dir, self.store.get(two.id).workspace_dir
        )
        self.assertNotEqual(one.id, two.id)

    def test_a_run_handing_the_session_id_to_a_runner_that_takes_it(self) -> None:
        from harness2.substrate.opencode import OPENCODE_SURFACE

        session = self.store.create(title="t", model="m")
        recorder = _Recorder()
        self.store.run(
            session.id,
            "do it",
            {"systemprompt.md": "s"},
            OPENCODE_SURFACE,
            agent=recorder,
            conversation=session.id,
        )
        self.assertEqual(recorder.seen["conversation"], session.id)

    def test_a_runner_without_the_keyword_is_not_told_about_it(self) -> None:
        # The keyword is optional on purpose: a scripted runner in a test, or
        # an older one, stops at on_step and must keep working.
        from harness2.substrate.opencode import OPENCODE_SURFACE

        session = self.store.create(title="t", model="m")
        plain = _PlainRunner()
        record = self.store.run(
            session.id,
            "do it",
            {"systemprompt.md": "s"},
            OPENCODE_SURFACE,
            agent=plain,
            conversation=session.id,
        )
        self.assertTrue(record.ok)


if __name__ == "__main__":
    unittest.main()
