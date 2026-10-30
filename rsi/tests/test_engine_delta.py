"""What a turn's final answer is, when the model sent more than one message.

A turn can carry several agentMessages -- an aside, a correction, then the
answer. Each arrives as its own itemId, and joining every delta into one string
ran the earlier ones into the last: "...first.The first shell choice...ANSWER:
27". These cases pin the rule that decides which one is the answer.
"""

from __future__ import annotations

import queue
import unittest

from rsi.agent import AgentRun, Step
from rsi.engine import AgentRunner, Engine

THREAD = "thread-1"
TURN = "turn-1"


def delta(item_id: str, text: str) -> dict:
    """One agentMessage delta, as the engine sends it."""
    return {
        "method": "item/agentMessage/delta",
        "params": {"threadId": THREAD, "turnId": TURN, "itemId": item_id, "delta": text},
    }


def completed() -> dict:
    """The notification that ends the turn."""
    return {
        "method": "turn/completed",
        "params": {"threadId": THREAD, "turnId": TURN, "turn": {"status": "completed"}},
    }


class DeltaGroupingTests(unittest.TestCase):
    """The final answer is the last message that said anything, not all of them."""

    def consume(self, messages: list[dict]) -> tuple[AgentRun, Step]:
        box: queue.Queue = queue.Queue()
        for message in messages:
            box.put(message)
        box.put(completed())
        runner = AgentRunner(engine=Engine(), timeout=1.0)
        step, run = Step(index=0), AgentRun(task="t", model="m")
        runner._consume(None, box, lambda kind, data: None, step, run, THREAD, TURN)
        return run, step

    def test_interleaved_messages_yield_only_the_last_one(self) -> None:
        """Two items whose deltas interleave. Joining by arrival order would
        produce "first.ANSWER: 27" plus whatever the aside said in between."""
        run, step = self.consume(
            [
                delta("item-a", "The first shell choice. "),
                delta("item-b", "ANSWER: 27"),
                delta("item-a", "It was wrong."),
            ]
        )
        self.assertEqual(run.final, "ANSWER: 27")
        self.assertEqual(step.assistant, "ANSWER: 27")

    def test_the_last_message_is_not_glued_to_the_earlier_ones(self) -> None:
        """The symptom this fix exists for, stated as absence rather than by
        equality: nothing from the earlier message may survive into the answer."""
        run, _ = self.consume(
            [
                delta("item-a", "first."),
                delta("item-a", "The first shell choice was wrong. "),
                delta("item-b", "ANSWER: 27"),
            ]
        )
        self.assertNotIn("first.", run.final)
        self.assertNotIn("shell choice", run.final)
        self.assertEqual(run.final, "ANSWER: 27")

    def test_a_single_message_is_unchanged(self) -> None:
        """The regression guard: the common case must read exactly as it did
        when every delta was concatenated."""
        run, step = self.consume(
            [delta("item-a", "ANSWER"), delta("item-a", ": "), delta("item-a", "27")]
        )
        self.assertEqual(run.final, "ANSWER: 27")
        self.assertEqual(step.assistant, "ANSWER: 27")

    def test_an_empty_last_message_falls_back_to_the_one_before_it(self) -> None:
        """A started-but-blank message still enters the map, so the walk has to
        skip it by text rather than by presence. Without this case the `if text`
        in the join could be deleted and every other test would stay green --
        the turn would then report an empty answer for a turn that answered."""
        run, _ = self.consume(
            [
                delta("item-a", "ANSWER: 27"),
                delta("item-b", "   "),
            ]
        )
        self.assertEqual(run.final, "ANSWER: 27")

    def test_a_whitespace_only_message_alone_is_empty(self) -> None:
        run, _ = self.consume([delta("item-a", "  ")])
        self.assertEqual(run.final, "")

    def test_no_message_at_all_leaves_the_answer_empty(self) -> None:
        """A turn that only called tools has no agentMessage; the answer is
        empty rather than the last tool's output."""
        run, step = self.consume([])
        self.assertEqual(run.final, "")
        self.assertEqual(step.assistant, "")

    def test_the_stream_still_carries_every_delta(self) -> None:
        """The UI watches deltas as they arrive. Grouping is about the turn's
        final value only -- the stream must not start dropping pieces."""
        seen: list[str] = []
        box: queue.Queue = queue.Queue()
        for message in [delta("item-a", "one"), delta("item-b", "two")]:
            box.put(message)
        box.put(completed())
        runner = AgentRunner(engine=Engine(), timeout=1.0)
        step, run = Step(index=0), AgentRun(task="t", model="m")
        runner._consume(
            None, box,
            lambda kind, data: seen.append(data["assistant"]) if kind == "step.message" else None,
            step, run, THREAD, TURN,
        )
        self.assertEqual(seen, ["one", "two"])


if __name__ == "__main__":
    unittest.main()
