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

"""The desktop window.

Qt rather than Tk because a run is a stream: tokens, tool calls and their
results arrive over a number of seconds, and a toolkit that cannot repaint an
append-only document turns every run into a blank stare followed by a finished
blob.

Fluent Widgets supplies the chrome only - the title bar, the theme engine, and
the widgets that already know how to follow it. The layout is ours, because the
window is three columns that each scroll on their own, and a navigation sidebar
cannot express that. Navigation is hidden for the same reason: the left column
*is* the navigation, so a second strip of icons beside it would be the same
decision offered twice.

The theme is not hard-coded anywhere in this file. Colours come from theme.py
through a single style sheet, labels carry both of their colours at once via
setTextColor, and switching is one qconfig write - see the appearance tab.
Anything that pins a colour for one theme would go stale the moment the other is
picked.

The shape follows the product it belongs to: a column that lists conversations
by recency and says what today cost, a canvas that stays empty until a
conversation has something to show, a composer that names the model it will run
with, and settings that are a place rather than a dialog.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from PySide6.QtCore import QSize, Qt, QThread, QTimer, Signal
from PySide6.QtGui import QFontMetrics
from PySide6.QtWidgets import (
    QApplication,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QListWidgetItem,
    QPushButton,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)
from qfluentwidgets import (
    Action,
    BodyLabel,
    CaptionLabel,
    ComboBox,
    FluentIcon,
    FluentWindow,
    IconWidget,
    ListWidget,
    OptionsSettingCard,
    PrimaryPushButton,
    RoundMenu,
    ScrollArea,
    SegmentedWidget,
    SettingCard,
    SettingCardGroup,
    StrongBodyLabel,
    StyleSheetBase,
    SubtitleLabel,
    TextEdit,
    Theme,
    TitleLabel,
    TransparentPushButton,
    isDarkTheme,
    qconfig,
    setCustomStyleSheet,
    setStyleSheet,
    setTheme,
    setThemeColor,
)

from . import __version__, itemtext, models, prefs, stats, transcript
from .theme import palette, shell_qss

# How much of a call's argument the card's header line keeps. The column of
# cards is read in one pass, so a brief that wraps turns a list of steps into a
# wall; the rest stays available on hover and in the body.
BRIEF_CHARS = 120

# How much width a session row has for its title. The column is a fixed width
# and the row's margins are fixed too, so this is a constant rather than a
# measurement: eliding with the metric needs a number anyway, and a number that
# matches the layout is honest about what it depends on.
ROW_TITLE_WIDTH = 190

PAGE_WORKSPACE = 0
PAGE_SETTINGS = 1

# The catalogue spells its efforts in its own words, and those words are what
# the engine is given. This only decides how the same value reads in a picker;
# anything not listed here is shown exactly as the catalogue wrote it.
EFFORT_TEXT = {
    "minimal": "极低",
    "low": "低",
    "medium": "中",
    "high": "高",
    "xhigh": "极高",
    "max": "最高",
}


def _effort_text(level: str) -> str:
    """How one effort level reads in a picker, falling back to its own spelling."""
    return EFFORT_TEXT.get(level, level)


def _window_text(seen: int, ceiling: int) -> str:
    """The context window as the catalogue states it.

    A model that states only what it currently runs with has no ceiling to
    show, and printing "192000 / 0" would read as a budget of zero rather than
    as a figure the catalogue does not carry.
    """
    if seen <= 0:
        return ""
    if ceiling <= 0:
        return str(seen)
    return f"{seen} / {ceiling}"

HERO_TITLE = "让 agent 动手做事"
HERO_NOTE = "写一个任务，它会读代码、改文件、跑命令。"

class Sheet(StyleSheetBase):
    """The window's single style sheet, rendered from whichever palette applies.

    Registering it once and letting the theme engine re-render it is what makes
    the theme switch one operation instead of a walk over every widget. It is
    also why nothing here needs to be rebuilt when the palette changes.
    """

    def content(self, theme: Theme = Theme.AUTO) -> str:
        active = qconfig.theme if theme in (None, Theme.AUTO) else theme
        return shell_qss(palette(active == Theme.DARK))


def _ink(label: Any, key: str) -> Any:
    """Give a label its colour for both themes at once.

    A single setTextColor takes one colour, and a widget styled for one theme is
    a widget that has to be rebuilt to look right in the other. Both at once is
    what makes the switch free.
    """
    label.setTextColor(palette(False)[key], palette(True)[key])
    return label


def _elide(text: str, width: int, widget: QWidget) -> str:
    return QFontMetrics(widget.font()).elidedText(
        text or "", Qt.TextElideMode.ElideRight, width
    )


class Box(QWidget):
    """A plain panel with a name the style sheet can select.

    CardWidget cannot be used for these: it paints its own background inside
    paintEvent, so a style sheet never reaches it and it stays one fixed colour
    in both themes.
    """

    def __init__(self, name: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName(name)
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)


class Composer(TextEdit):
    """The one-line-ish input. Enter sends, Shift+Enter breaks the line."""

    submitted = Signal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setPlaceholderText("描述你想让它做的事，Enter 发送，Shift+Enter 换行")
        # Transparent and borderless so it reads as the inside of the composer
        # box rather than a second box within it. setCustomStyleSheet rather
        # than setStyleSheet because the latter is a single value, not a pair,
        # and the placeholder and cursor colours still have to follow the
        # theme. Both strings are the same: only the background and border are
        # being overridden.
        plain = "QTextEdit { background: transparent; border: none; }"
        setCustomStyleSheet(self, plain, plain)

    def keyPressEvent(self, event: Any) -> None:
        if event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter):
            if not event.modifiers() & Qt.KeyboardModifier.ShiftModifier:
                self.submitted.emit()
                return
        super().keyPressEvent(event)


class Chip(QPushButton):
    """A small named control: workspace, model, and anything else to be picked.

    A QPushButton rather than a laid-out panel because it has to behave like a
    control - hover, focus, a click - and the style sheet can give it the flat
    rounded shape the rest of the window uses.
    """

    def __init__(
        self,
        text: str,
        icon: Any = None,
        parent: QWidget | None = None,
        name: str = "chipButton",
    ) -> None:
        super().__init__(parent)
        self.setObjectName(name)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        if icon is not None:
            self.setIcon(icon.icon() if hasattr(icon, "icon") else icon)
        self.setText(" " + text + "  \u2304")


class SessionRow(QWidget):
    """One conversation: what it is called, and how far along it is."""

    def __init__(self, title: str, meta: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("row")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        column = QVBoxLayout(self)
        column.setContentsMargins(10, 5, 10, 6)
        column.setSpacing(1)
        self.title = _ink(BodyLabel(), "text")
        self.title.setText(_elide(title, ROW_TITLE_WIDTH, self.title))
        self.title.setToolTip(title)
        self.meta = _ink(CaptionLabel(meta), "faint")
        column.addWidget(self.title)
        column.addWidget(self.meta)

    def sizeHint(self) -> QSize:
        return QSize(0, 52)


class ToolHead(Box):
    """The clickable header of a tool card.

    A panel with a click rather than a button, because a button would bring its
    own padding, hover fill and focus ring into a row whose colours already
    come from the sheet. Only the header takes the click: the body is text the
    reader may want to select, and a click there is not a request to fold.
    """

    clicked = Signal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__("toolHead", parent)
        self.setCursor(Qt.CursorShape.PointingHandCursor)

    def mouseReleaseEvent(self, event: Any) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit()
        super().mouseReleaseEvent(event)


class ToolCard(Box):
    """One tool call: a header that always shows, and a body that folds.

    The body is populated by whoever knows the call - a live run fills it as
    the result arrives, a stored session fills it from the transcript - which
    is why the two writers reach the same card through the same methods. The
    arrow is the fold state, and the fold is a plain show/hide: content-driven
    geometry means the scroll area needs no notification.
    """

    def __init__(self, name: str, brief: str, parent: QWidget | None = None) -> None:
        super().__init__("toolCard", parent)
        self._open = False
        self._brief = brief

        column = QVBoxLayout(self)
        column.setContentsMargins(0, 0, 0, 2)
        column.setSpacing(0)

        self._head = ToolHead(self)
        row = QHBoxLayout(self._head)
        row.setContentsMargins(8, 6, 12, 6)
        row.setSpacing(6)
        self._head.clicked.connect(self.toggle)

        self._arrow = IconWidget(self._head)
        self._arrow.setFixedSize(12, 12)
        self._arrow.setIcon(FluentIcon.CHEVRON_RIGHT)
        row.addWidget(self._arrow)

        self._name = _ink(StrongBodyLabel(name), "accent")
        row.addWidget(self._name)

        # One line, cut to 120 characters. A call's argument is a path more
        # often than not, and a wrapped path is what makes a column of calls
        # ragged and unreadable; the whole of it stays one hover away and the
        # body holds the rest.
        self._label = _ink(CaptionLabel(brief[:BRIEF_CHARS]), "muted")
        self._label.setWordWrap(False)
        if brief:
            self._label.setToolTip(brief)
            row.addWidget(self._label, 1)
        else:
            self._label.hide()
            row.addStretch(1)

        self._status = _ink(CaptionLabel(""), "muted")
        row.addWidget(self._status)

        self._body = QWidget(self)
        self._body_ink = QVBoxLayout(self._body)
        self._body_ink.setContentsMargins(30, 0, 14, 8)
        self._body_ink.setSpacing(3)
        self._body.hide()

        column.addWidget(self._head)
        column.addWidget(self._body)

        # The rest of the header is decoration around one click target, not a
        # set of smaller ones: a click on the name should fold the card too.
        for child in (self._arrow, self._name, self._label, self._status):
            child.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)

    def _fold(self, open_: bool) -> None:
        self._open = open_
        self._body.setVisible(open_)
        self._arrow.setIcon(FluentIcon.CHEVRON_DOWN_MED if open_ else FluentIcon.CHEVRON_RIGHT)

    def toggle(self) -> None:
        if not self._body_ink.count():
            return
        self._fold(not self._open)

    def result(self, ok: bool, ms: str) -> None:
        """Record how the call ended, and fold it back down to one line."""
        text = "\u2713  ok" if ok else "\u2715  fail"
        if ok and ms:
            text += " \u00b7 " + ms + "ms"
        self._status.setText(text)
        _ink(self._status, "ok" if ok else "fail")

    def detail(self, text: str, key: str = "muted") -> None:
        """Add a line to the body.

        This is the seam the arguments and the captured output will come
        through once the run reports them; today the only thing that reaches it
        is a brief too long for the header.
        """
        if not (text or "").strip():
            return
        label = _ink(CaptionLabel(text), key)
        label.setWordWrap(True)
        label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        self._body_ink.addWidget(label)

    def open_if_worth_it(self) -> None:
        """Unfold when the body has something the header could not show."""
        if not self._body_ink.count():
            return
        if not self._open:
            self._fold(True)


class StreamView(ScrollArea):
    """The transcript: one column of widgets, appended as events arrive."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWidgetResizable(True)
        self.setFrameShape(QFrame.Shape.NoFrame)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._open_card: QWidget | None = None
        self._open_body: QVBoxLayout | None = None
        self._hint: QWidget | None = None
        self._last_card: ToolCard | None = None

        self._inner = Box("streamInner")
        self._layout = QVBoxLayout(self._inner)
        self._layout.setContentsMargins(36, 20, 36, 20)
        self._layout.setSpacing(10)
        self._layout.addStretch(1)
        self.setWidget(self._inner)

    def _scroll_to_bottom(self) -> None:
        bar = self.verticalScrollBar()
        bar.setValue(bar.maximum())

    def _insert(self, widget: QWidget) -> None:
        # The empty-state hint is a placeholder, not a message: the first real
        # one displaces it rather than appearing underneath it.
        if self._hint is not None and widget is not self._hint:
            hint, self._hint = self._hint, None
            # Hidden as well as detached: deleteLater only queues the deletion,
            # and a widget that is already parented still paints itself into
            # the same rectangle until the queue is drained.
            hint.hide()
            hint.setParent(None)
            hint.deleteLater()
        self._layout.insertWidget(self._layout.count() - 1, widget)
        QTimer.singleShot(0, self._scroll_to_bottom)

    def has_answer(self, text: str) -> bool:
        """Whether the transcript already ends with this text.

        A finished run reports its final message separately from the tokens
        that produced it, so appending unconditionally prints the last
        paragraph twice. Comparing the tail is enough: the final message is by
        definition the end of the stream.
        """
        wanted = (text or "").strip()
        if not wanted:
            return True
        joined = ""
        for index in range(self._layout.count()):
            item = self._layout.itemAt(index)
            widget = item.widget() if item is not None else None
            if widget is None:
                continue
            labels = [widget] if isinstance(widget, QLabel) else []
            labels.extend(widget.findChildren(QLabel))
            for candidate in labels:
                if candidate.property("kind") == "answer":
                    joined += candidate.text()
        return joined.strip().endswith(wanted)

    def note(self, text: str) -> None:
        label = _ink(CaptionLabel(text), "muted")
        label.setWordWrap(True)
        self._insert(label)

    def heading(self, text: str) -> None:
        self._open_card = None
        self._open_body = None
        label = _ink(SubtitleLabel(text), "text")
        self._insert(label)

    def task(self, text: str) -> None:
        """The task a run was given, set apart from the work it produced."""
        label = _ink(StrongBodyLabel(text), "text")
        label.setWordWrap(True)
        label.setContentsMargins(0, 8, 0, 2)
        self._insert(label)

    def start_message(self) -> None:
        card = Box("bubble")
        body = QVBoxLayout(card)
        body.setContentsMargins(14, 10, 14, 10)
        body.setSpacing(4)
        self._open_card = card
        self._open_body = body
        self._insert(card)

    def append_token(self, text: str, *, thinking: bool = False) -> None:
        if self._open_card is None or self._open_body is None:
            self.start_message()
        assert self._open_body is not None
        want = "thinking" if thinking else "answer"
        label: QLabel | None = None
        last = self._open_body.itemAt(self._open_body.count() - 1)
        holder = last.widget() if last is not None else None
        if holder is not None and holder.property("kind") == want:
            label = holder  # type: ignore[assignment]
        if label is None:
            # A reasoning summary is context for the reader, not the answer, so
            # it gets the caption style - smaller and muted - rather than a
            # font-size override, which would pin one theme's colour.
            label = CaptionLabel("") if thinking else BodyLabel("")
            label.setWordWrap(True)
            label.setProperty("kind", want)
            _ink(label, "muted" if thinking else "text")
            self._open_body.addWidget(label)
        label.setText(label.text() + text)
        QTimer.singleShot(0, self._scroll_to_bottom)

    def finish_message(self) -> None:
        self._open_card = None
        self._open_body = None

    def message(self, text: str) -> None:
        """A completed message, boxed like the streaming one."""
        self.start_message()
        self.append_token(text)
        self.finish_message()

    def notice(self, name: str, brief: str) -> None:
        """A row for an event that is not a tool call: a retry, an approval.

        These arrive between a call and its result, so they must not become the
        card a following result attaches to - they are one line of context, not
        a step with an outcome of its own.
        """
        row = Box("tile")
        line = QHBoxLayout(row)
        line.setContentsMargins(12, 6, 12, 6)
        line.setSpacing(8)
        line.addWidget(_ink(StrongBodyLabel("\u25b8 " + name), "accent"))
        if brief:
            detail = _ink(CaptionLabel(brief[:BRIEF_CHARS]), "muted")
            detail.setWordWrap(True)
            line.addWidget(detail, 1)
        self._insert(row)

    def tool_call(self, name: str, brief: str) -> None:
        """One tool call, as a card whose header names it and whose body folds.

        The card is told nothing about the arguments or the output: a live run
        has not got the result yet when this is called, and a stored session
        never recorded either. What it carries is the one line the run does
        report, plus whatever of it did not fit.
        """
        card = ToolCard(name, brief)
        if len(brief) > BRIEF_CHARS:
            # The header gave up on the tail; the body is where it goes, and a
            # body with something in it starts unfolded.
            card.detail(brief)
            card.open_if_worth_it()
        self._last_card = card
        self._insert(card)

    def tool_result(self, ok: bool, ms: str) -> None:
        """Set the outcome on the card the call just added.

        A result with no card of its own means the transcript was entered
        mid-run; it still gets a line, because a bare outcome is worth more
        than silence.
        """
        if self._last_card is not None:
            self._last_card.result(ok, ms)
            return
        text = "\u2713  ok" if ok else "\u2715  fail"
        if ms:
            text += " \u00b7 " + ms + "ms"
        label = _ink(CaptionLabel(text), "ok" if ok else "fail")
        label.setContentsMargins(16, 0, 0, 4)
        self._insert(label)

    def clear(self) -> None:
        self._open_card = None
        self._open_body = None
        self._hint = None
        self._last_card = None
        while self._layout.count() > 1:
            item = self._layout.takeAt(0)
            widget = item.widget() if item is not None else None
            if widget is not None:
                # Same reason as _insert: detached first, otherwise every old
                # label keeps painting over the new transcript until the
                # deferred deletes run.
                widget.hide()
                widget.setParent(None)
                widget.deleteLater()

    def empty_state(self, text: str) -> None:
        label = _ink(CaptionLabel(text), "faint")
        label.setWordWrap(True)
        label.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        label.setContentsMargins(0, 72, 0, 0)
        self._insert(label)
        self._hint = label

    def render_session(self, session: Any, made: dict | None = None) -> None:
        """A stored session, as much like the run it recorded as the files allow.

        The tool calls are not in the session record - only the transcript has
        them - so they arrive separately, keyed by run id. Without them a
        reopened session showed a task, a summary line and an answer, with the
        work that produced the answer missing.
        """
        self.clear()
        runs = getattr(session, "runs", []) or []
        if not runs:
            self.empty_state("这个会话还没有运行过。")
            return
        for run in runs:
            self.task(run.task)
            head = "%d 步 \u00b7 %.1fs \u00b7 %s" % (
                run.steps,
                run.seconds,
                run.generation,
            )
            head += " \u00b7 ok" if run.ok else " \u00b7 失败"
            if run.tokens:
                head += " \u00b7 {:,} tok".format(run.tokens)
            self.note(head)
            for call in (made or {}).get(run.id, []):
                self.tool_call(call.name, call.brief)
                if call.ok is not None:
                    self.tool_result(call.ok, str(call.ms) if call.ms else "")
            if run.final:
                self.message(run.final)
            if run.error:
                label = _ink(CaptionLabel(run.error), "fail")
                label.setWordWrap(True)
                self._insert(label)


