"""What the reasoning page hands to a run.

The page is the only place an effort is chosen, and the run is the only place
it matters, so these cover the hand-off: a model whose catalogue entry lists
levels passes the chosen one, and a model that lists none passes nothing at
all. The window is built against a stand-in service: nothing here starts an
engine or touches the network.
"""

import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication

from rsi import desktop, models


class _Service:
    """A service that records the request instead of posting it."""

    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.app = None

    def start(self, task, *, session=None, model=None, reasoning=None):
        self.sent.append({"model": model, "reasoning": reasoning})
        return {"run": "fake"}

    def since(self, seen):
        return []

    def state(self, run_id):
        return {"state": "done"}


class EffortHandoffTests(unittest.TestCase):
    def setUp(self) -> None:
        self.app = QApplication.instance() or QApplication([])
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "store"
        self.root.mkdir(parents=True)
        self.service = _Service()
        self.window = desktop.MainWindow(self.service, self.root)
        self.addCleanup(self.window.deleteLater)

    def test_chosen_level_reaches_the_run(self) -> None:
        self.window._set_model("workbuddy/hy3")
        self.window._refresh_reasoning()
        index = self.window.effort_combo.findData("low")
        self.assertGreaterEqual(index, 0)
        self.window.effort_combo.setCurrentIndex(index)

        self.assertEqual(self.window._effort_now(), "low")

        desktop.RunThread(
            self.service, "t", "s1", self.window._model, None, self.window._effort_now()
        ).run()
        self.assertEqual(self.service.sent[-1]["reasoning"], "low")

    def test_model_without_levels_sends_nothing(self) -> None:
        self.window._catalog = models.Catalog(
            models=(models.Model(id="x/plain", name="Plain"),), default="x/plain"
        )
        self.window._model = "x/plain"
        self.window._refresh_reasoning()

        self.assertIsNone(self.window._effort_now())
        desktop.RunThread(
            self.service, "t", "s1", "x/plain", None, self.window._effort_now()
        ).run()
        self.assertIsNone(self.service.sent[-1]["reasoning"])

    def test_missing_catalogue_entry_sends_nothing(self) -> None:
        self.window._catalog = models.Catalog(models=(), default="")
        self.window._model = "gone/model"
        self.assertIsNone(self.window._effort_now())

    def test_effort_card_hidden_when_model_advertises_no_levels(self) -> None:
        self.window._catalog = models.Catalog(
            models=(models.Model(id="x/plain", name="Plain"),), default="x/plain"
        )
        self.window._model = "x/plain"
        self.window._refresh_reasoning()
        self.assertTrue(self.window.reasoning_card.isHidden())
        self.assertEqual(self.window.effort_combo.count(), 0)

    def test_remembered_level_is_per_model(self) -> None:
        self.window._set_model("workbuddy/hy3")
        self.window._refresh_reasoning()
        index = self.window.effort_combo.findData("low")
        self.window.effort_combo.setCurrentIndex(index)

        self.window._set_model("grok/grok-4.7@500k")
        self.window._refresh_reasoning()
        self.assertEqual(self.window._effort_now(), "medium")

        self.window._set_model("workbuddy/hy3")
        self.window._refresh_reasoning()
        self.assertEqual(self.window._effort_now(), "low")


class _StoreService(_Service):
    """The same stand-in, plus a real session store the window can read."""

    def __init__(self, root: Path) -> None:
        super().__init__()
        from rsi.sessions import SessionStore

        class _App:
            pass

        self.app = _App()
        self.app.sessions = SessionStore(root)


class SessionModelIsReadOnlyTests(unittest.TestCase):
    """Opening a conversation shows what it ran with; it does not choose for it.

    The two facts are different: the window's choice decides the next run, the
    stored record says what the past runs used. Writing the record back into
    the choice made browsing history silently change the next run's model.
    """

    def setUp(self) -> None:
        self.app = QApplication.instance() or QApplication([])
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "store"
        self.root.mkdir(parents=True)
        self.service = _StoreService(self.root)
        self.window = desktop.MainWindow(self.service, self.root)
        self.addCleanup(self.window.deleteLater)

    def test_opening_a_session_keeps_the_window_choice(self) -> None:
        store = self.window._store()
        session = store.create(title="旧的", model="workbuddy/hy3")
        self.window._set_model("grok/grok-4.7@500k")

        rows = self.window._sessions()
        row = next(i for i, s in enumerate(rows) if s.id == session.id)
        self.window._on_session_picked(row)

        self.assertEqual(self.window._model, "grok/grok-4.7@500k")
        self.assertEqual(self.window._current_session.model, "workbuddy/hy3")

    def test_choosing_a_model_leaves_the_session_record_alone(self) -> None:
        store = self.window._store()
        session = store.create(title="旧的", model="workbuddy/hy3")
        self.window._current_session = session

        self.window._set_model("grok/grok-4.7@500k")

        self.assertEqual(session.model, "workbuddy/hy3")
        self.assertEqual(self.window._model, "grok/grok-4.7@500k")
        self.assertEqual(store.get(session.id).model, "workbuddy/hy3")


if __name__ == "__main__":
    unittest.main()
