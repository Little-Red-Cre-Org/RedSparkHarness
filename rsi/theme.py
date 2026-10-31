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

"""Two palettes and the one style sheet built from them.

The colours are the design tokens this product uses in its own web client
(packages/client/ui-theme, design-platform.css), copied by value so the desktop
window and the product it belongs to read as one thing. A token that changes
there should change here; the names are kept close to theirs to make that
mechanical.

Two departures from the token file, both forced by Qt rather than chosen:

* `line` is a solid hex value, not `rgba(0, 0, 0, 0.10)`. Qt's style sheet
  parser reads an rgba alpha as an integer out of 255, so the fractional form
  in the token file renders as a fully transparent border and the border simply
  disappears. Each hex below is that colour composited over `bg`.
* `side` and `hover` are added. The web client gets its second surface level
  from CSS variables with no token name, and the three-column shell needs one.

Everything in this module is pure: strings and dicts, no Qt. The window asks
for a palette and a style sheet, and the Qt plumbing lives in desktop.py.
"""

from __future__ import annotations

LIGHT = {
    "bg": "#ffffff",
    "side": "#f7f8fa",
    "layer": "#f4f5f7",
    "layer_alt": "#eceef2",
    "line": "#e6e7ea",
    "line_strong": "#d5d7dd",
    "text": "#0f1115",
    "muted": "#61666b",
    "faint": "#81858c",
    "accent": "#4176e6",
    "ok": "#22c55e",
    "fail": "#ec1313",
    "warn": "#f59e0b",
    "mark": "#4176e6",
    "hover": "#eef0f4",
}

DARK = {
    "bg": "#151517",
    "side": "#1b1b1d",
    "layer": "#232324",
    "layer_alt": "#2c2c2e",
    "line": "#2f2f31",
    "line_strong": "#3a3a3d",
    "text": "#f9fafb",
    "muted": "#adb2b8",
    "faint": "#979da6",
    "accent": "#7aaaff",
    "ok": "#4ed17e",
    "fail": "#f25a5a",
    "warn": "#f7ad31",
    "mark": "#7aaaff",
    "hover": "#262628",
}


def palette(dark: bool) -> dict:
    """The palette for a mode. One entry point, so nothing guesses."""
    return DARK if dark else LIGHT


def shell_qss(colors: dict) -> str:
    """The one sheet the window carries; child selectors cascade from it.

    A sheet per widget would have to be re-applied on every theme change and
    would drift from this one the first time a colour was added. One sheet is
    also what makes the switch a single operation.

    The panels are named plain QWidgets rather than CardWidget: CardWidget
    paints its own background in paintEvent, so a style sheet cannot reach it
    and it stays the wrong colour in one of the two themes.
    """
    return """
QWidget#shell { background: %(bg)s; }
QWidget#side { background: %(side)s; border-right: 1px solid %(line)s; }
QWidget#rail { background: %(side)s; border-left: 1px solid %(line)s; }
QWidget#tile, QWidget#toolCard { background: %(layer)s; border: 1px solid %(line)s; border-radius: 10px; }
QWidget#toolHead { background: transparent; border: none; border-radius: 9px; }
QWidget#toolHead:hover { background: %(hover)s; }
QWidget#bubble { background: %(layer)s; border: 1px solid %(line)s; border-radius: 12px; }
QWidget#composer { background: %(layer)s; border: 1px solid %(line)s; border-radius: 12px; }
QWidget#card { background: %(layer)s; border: 1px solid %(line)s; border-radius: 10px; }
QWidget#chip { background: %(layer)s; border: 1px solid %(line)s; border-radius: 9px; }
QWidget#chip:hover { background: %(hover)s; }
QWidget#streamInner, QWidget#settingsBody { background: transparent; }
QWidget#hero, QWidget#row, QWidget#navStrip { background: transparent; }
QPushButton#newSession {
    background: %(layer)s; border: 1px solid %(line)s; border-radius: 8px;
    color: %(text)s; font-size: 13px; padding: 8px 12px;
}
QPushButton#newSession:hover { background: %(hover)s; }
QPushButton#chipButton {
    background: %(layer_alt)s; border: 1px solid %(line)s; border-radius: 7px;
    color: %(text)s; font-size: 12px; padding: 4px 10px;
}
QPushButton#chipButton:hover { background: %(hover)s; }
QPushButton#chipButton:disabled { color: %(faint)s; }
QListWidget { background: transparent; border: none; }
QScrollArea { background: transparent; border: none; }
QScrollArea > QWidget > QWidget { background: transparent; }
""" % colors


__all__ = ["LIGHT", "DARK", "palette", "shell_qss"]