class RunThread(QThread):
    """One run, polled on its own thread so the window keeps painting."""

    token = Signal(str, bool)
    tool_call = Signal(str, str, bool)
    tool_result = Signal(bool, str)
    plan = Signal(list)
    began = Signal(str)
    finished = Signal(str, bool)
    failed = Signal(str)

    def __init__(
        self,
        service: Any,
        task: str,
        session_id: str,
        model: str = "",
        parent: QWidget | None = None,
        reasoning: str | None = None,
    ) -> None:
        super().__init__(parent)
        self._service = service
        self._task = task
        self._session_id = session_id
        self._model = model
        self._reasoning = reasoning
        self._stop = False

    def stop(self) -> None:
        self._stop = True

    def run(self) -> None:
        try:
            started = self._service.start(
                self._task,
                session=self._session_id,
                model=self._model or None,
                reasoning=self._reasoning,
            )
            run_id = started.get("run", "")
            # The window needs the id while the run is still going, to file the
            # calls it sees under the run whose transcript will hold them.
            self.began.emit(str(run_id))
            seen = 0
            state: dict = {}
            while not self._stop:
                for event in self._service.since(seen):
                    seen = event.get("seq", seen)
                    self._dispatch(event, run_id)
                state = self._service.state(run_id)
                if state.get("state") in ("done", "error"):
                    # The last few events are emitted before the run settles,
                    # so a reader that stops at the state transition drops the
                    # tail of every run - including its final message.
                    for event in self._service.since(seen):
                        seen = event.get("seq", seen)
                        self._dispatch(event, run_id)
                    break
                self.msleep(80)
            final = state.get("final") or ""
            ok = bool(state.get("ok"))
            error = state.get("error")
            if error:
                self.failed.emit(str(error))
            self.finished.emit(final, ok)
        except Exception as exc:  # noqa: BLE001 - reported, not swallowed
            self.failed.emit(type(exc).__name__ + ": " + str(exc))

    def _dispatch(self, event: dict, run_id: str) -> None:
        data = event.get("data") or {}
        if data.get("run") not in (None, run_id):
            return
        kind = event.get("kind", "")
        if kind == "step.message":
            thinking = data.get("thinking")
            assistant = data.get("assistant")
            if thinking:
                self.token.emit(str(thinking), True)
            if assistant:
                self.token.emit(str(assistant), False)
        elif kind == "tool.called":
            self.tool_call.emit(_tool_name(data), _brief(data.get("arguments")), True)
        elif kind == "tool.result":
            self.tool_result.emit(bool(data.get("ok", True)), str(data.get("ms") or ""))
        elif kind == "plan.updated":
            self.plan.emit(data.get("steps") or [])
        elif kind == "model.retry":
            self.tool_call.emit(
                "模型重试",
                "%s/%s" % (data.get("attempt", "?"), data.get("total", "?")),
                False,
            )
        elif kind == "approval.decided":
            allowed = "放行" if data.get("allowed") else "拒绝"
            self.tool_call.emit(
                "审批", allowed + "  " + str(data.get("path") or "")[:80], False
            )


def _tool_name(data: dict) -> str:
    return itemtext.label(str(data.get("name") or ""))


def _brief(arguments: Any) -> str:
    if not arguments:
        return ""
    if isinstance(arguments, str):
        return arguments[:120]
    if isinstance(arguments, dict):
        brief = arguments.get("brief")
        if isinstance(brief, str):
            return brief[:120]
    try:
        return json.dumps(arguments, ensure_ascii=False)[:120]
    except (TypeError, ValueError):
        return str(arguments)[:120]


def base_name(store_root: Path | str) -> str:
    """The folder the store belongs to, named the way the user would name it.

    rsi lays a base out as <project>/.rsi/store, so the interesting name is one
    level above the .rsi directory the store sits in. A store pointed anywhere
    else still gets something readable rather than a hex id.
    """
    base = Path(store_root)
    if base.name == "store":
        base = base.parent
    # Dot directories are where tooling hides itself (.rsi, .probe); naming the
    # workspace after one of those says less than the folder that holds it.
    for candidate in (base.parent.name, base.name):
        if candidate and not candidate.startswith("."):
            return candidate
    return "工作区"

class MainWindow(FluentWindow):
    """Workspace column, canvas, and the rail that says what the tools did."""

    def __init__(self, service: Any, store_root: Path) -> None:
        super().__init__()
        self._service = service
        self._store_root = Path(store_root)
        self._thread: RunThread | None = None
        self._current_session: Any = None
        # Calls seen live, by run id. A run's transcript is written when it
        # ends, so until then this is the only copy - and it is what lets the
        # rail survive clicking away from a run and back to it.
        self._made: dict[str, list[transcript.Call]] = {}
        self._running_run = ""
        self._prefs_path = self._store_root / prefs.DEFAULT_NAME
        self._prefs = prefs.load(self._prefs_path)
        # One answer for where the engine lives, used both for the catalogue and
        # for the runner: two answers would let the settings page list models
        # the runs are not started against.
        self._engine_home = models.home_for(self._store_root)
        self._catalog = models.catalog(self._engine_home)
        self._model = self._catalog.pick(prefs.text_of(self._prefs, "model"))
        self._build()
        self._load_sessions()
        self._refresh_chips()
        # Opening on the last session is what makes the window show working
        # state instead of an empty column. Left to a run's own finish, which
        # must not do this: reloading then would replace the streaming tokens
        # with the stored copy of the same run.
        if self._current_session is None:
            row = self._initial_row()
            if row >= 0:
                self.session_list.setCurrentRow(row)

    def _store(self) -> Any:
        return getattr(getattr(self._service, "app", None), "sessions", None)

    def _initial_row(self) -> int:
        """Which conversation to open on, or -1 for none.

        The list is newest first, and the newest is often an empty conversation
        that was created and left - opening there would greet the user with a
        blank canvas every time. So: the one they were last looking at, else the
        newest that actually ran something, else whatever is first.
        """
        sessions = self._sessions()
        wanted = prefs.text_of(self._prefs, "session")
        if wanted:
            for index, session in enumerate(sessions):
                if session.id == wanted:
                    return index
        for index, session in enumerate(sessions):
            if getattr(session, "runs", None):
                return index
        return 0 if sessions else -1

    def _remember(self, key: str, value: str) -> None:
        """Write one window choice. Failure is not worth a dialog."""
        if self._prefs.get(key) == value:
            return
        self._prefs[key] = value
        try:
            prefs.save(self._prefs_path, self._prefs)
        except OSError:
            pass

    # -- layout ---------------------------------------------------------

    def _build(self) -> None:
        self.setWindowTitle("RSI Harness")
        self.resize(1360, 880)
        self.setMicaEffectEnabled(False)
        self.navigationInterface.hide()
        self.widgetLayout.setContentsMargins(0, 48, 0, 0)

        shell = Box("shell")
        row = QHBoxLayout(shell)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(0)
        row.addWidget(self._build_side())
        row.addWidget(self._build_centre(), 1)
        row.addWidget(self._build_rail())
        # Registered rather than assigned: the theme engine re-renders every
        # registered sheet on a theme change, which is what keeps the switch to
        # one operation. A plain setStyleSheet would freeze this render.
        setStyleSheet(self, Sheet())
        self.stackedWidget.addWidget(shell)

    def _build_side(self) -> QWidget:
        side = Box("side")
        side.setFixedWidth(272)
        column = QVBoxLayout(side)
        column.setContentsMargins(14, 12, 14, 12)
        column.setSpacing(10)

        brand = QHBoxLayout()
        brand.setSpacing(6)
        mark = _ink(StrongBodyLabel("RSI Harness"), "text")
        version = _ink(CaptionLabel(__version__), "faint")
        brand.addWidget(mark)
        brand.addStretch(1)
        brand.addWidget(version)
        column.addLayout(brand)

        # The wordmark already sits in the title bar; this is the one action
        # the column exists for, so it gets the full width rather than an icon.
        new = QPushButton("\uff0b   新会话")
        new.setObjectName("newSession")
        new.setCursor(Qt.CursorShape.PointingHandCursor)
        new.setFixedHeight(34)
        new.clicked.connect(self._new_session)
        column.addWidget(new)

        label = _ink(CaptionLabel("工作区"), "faint")
        label.setContentsMargins(2, 6, 0, 0)
        column.addWidget(label)

        self.session_list = ListWidget()
        self.session_list.currentRowChanged.connect(self._on_session_picked)
        column.addWidget(self.session_list, 1)

        self.usage = _ink(CaptionLabel("今天还没有运行"), "faint")
        self.usage.setWordWrap(True)
        self.usage.setContentsMargins(2, 0, 0, 0)
        column.addWidget(self.usage)

        foot = QHBoxLayout()
        foot.setSpacing(6)
        self.workspace_button = Chip("工作区", FluentIcon.FOLDER)
        self.workspace_button.setToolTip(str(self._store_root.resolve()))
        # A chip that cannot be clicked is a label with a chevron on it. The
        # directory a session works in is a choice, so this opens the choice.
        self.workspace_button.clicked.connect(self._pick_workspace)
        foot.addWidget(self.workspace_button)
        foot.addStretch(1)
        self.settings_button = TransparentPushButton()
        self.settings_button.setText("设置")
        self.settings_button.setIcon(FluentIcon.SETTING)
        self.settings_button.clicked.connect(lambda: self._show_page(PAGE_SETTINGS))
        foot.addWidget(self.settings_button)
        column.addLayout(foot)
        return side

    def _build_centre(self) -> QWidget:
        centre = QWidget()
        column = QVBoxLayout(centre)
        column.setContentsMargins(0, 0, 0, 0)
        column.setSpacing(0)
        self.pages = QStackedWidget()
        self.pages.addWidget(self._build_workspace())
        self.pages.addWidget(self._build_settings())
        column.addWidget(self.pages, 1)
        return centre

    def _build_workspace(self) -> QWidget:
        page = QWidget()
        column = QVBoxLayout(page)
        column.setContentsMargins(0, 0, 0, 0)
        column.setSpacing(0)

        # The canvas holds two mutually exclusive things: the hero, which is
        # what an empty conversation looks like, and the transcript. Flipping
        # between them is what keeps the composer from having to move.
        self.canvas = QStackedWidget()
        self.canvas.addWidget(self._build_hero())
        self.stream = StreamView(page)
        self.canvas.addWidget(self.stream)
        column.addWidget(self.canvas, 1)

        foot = QWidget()
        outer = QVBoxLayout(foot)
        outer.setContentsMargins(36, 0, 36, 14)
        outer.setSpacing(8)

        box = Box("composer")
        inner = QVBoxLayout(box)
        inner.setContentsMargins(14, 10, 14, 10)
        inner.setSpacing(6)

        self.input = Composer()
        self.input.setFixedHeight(64)
        self.input.submitted.connect(self._send)
        inner.addWidget(self.input)

        line = QHBoxLayout()
        line.setSpacing(6)
        self.model_button = Chip("模型", FluentIcon.ROBOT)
        self.model_button.clicked.connect(self._pick_model)
        line.addWidget(self.model_button)
        # A conversation keeps the model it was actually run with. That record
        # is not the window's current choice, so it is shown beside the chip
        # rather than written back into it: opening a session must not change
        # what the next run will use.
        self.session_model = _ink(CaptionLabel(""), "faint")
        self.session_model.setVisible(False)
        line.addWidget(self.session_model)
        self.status = _ink(CaptionLabel("就绪"), "muted")
        line.addWidget(self.status)
        line.addStretch(1)
        self.send_button = PrimaryPushButton()
        self.send_button.setText("发送")
        self.send_button.setIcon(FluentIcon.SEND)
        self.send_button.setFixedHeight(32)
        self.send_button.clicked.connect(self._send)
        line.addWidget(self.send_button)
        inner.addLayout(line)

        outer.addWidget(box)
        column.addWidget(foot)
        return page

    def _build_hero(self) -> QWidget:
        hero = Box("hero")
        column = QVBoxLayout(hero)
        column.setContentsMargins(36, 0, 36, 24)
        column.setSpacing(10)
        column.addStretch(1)
        title = _ink(TitleLabel(HERO_TITLE), "text")
        title.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        note = _ink(CaptionLabel(HERO_NOTE), "faint")
        note.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        column.addWidget(title)
        column.addWidget(note)
        column.addStretch(1)
        return hero

    def _build_settings(self) -> QWidget:
        page = QWidget()
        column = QVBoxLayout(page)
        column.setContentsMargins(28, 20, 28, 20)
        column.setSpacing(12)

        head = QHBoxLayout()
        head.setSpacing(10)
        title = _ink(SubtitleLabel("设置"), "text")
        head.addWidget(title)
        head.addStretch(1)
        back = TransparentPushButton()
        back.setText("返回")
        back.setIcon(FluentIcon.RETURN)
        back.clicked.connect(lambda: self._show_page(PAGE_WORKSPACE))
        head.addWidget(back)
        column.addLayout(head)

        self.settings_tabs = SegmentedWidget()
        self.settings_tabs.addItem("appearance", "外观")
        self.settings_tabs.addItem("model", "模型")
        self.settings_tabs.addItem("reasoning", "推理")
        self.settings_tabs.addItem("about", "关于")
        self.settings_tabs.setCurrentItem("appearance")
        # SegmentedWidget routes by key, so the stack needs the same keys in
        # the same order and is switched on the route rather than on a signal
        # that also fires when the current item is set from code.
        self.settings_tabs.currentItemChanged.connect(self._on_settings_tab)
        column.addWidget(self.settings_tabs)

        self.settings_pages = QStackedWidget()
        self.settings_pages.addWidget(self._build_appearance())
        self.settings_pages.addWidget(self._build_model_form())
        self.settings_pages.addWidget(self._build_reasoning())
        self.settings_pages.addWidget(self._build_about())
        column.addWidget(self.settings_pages, 1)
        return page

    def _build_appearance(self) -> QWidget:
        body = Box("settingsBody")
        inner = QVBoxLayout(body)
        inner.setContentsMargins(0, 8, 0, 0)
        inner.setSpacing(14)

        group = SettingCardGroup("外观", body)
        # texts must line up with qconfig.themeMode.options, which is
        # [LIGHT, DARK, AUTO] - the card pairs them positionally.
        self.theme_card = OptionsSettingCard(
            qconfig.themeMode,
            FluentIcon.BRUSH,
            "主题",
            "浅色、深色，或跟随系统设置。",
            texts=["浅色", "深色", "跟随系统"],
        )
        self.theme_card.optionChanged.connect(self._on_theme_changed)
        group.addSettingCard(self.theme_card)
        inner.addWidget(group)
        inner.addStretch(1)
        return _scrolled(body)

    def _build_model_form(self) -> QWidget:
        body = Box("settingsBody")
        inner = QVBoxLayout(body)
        inner.setContentsMargins(0, 8, 0, 0)
        inner.setSpacing(14)

        group = SettingCardGroup("模型", body)
        card = SettingCard(FluentIcon.ROBOT, "默认模型", "新会话从这里开始。", body)
        # The catalogue is a file the engine reads, so the choices are known
        # before any run - and a picker built from it is a picker whose every
        # entry the engine will accept.
        self.model_combo = ComboBox(card)
        self.model_combo.setMinimumWidth(240)
        if self._catalog:
            for entry in self._catalog.models:
                self.model_combo.addItem(entry.label, userData=entry.id)
        else:
            self.model_combo.addItem("没有找到模型目录", userData="")
        self.model_combo.currentIndexChanged.connect(self._on_model_chosen)
        card.hBoxLayout.addWidget(self.model_combo, 0, Qt.AlignmentFlag.AlignRight)
        group.addSettingCard(card)
        inner.addWidget(group)

        note = _ink(
            CaptionLabel("模型目录来自引擎的配置文件；改这里只改默认值，已经跑过的会话保留自己的记录。"),
            "faint",
        )
        note.setWordWrap(True)
        inner.addWidget(note)
        inner.addStretch(1)
        return _scrolled(body)

    def _build_reasoning(self) -> QWidget:
        """The reasoning page: one model's effort and context budget.

        It follows the model picked on the previous tab rather than offering a
        second model picker, because the effort levels are the model's own -
        a page that let both be chosen independently could hold a pairing the
        engine would reject.

        Every section hides when the catalogue has nothing to say. A model whose
        entry carries no levels is not a model with one option; it is a model
        the catalogue is silent about, and an empty dropdown would claim the
        opposite.
        """
        body = Box("settingsBody")
        inner = QVBoxLayout(body)
        inner.setContentsMargins(0, 8, 0, 0)
        inner.setSpacing(14)

        self.reasoning_subject = _ink(CaptionLabel(""), "faint")
        self.reasoning_subject.setWordWrap(True)
        inner.addWidget(self.reasoning_subject)

        self.reasoning_group = SettingCardGroup("推理", body)
        self.reasoning_card = SettingCard(
            FluentIcon.SPEED_HIGH,
            "推理档位",
            "更高的档位思考更久，也更容易想透。",
            self.reasoning_group,
        )
        self.effort_combo = ComboBox(self.reasoning_card)
        self.effort_combo.setMinimumWidth(240)
        self.effort_combo.currentIndexChanged.connect(self._on_effort_chosen)
        self.reasoning_card.hBoxLayout.addWidget(
            self.effort_combo, 0, Qt.AlignmentFlag.AlignRight
        )
        self.reasoning_group.addSettingCard(self.reasoning_card)

        self.window_card = SettingCard(
            FluentIcon.IOT,
            "上下文窗口",
            "这个模型一次能记住多少。",
            self.reasoning_group,
        )
        self.window_value = _ink(BodyLabel(""), "text")
        self.window_card.hBoxLayout.addWidget(
            self.window_value, 0, Qt.AlignmentFlag.AlignRight
        )
        self.reasoning_group.addSettingCard(self.window_card)
        inner.addWidget(self.reasoning_group)

        self.reasoning_empty = _ink(CaptionLabel(""), "faint")
        self.reasoning_empty.setWordWrap(True)
        inner.addWidget(self.reasoning_empty)

        note = _ink(
            CaptionLabel(
                "档位来自引擎的模型目录，下一次发送就按它执行，不用重启窗口。"
            ),
            "faint",
        )
        note.setWordWrap(True)
        inner.addWidget(note)
        inner.addStretch(1)
        self._refresh_reasoning()
        return _scrolled(body)

    def _reasoning_model(self) -> models.Model | None:
        """The catalogue entry the reasoning page is about."""
        for entry in self._catalog.models:
            if entry.id == self._model:
                return entry
        return None

    def _refresh_reasoning(self) -> None:
        """Re-point the page at whatever model is now chosen.

        Called from the chip and from the model tab, so the three views of one
        value cannot drift apart.
        """
        if not hasattr(self, "reasoning_group"):
            return
        entry = self._reasoning_model()
        if entry is None:
            self.reasoning_subject.setText("")
            self.reasoning_group.setVisible(False)
            self.reasoning_empty.setText("没有找到模型目录，无法显示推理设置。")
            self.reasoning_empty.setVisible(True)
            return

        self.reasoning_subject.setText("当前模型  " + entry.label)

        shows_effort = entry.offers_reasoning
        self.reasoning_card.setVisible(shows_effort)
        self.effort_combo.blockSignals(True)
        try:
            self.effort_combo.clear()
            for level in entry.reasoning_levels:
                self.effort_combo.addItem(_effort_text(level), userData=level)
            wanted = self._effort_for(entry)
            index = self.effort_combo.findData(wanted) if wanted else -1
            if index >= 0:
                self.effort_combo.setCurrentIndex(index)
        finally:
            self.effort_combo.blockSignals(False)

        window = _window_text(entry.context_window, entry.max_context_window)
        self.window_card.setVisible(bool(window))
        self.window_value.setText(window)

        # The group is a container, so hiding both cards would still leave an
        # empty frame and a title over nothing.
        self.reasoning_group.setVisible(shows_effort or bool(window))
        self.reasoning_empty.setText(
            "" if (shows_effort or window) else "这个模型的目录项没有写明推理档位与上下文窗口。"
        )
        self.reasoning_empty.setVisible(not (shows_effort or window))

    def _effort_for(self, entry: models.Model) -> str:
        """The effort to show for a model: the remembered one, else its default.

        Remembered per model, because two models can spell the same ranking
        differently and a value carried across would name a level the second
        model does not have.
        """
        remembered = prefs.text_of(self._prefs, "effort." + entry.id)
        if remembered and remembered in entry.reasoning_levels:
            return remembered
        if entry.default_reasoning_level in entry.reasoning_levels:
            return entry.default_reasoning_level
        return entry.reasoning_levels[0] if entry.reasoning_levels else ""

    def _on_effort_chosen(self, index: int) -> None:
        """Record the effort for this model and use it for later runs.

        The value is kept per model in the window's own settings file: it is a
        choice about the window, and a session already run with one effort
        should keep saying so after the default is changed.
        """
        entry = self._reasoning_model()
        level = self.effort_combo.itemData(index)
        if entry is None or not isinstance(level, str) or not level:
            return
        self._remember("effort." + entry.id, level)
        self.status.setText(f"推理档位  {entry.name} · {_effort_text(level)}")

    def _build_about(self) -> QWidget:
        body = Box("settingsBody")
        inner = QVBoxLayout(body)
        inner.setContentsMargins(0, 8, 0, 0)
        inner.setSpacing(10)
        inner.addWidget(_ink(StrongBodyLabel("RSI Harness " + __version__), "text"))
        intro = _ink(
            CaptionLabel(
                "在 OpenHands 之上管理 harness 的生命周期：哪一代在跑、它是怎么来的、怎么退回去。"
            ),
            "muted",
        )
        intro.setWordWrap(True)
        inner.addWidget(intro)
        where = _ink(CaptionLabel("数据目录  " + str(self._store_root.resolve())), "faint")
        where.setWordWrap(True)
        inner.addWidget(where)
        engines = _ink(CaptionLabel("引擎目录  " + str(models.home_for(self._store_root).resolve())), "faint")
        engines.setWordWrap(True)
        inner.addWidget(engines)
        inner.addStretch(1)
        return _scrolled(body)

    def _build_rail(self) -> QWidget:
        rail = Box("rail")
        rail.setFixedWidth(264)
        column = QVBoxLayout(rail)
        column.setContentsMargins(14, 14, 14, 14)
        column.setSpacing(8)

        head = QHBoxLayout()
        head.setSpacing(6)
        title = _ink(StrongBodyLabel("工具"), "text")
        head.addWidget(title)
        head.addStretch(1)
        self.rail_count = _ink(CaptionLabel(""), "faint")
        head.addWidget(self.rail_count)
        column.addLayout(head)

        self.tool_log = ListWidget()
        column.addWidget(self.tool_log, 1)

        hint = _ink(CaptionLabel("这个会话里调用过的工具。"), "faint")
        hint.setWordWrap(True)
        column.addWidget(hint)
        return rail

    # -- pages ----------------------------------------------------------

    def _show_page(self, index: int) -> None:
        self.pages.setCurrentIndex(index)
        showing = index == PAGE_SETTINGS
        self.settings_button.setText("返回工作台" if showing else "设置")
        self.settings_button.setIcon(FluentIcon.RETURN if showing else FluentIcon.SETTING)

    def _on_settings_tab(self, key: str) -> None:
        order = ["appearance", "model", "reasoning", "about"]
        if key in order:
            self.settings_pages.setCurrentIndex(order.index(key))

    def _on_theme_changed(self, _item: Any) -> None:
        """Apply the choice the card already persisted.

        qconfig.set alone only records the value; the style sheets are
        re-rendered by setTheme, which is why writing the setting and applying
        it are two separate calls.
        """
        setTheme(qconfig.themeMode.value, save=False)
        setThemeColor(palette(isDarkTheme())["accent"], save=False)

    # -- sessions -------------------------------------------------------

    def _sessions(self) -> list:
        store = self._store()
        if store is None:
            return []
        return list(store.list())

    def _load_sessions(self) -> None:
        """Refill the list without disturbing the transcript.

        Adding the first row selects it, and a selection renders a session into
        the transcript - which, right after a run finishes, would replace the
        tokens that just streamed in with the stored copy of the same run. The
        list is therefore refilled silently and the previous session reselected
        by id rather than by position.
        """
        store = self._store()
        if store is None:
            self.status.setText("服务未提供会话存储")
            return
        wanted = getattr(self._current_session, "id", None)
        sessions = self._sessions()
        self.session_list.blockSignals(True)
        try:
            self.session_list.clear()
            keep = -1
            for index, session in enumerate(sessions):
                self.session_list.addItem(QListWidgetItem())
                self.session_list.setItemWidget(
                    self.session_list.item(index), self._session_row(session)
                )
                if session.id == wanted:
                    keep = index
            if keep >= 0:
                self.session_list.setCurrentRow(keep)
        finally:
            self.session_list.blockSignals(False)
        usage = stats.today(sessions)
        self.usage.setText(usage.text)
        self._refresh_chips()

    def _session_row(self, session: Any) -> SessionRow:
        title = session.title or "未命名会话"
        runs = getattr(session, "runs", []) or []
        if runs:
            meta = "%s \u00b7 %d 轮" % (stats.ago(session.updated_at), len(runs))
        else:
            meta = stats.ago(session.created_at)
        return SessionRow(title, meta)

    def _on_session_picked(self, row: int) -> None:
        sessions = self._sessions()
        if row < 0 or row >= len(sessions):
            return
        session = sessions[row]
        self._current_session = session
        self._remember("session", session.id)
        made = self._replay(session)
        # A conversation with nothing in it is the hero, not an empty
        # transcript: the column should look the same as a fresh window.
        if session.runs:
            self.canvas.setCurrentIndex(1)
            self.stream.render_session(session, made)
        else:
            self.canvas.setCurrentIndex(0)
            self.stream.clear()
        # The rail belongs to the session being shown. Left alone it kept
        # growing across every session in the window's lifetime, so the column
        # headed "what the tools did in this run" was showing all of them.
        self.tool_log.clear()
        total = 0
        for run in getattr(session, "runs", []) or []:
            for call in made.get(run.id, []):
                self._log_tool(call.name, call.brief)
                total += 1
        self.rail_count.setText(str(total) if total else "")
        self._refresh_chips()
        if self.pages.currentIndex() != PAGE_WORKSPACE:
            self._show_page(PAGE_WORKSPACE)

    def _replay(self, session: Any) -> dict:
        """The calls each run of a session made, by run id.

        A finished run's transcript is the record; the live copy is only kept
        for a run whose transcript is not there yet - which is a run that is
        still going, and so the one the window is currently watching.
        """
        store = self._store()
        made: dict = {}
        for run in getattr(session, "runs", []) or []:
            found: list = []
            if store is not None:
                try:
                    found = transcript.calls(store.transcript(session.id, run.id))
                except Exception:  # noqa: BLE001 - a run with no transcript is not fatal
                    found = []
            if not found:
                # Still running, so there is nothing on disk to read yet.
                found = list(self._made.get(run.id, []))
            made[run.id] = found
        return made

    def _new_session(self) -> None:
        store = self._store()
        if store is None:
            self.status.setText("没有可用的会话存储")
            return
        self._current_session = store.create(title="新会话", model=self._model)
        self.canvas.setCurrentIndex(0)
        self.stream.clear()
        self.tool_log.clear()
        self.rail_count.setText("")
        self._show_page(PAGE_WORKSPACE)
        self._load_sessions()
        self._refresh_chips()

    # -- picking --------------------------------------------------------

    def _refresh_chips(self) -> None:
        entry = None
        for candidate in self._catalog.models:
            if candidate.id == self._model:
                entry = candidate
                break
        label = entry.name if entry else (self._model or "默认模型")
        self.model_button.setText(" " + label + "  \u2304")
        self.model_button.setToolTip(entry.provider if entry else self._model)
        # The workspace chip belongs to the open conversation rather than to
        # the window: two sessions can work in two different folders.
        session = self._current_session
        recorded = getattr(session, "model", "") if session is not None else ""
        if recorded and recorded != self._model:
            self.session_model.setText(" 本会话记录：" + self._catalog_name(recorded))
            self.session_model.setVisible(True)
        else:
            self.session_model.setText("")
            self.session_model.setVisible(False)
        self.workspace_button.setText(" " + self._workspace_label(session) + "  \u2304")
        self.workspace_button.setToolTip(
            str(session.workspace_dir) if session is not None else str(self._store_root)
        )
        # The chip and the settings form are two views of one value, so
        # whichever was changed last, both are brought back into line here.
        self.model_combo.blockSignals(True)
        try:
            index = self.model_combo.findData(self._model)
            if index >= 0:
                self.model_combo.setCurrentIndex(index)
        finally:
            self.model_combo.blockSignals(False)
        # The reasoning page describes this same model, so the two are refreshed
        # together and neither can show a model the other does not.
        self._refresh_reasoning()

    def _catalog_name(self, model_id: str) -> str:
        """The readable name for a model id, or the id when it is not listed."""
        for candidate in self._catalog.models:
            if candidate.id == model_id:
                return candidate.name
        return model_id

    def _workspace_label(self, session: Any) -> str:
        """The folder name a session works in, or the window's default one."""
        if session is None:
            return base_name(self._store_root)
        chosen = str(getattr(session, "workspace", "") or "")
        if not chosen:
            return "默认目录"
        # base_name() reads the layout of a store, not of an arbitrary folder;
        # a chosen directory is named after itself.
        path = Path(chosen)
        return path.name or str(path)

    def _pick_workspace(self) -> None:
        """Choose the folder this conversation works in.

        The choice belongs to the conversation and is stored with it, so it
        survives a restart and does not follow the window into the next
        conversation. Offering the default back is not a nicety: without it a
        session that was pointed somewhere once could never come home.
        """
        store = self._store()
        if store is None:
            self.status.setText("没有可用的会话存储")
            return
        session = self._current_session
        if session is None:
            # The folder belongs to a conversation, so asking for one needs a
            # conversation to attach it to. Making it here is friendlier than
            # refusing and leaving the chip looking broken.
            session = store.create(title="新会话", model=self._model)
            self._current_session = session
            self._load_sessions()
        menu = self._workspace_menu(session)
        menu.exec(self.workspace_button.mapToGlobal(self.workspace_button.rect().topLeft()))

    def _workspace_menu(self, session: Any) -> RoundMenu:
        """The choices the workspace chip offers for one conversation."""
        menu = RoundMenu(parent=self.workspace_button)
        default = Action(menu, text="默认目录", checkable=True)
        default.setChecked(bool(session.private_workspace))
        default.triggered.connect(lambda _=False: self._set_workspace(session.id, ""))
        menu.addAction(default)
        menu.addSeparator()
        choose = Action(menu, text="选择目录…")
        choose.triggered.connect(lambda _=False: self._choose_folder(session.id))
        menu.addAction(choose)
        return menu

    def _choose_folder(self, session_id: str) -> None:
        session = self._current_session
        start = str(session.workspace_dir) if session is not None else str(self._store_root)
        chosen = QFileDialog.getExistingDirectory(
            self, "选择工作区", start, QFileDialog.Option.ShowDirsOnly
        )
        if chosen:
            self._set_workspace(session_id, chosen)

    def _set_workspace(self, session_id: str, folder: str) -> None:
        store = self._store()
        if store is None:
            return
        try:
            session = store.set_workspace(session_id, folder)
        except Exception as exc:  # noqa: BLE001 - a rejected folder is not fatal
            self.status.setText("无法使用这个目录：" + str(exc))
            return
        if getattr(self._current_session, "id", "") == session.id:
            self._current_session = session
        self._refresh_chips()
        # The chip already names the folder; the status line would only repeat
        # it, and a full path there pushes everything else out of the row.
        self.status.setText("就绪")

    def _pick_model(self) -> None:
        if not self._catalog:
            self.status.setText("没有找到模型目录")
            return
        menu = RoundMenu(parent=self.model_button)
        for entry in self._catalog.models:
            action = Action(menu, text=entry.label, checkable=True)
            action.setChecked(entry.id == self._model)
            action.triggered.connect(lambda _=False, chosen=entry.id: self._set_model(chosen))
            menu.addAction(action)
        menu.exec(self.model_button.mapToGlobal(self.model_button.rect().topLeft()))

    def _set_model(self, model_id: str) -> None:
        self._model = model_id
        self._remember("model", model_id)
        # The conversation on screen keeps the model it was run with: a new
        # choice applies to the next run, and rewriting the stored record would
        # make a session claim it ran with something it never did.
        self._refresh_chips()

    def _on_model_chosen(self, index: int) -> None:
        model_id = self.model_combo.itemData(index)
        if model_id and model_id != self._model:
            self._set_model(str(model_id))

    # -- running --------------------------------------------------------

    def _effort_now(self) -> str | None:
        """The effort to send with the next run, or None for the model's default.

        A model that lists no levels, or a catalogue the window cannot find the
        chosen model in, sends nothing: the service treats None as "use the
        model's own default", which is the only honest answer when the window
        has no level to name.
        """
        entry = self._reasoning_model()
        if entry is None or not entry.offers_reasoning:
            return None
        chosen = self._effort_for(entry)
        return chosen or None

    def _send(self) -> None:
        if self._thread is not None and self._thread.isRunning():
            return
        task = self.input.toPlainText().strip()
        if not task:
            return
        store = self._store()
        if store is None:
            self.status.setText("没有可用的会话存储")
            return
        if self._current_session is None:
            self._current_session = store.create(title=task[:40], model=self._model)
            self._load_sessions()
            # A brand new conversation starts its own account of the work; a
            # conversation that already has one keeps it, or the rail would
            # only ever show the run that happens to be going while the label
            # above it claims to list the whole session.
            self.tool_log.clear()
            self.rail_count.setText("")
        session_id = getattr(self._current_session, "id", "")

        self.input.clear()
        self.canvas.setCurrentIndex(1)
        self.stream.task(task)
        self.stream.start_message()
        self._running_run = ""
        self.status.setText("运行中…")
        self.send_button.setEnabled(False)

        self._thread = RunThread(
            self._service, task, session_id, self._model, self, self._effort_now()
        )
        self._thread.token.connect(self._on_token)
        self._thread.tool_call.connect(self._on_tool_call)
        self._thread.began.connect(self._on_began)
        self._thread.tool_result.connect(self._on_tool_result)
        self._thread.plan.connect(self._on_plan)
        self._thread.finished.connect(self._on_finished)
        self._thread.failed.connect(self._on_failed)
        self._thread.start()

    def _on_token(self, text: str, thinking: bool) -> None:
        self.stream.append_token(text, thinking=thinking)

    def _on_began(self, run_id: str) -> None:
        self._running_run = run_id

    def _on_tool_call(self, name: str, brief: str, real: bool) -> None:
        # A real call becomes the card the next result fills in. A retry or an
        # approval verdict is a line between calls, and letting it take that
        # place would hang the following result on the wrong row.
        if real:
            self.stream.tool_call(name, brief)
        else:
            self.stream.notice(name, brief)
        # Only real calls are recorded. The same signal also carries retries and
        # approval verdicts, which are worth a row but are not in the transcript
        # this is filed against - they would double up when it is replayed.
        if real and self._running_run:
            self._made.setdefault(self._running_run, []).append(
                transcript.Call(name=name, brief=brief)
            )
        self._log_tool(name, brief)

    def _log_tool(self, name: str, brief: str) -> None:
        text = name + ("  " + brief if brief else "")
        item = QListWidgetItem(text)
        # A path is wider than the rail, so the row shows a cut-down version and
        # keeps the whole thing one hover away.
        item.setToolTip(text)
        self.tool_log.addItem(item)
        self.tool_log.scrollToItem(item)
        self.rail_count.setText(str(self.tool_log.count()))

    def _on_tool_result(self, ok: bool, ms: str) -> None:
        self.stream.tool_result(ok, ms)
        kept = self._made.get(self._running_run) or []
        if kept:
            # The result belongs to the call just above it, which is the one the
            # reader is looking at while the run is still going.
            last = kept[-1]
            kept[-1] = transcript.Call(
                name=last.name,
                brief=last.brief,
                ok=ok,
                ms=int(ms) if str(ms).isdigit() else 0,
            )

    def _on_plan(self, steps: list) -> None:
        done = sum(1 for step in steps if str(step.get("status")) == "completed")
        self.status.setText("计划 %d/%d" % (done, len(steps)))

    def _on_finished(self, final: str, ok: bool) -> None:
        self.stream.finish_message()
        if final and not self.stream.has_answer(final):
            # Normally the tokens already printed this; a run that answered in
            # one piece emits no deltas, and saying nothing would drop it.
            self.stream.message(final)
        self.stream.note("完成" if ok else "未成功")
        self.status.setText("就绪" if ok else "未成功")
        self.send_button.setEnabled(True)
        self._load_sessions()

    def _on_failed(self, message: str) -> None:
        self.stream.finish_message()
        self.stream.note("出错：" + message)
        self.status.setText("出错")
        self.send_button.setEnabled(True)

    def closeEvent(self, event: Any) -> None:
        if self._thread is not None and self._thread.isRunning():
            self._thread.stop()
            self._thread.wait(3000)
        super().closeEvent(event)


def _scrolled(body: QWidget) -> QWidget:
    """Put a settings body in a scroll area, the way every settings page wants."""
    scroll = ScrollArea()
    scroll.setWidgetResizable(True)
    scroll.setFrameShape(QFrame.Shape.NoFrame)
    scroll.setWidget(body)
    return scroll


def _option(argv: list[str], name: str, fallback: str) -> str:
    if name in argv:
        index = argv.index(name)
        if index + 1 < len(argv):
            return argv[index + 1]
    return fallback


def arguments_store(argv: list[str]) -> str:
    return _option(argv, "--store", os.environ.get("RSI_STORE", ".rsi/store"))


def arguments_sessions(argv: list[str]) -> str:
    return _option(argv, "--sessions", "")


def build_app(argv: list[str] | None = None) -> tuple[QApplication, MainWindow]:
    args = list(sys.argv if argv is None else argv)
    app = QApplication.instance() or QApplication(args)

    store_root = Path(arguments_store(args))
    # The setting lives beside the store, and the path has to be absolute:
    # QConfig.load defaults to a path relative to whatever the process happens
    # to have as its working directory.
    qconfig.load(str((store_root / "desktop.json").resolve()))
    setTheme(qconfig.themeMode.value, save=False)
    setThemeColor(palette(isDarkTheme())["accent"], save=False)

    from harness2.substrate.opencode import OPENCODE_SURFACE

    from .server import session_executor
    from .service import Service
    from .sessions import SessionStore
    from .store import ensure_ready

    # The path given is the store itself, not the directory above it. Joining
    # another "store" onto it put the generations one level too deep, and the
    # session directory - which is the store's parent - then pointed at a
    # directory with no sessions in it, which is a window with an empty column.
    generations = store_root
    ensure_ready(generations, OPENCODE_SURFACE)

    sessions_root = arguments_sessions(args)
    sessions = SessionStore(Path(sessions_root)) if sessions_root else None

    service = Service.spawn(
        store_root=generations,
        surface=OPENCODE_SURFACE,
        sessions=sessions,
    )
    # The window reads the model catalogue from this home, so the runner must
    # start against the same one - otherwise the list on screen and the engine
    # behind it can be two different installations.
    home = models.home_for(store_root)

    def make_runner(model: str | None = None) -> Any:
        from .backend import make_backend

        return make_backend("openhands", home=home, model=model or None)

    service.app.executor = session_executor(
        service.app.store,
        service.app.sessions,
        OPENCODE_SURFACE,
        agent_factory=make_runner,
    )

    window = MainWindow(service, store_root)
    window._service_to_close = service
    return app, window


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv if argv is None else argv)
    _adopt_quiet_streams(args)
    app, window = build_app(args)
    window.show()
    service = getattr(window, "_service_to_close", None)
    try:
        return app.exec()
    finally:
        if service is not None:
            service.close()


def _adopt_quiet_streams(args: list[str]) -> None:
    """Give the process readable streams when it was started without a console.

    `pythonw` leaves `sys.stdout` and `sys.stderr` as `None`, and the OpenHands
    terminal tool reads `sys.stdout.encoding` while it is imported. A window
    started that way therefore died on the first run with an AttributeError from
    inside a library, while the same code under `python.exe` worked. A console
    the user never sees is the wrong place for an agent run's output anyway, so
    the missing streams are pointed at a file beside the store rather than
    re-created.
    """
    if sys.stdout is not None and sys.stderr is not None:
        return
    sink_path = Path(arguments_store(args)) / "desktop.log"
    sink_path.parent.mkdir(parents=True, exist_ok=True)
    sink = open(sink_path, "a", encoding="utf-8", errors="replace")  # noqa: SIM115 - lives as long as the process
    if sys.stdout is None:
        sys.stdout = sink
    if sys.stderr is None:
        sys.stderr = sink


__all__ = ["MainWindow", "StreamView", "RunThread", "build_app", "main"]
