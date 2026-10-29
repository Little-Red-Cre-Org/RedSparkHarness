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

"""The provider blocks in the engine's config, read honestly and written surgically.

Reading goes through `tomllib`, because the engine and this module must agree on
what the file says: a hand-rolled reader would eventually disagree about escapes
or inline tables and the settings page would show a value the engine never sees.

Writing does NOT re-serialise. `tomllib` cannot write, and the alternatives are a
new dependency or a whole-file rewrite that would silently drop the comments, the
blank lines and the ordering a person put there by hand. So a write locates the
one line that holds the key and replaces the value on it, leaving every other
byte of the file exactly as it was. That also means a key this module does not
understand cannot be damaged by a write to a key next to it.

A thread binds its provider when it starts and never re-reads the config, so a
write here reaches the engine only once it starts a new thread. `AgentRunner`
compares a fingerprint of the parsed config on every run and drops its thread
cache when it moves, so a saved change lands on the next run without a restart.
Restarting the process is deliberately somebody else's job: a module that both
edits a file and owns a process cannot be tested with a file.
"""

from __future__ import annotations

import os
import re
import time
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .store import make_writable

# The file the engine reads from its home.
CONFIG_NAME = "config.toml"

# How long a save waits for a concurrent reader to let go of the file, and how
# often it tries. The engine holds it only for one read, so this is a
# comfortable multiple of the milliseconds that costs.
REPLACE_ATTEMPTS = 20
REPLACE_PAUSE = 0.01

# The section a provider block lives in, and the name of the key that picks one.
PROVIDERS_TABLE = "model_providers"
ACTIVE_KEY = "model_provider"

# What a caller may change. Nothing else is writable: adding or removing a
# provider needs a whole block, which is a different operation with different
# failure modes, and is not part of this surface.
#
# `env_key` is here because it is the only one of these that can *reduce* what
# the file holds: a provider that names an environment variable keeps no
# literal secret on disk. Leaving it out would make the safer choice the one
# the settings page cannot offer.
WRITABLE_KEYS = ("base_url", "wire_api", "experimental_bearer_token", "env_key")

# The name a client uses for the credential. The engine calls the field
# `experimental_bearer_token`; the settings page should not have to know that a
# secret is spelled with the name of an experiment.
KEY_ALIASES = {"api_key": "experimental_bearer_token"}

# The two ways a provider can hold a credential. They are alternatives, not
# companions: the engine reads the literal token first and never looks at
# `env_key` when one is present, so a block holding both silently ignores the
# variable. A write that names both is refused rather than allowed to create
# that state.
TOKEN_KEY = "experimental_bearer_token"
ENV_KEY = "env_key"

# An environment variable name, and nothing else. A value that is merely
# non-empty would let `env_key = "my key"` reach the file and fail at the next
# run with a lookup error nobody can place.
_ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# The wires the engine can speak. A value outside this set is a config the
# engine will refuse to start with, so it is refused here instead.
WIRE_APIS = ("responses", "chat")

_HEADER_RE = re.compile(r"^\s*\[([^\[\]]+)\]\s*(?:#.*)?$")
_LINE_KEY_RE = re.compile(r"^([ \t]*)([A-Za-z0-9_\-]+)([ \t]*=[ \t]*)(.*)$", re.S)


class ProviderError(RuntimeError):
    """A write this module will not make, with the status a caller should report."""

    def __init__(self, message: str, *, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class Provider:
    """One `[model_providers.<id>]` block, described without its secret."""

    id: str
    label: str = ""
    base_url: str = ""
    wire_api: str = ""
    # Whether credentials are configured at all. The value itself is never part
    # of this object: a settings page needs to show that a key exists, not to
    # receive it, and a value that is never read cannot be logged or echoed.
    has_key: bool = False
    # Where the credential the engine would use comes from, and whether it is
    # there: "token" (a literal in the file), "env_key" (a variable that is set
    # and non-empty), "env_key_unset" (a variable named but missing or empty),
    # or None for no credential at all. `has_key` says something is configured;
    # this says whether a run would actually have a key.
    key_source: str | None = None
    # Whether this is the block `model_provider` names.
    active: bool = False

    def describe(self) -> dict[str, Any]:
        """The public fields, as a client receives them."""
        return {
            "id": self.id,
            "label": self.label or self.id,
            "base_url": self.base_url,
            "wire_api": self.wire_api,
            "has_key": self.has_key,
            "key_source": self.key_source,
            "active": self.active,
        }


def config_path(home: Path | str) -> Path:
    """Where the provider blocks live for one engine home."""
    return Path(home) / CONFIG_NAME


def read_providers(home: Path | str) -> list[Provider]:
    """Every provider block, in the order the file lists them. Never raises.

    A missing or unreadable config answers an empty list rather than an error:
    "no providers configured" is a real state the settings page has to draw, and
    the caller that must refuse to run is the engine, which already does.
    """
    path = config_path(home)
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError, UnicodeDecodeError):
        return []
    table = data.get(PROVIDERS_TABLE)
    if not isinstance(table, dict):
        return []
    active = data.get(ACTIVE_KEY)
    active = active.strip() if isinstance(active, str) else ""

    found: list[Provider] = []
    for raw_id, block in table.items():
        provider_id = str(raw_id)
        if not isinstance(block, dict):
            continue
        source = _key_source(block)
        found.append(
            Provider(
                id=provider_id,
                label=_text(block.get("name")),
                base_url=_text(block.get("base_url")),
                wire_api=_text(block.get("wire_api")),
                # Configured at all, whatever state the variable is in: the
                # settings page shows a key box as filled for both, and says
                # what will actually reach the engine through `key_source`.
                has_key=source is not None,
                key_source=source,
                active=provider_id == active,
            )
        )
    return found


def _key_source(block: dict[str, Any]) -> str | None:
    """Which credential a run would use, and whether it is usable.

    The literal token wins, because that is the order the engine reads in: a
    block with both reaches the endpoint on the token and never looks at the
    variable. Reporting "env_key" for such a block would describe a credential
    the engine does not use.

    The variable is looked up in this process's environment, which on Windows
    is fixed when the process starts. A variable set after RSI was launched
    reads as `env_key_unset` until the process restarts, so the name says
    "not visible here" rather than "not set anywhere" -- the settings page is
    expected to say so in those words.
    """
    if _text(block.get(TOKEN_KEY)):
        return "token"
    name = _text(block.get(ENV_KEY))
    if not name:
        return None
    # An empty value is the same as no value to the engine, which checks
    # `if value and value.strip()`. Reporting the two differently would offer
    # the user a distinction with no consequence.
    if _text(os.environ.get(name)):
        return "env_key"
    return "env_key_unset"


def update_provider_value(home: Path | str, provider_id: str, key: str, value: str) -> bool:
    """Set one key of one existing provider block. Returns whether the file changed.

    Only a line whose value is being replaced can differ afterwards: the
    comments, the blank lines, the ordering and every neighbouring key - the
    `http_headers` inline table included - come back byte for byte.
    """
    return bool(update_provider_values(home, provider_id, {key: value}))


def update_provider_values(home: Path | str, provider_id: str, values: dict[str, str]) -> list[str]:
    """Set several keys of one existing provider block, all or none.

    Every refusal this module can name is raised before the file is touched:
    an unwritable key, a value that does not parse, a provider that is not in
    the file, a key with no line to change, a config that is not there. A
    request that mixes a valid field with an invalid one therefore leaves the
    file byte for byte as it was, and a caller can read any `ProviderError` as
    "nothing happened".

    The write itself is one `os.replace` for the whole set, not one per key, so
    even a failing disk cannot land the first field and lose the second.

    Returns the canonical names of the keys that changed, in the order they
    were applied. An empty list means the file already said this.
    """
    if not values:
        return []

    # Canonical name -> the value to write. A caller may reach one line through
    # either spelling (`api_key` and `experimental_bearer_token` are the same
    # key), and `WRITABLE_KEYS` order decides which spelling wins so the same
    # request cannot land differently twice.
    cleaned: dict[str, str] = {}
    for key in WRITABLE_KEYS:
        for written, value in values.items():
            if KEY_ALIASES.get(written, written) == key:
                cleaned[key] = _validate(key, value)

    if not cleaned:
        raise ProviderError(
            "cannot change "
            + ", ".join(sorted(values))
            + "; writable keys are "
            + ", ".join(WRITABLE_KEYS + tuple(KEY_ALIASES))
        )

    # The engine reads the literal token first and never falls back to the
    # variable when one is present, so a block holding both silently ignores
    # `env_key`. A request that would set both at once is asking for that
    # state, and there is no way to tell which credential the caller meant.
    # Refused before the file is opened, so the two lines that do exist are
    # untouched and the user can pick one without cleaning up after us.
    if TOKEN_KEY in cleaned and ENV_KEY in cleaned:
        raise ProviderError(
            "a provider takes either experimental_bearer_token or env_key, not both; "
            "set one and leave the other alone"
        )

    path = config_path(home)
    if not path.is_file():
        raise ProviderError("there is no " + str(path) + " to change", status=409)
    text = _read_text(path)
    lines = text.splitlines(keepends=True)

    # Where each key goes: a line the block already declares is replaced in
    # place, and a key the block does not declare yet becomes one new line
    # inside that block. Both are resolved against the file as read, before
    # anything is written, so a refusal describes the file's real state.
    replacements: list[tuple[str, int, str]] = []
    additions: list[str] = []
    for name in cleaned:
        span = _key_line(lines, provider_id, name)
        if span is not None:
            replacements.append((name, span[0], span[1]))
            continue
        # A key is added only to a block that is already there. Creating the
        # block is a different operation with different failure modes (a whole
        # section, a name, a position among its neighbours), and a request that
        # was refused for the block's absence must not silently produce one.
        if not _has_block(lines, provider_id):
            raise ProviderError(
                "provider " + provider_id + " is not in " + str(path), status=404
            )
        additions.append(name)

    changed: list[str] = []
    for name, index, line in replacements:
        body, ending = _split_ending(line)
        replaced = _replace_line(body, _toml_string(cleaned[name])) + ending
        if replaced != line:
            lines[index] = replaced
            changed.append(name)

    if additions:
        # Replacing never changes how many lines there are, so the insertion
        # point the block had before the replacements is still the same one.
        cursor, indent, ending = _insertion_point(lines, provider_id)
        lines[cursor:cursor] = [
            indent + name + " = " + _toml_string(cleaned[name]) + ending for name in additions
        ]
        changed.extend(additions)

    updated = "".join(lines)
    if updated == text:
        return []
    _write_text(path, updated)
    return changed


# -- reading the file as lines --------------------------------------------


def _read_text(path: Path) -> str:
    """The file as text that can be written back unchanged.

    `surrogateescape` keeps bytes that are not valid UTF-8 alive through the
    round trip. The file is somebody's hand-written config; a stray byte in a
    comment is not this module's business to fix or to lose.
    """
    return path.read_bytes().decode("utf-8", "surrogateescape")


def _write_text(path: Path, text: str) -> None:
    """Replace the file atomically, in place.

    The write bit is cleared first: a store that was frozen read-only (the
    generations are, on purpose) makes `os.replace` fail on Windows with an
    access error rather than a message anyone can act on.

    `os.replace` needs delete access on the destination, which on Windows a
    reader holding the file open without `FILE_SHARE_DELETE` denies. The engine
    reads this file on its own thread, so a save really can fall inside a read
    and come back as a bare `PermissionError` -- measured at 162 of 300
    back-to-back saves while a reader looped. Retrying for a bounded span turns
    that from a failed save into one that waited out the read; the read is a
    few milliseconds of work.
    """
    make_writable(path)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_bytes(text.encode("utf-8", "surrogateescape"))
    try:
        for attempt in range(REPLACE_ATTEMPTS):
            try:
                os.replace(temporary, path)
                return
            except PermissionError:
                if attempt == REPLACE_ATTEMPTS - 1:
                    raise
                time.sleep(REPLACE_PAUSE)
    finally:
        # A failed replace leaves the temporary behind, and a stale one would
        # outlive the save that made it.
        temporary.unlink(missing_ok=True)


def _split_ending(line: str) -> tuple[str, str]:
    """A line's content and the line ending it had."""
    for ending in ("\r\n", "\n", "\r"):
        if line.endswith(ending):
            return line[: -len(ending)], ending
    return line, ""


def _dotted(key: str) -> list[str]:
    """Split a possibly-quoted dotted TOML key into its parts."""
    parts: list[str] = []
    current = ""
    quote = ""
    for ch in key:
        if quote:
            if ch == quote:
                quote = ""
            else:
                current += ch
        elif ch in "\"'":
            quote = ch
        elif ch == ".":
            parts.append(current.strip())
            current = ""
        else:
            current += ch
    parts.append(current.strip())
    return parts


def _key_line(lines: list[str], provider_id: str, name: str) -> tuple[int, str] | None:
    """Where the key sits inside that provider's own block, or None.

    A matching key in a *sub*table of the provider (`[model_providers.x.env]`)
    is not the provider's field and must not be taken for it, so the block ends
    at the next header of any kind.
    """
    inside = False
    for index, line in enumerate(lines):
        body, _ = _split_ending(line)
        header = _HEADER_RE.match(body)
        if header:
            parts = _dotted(header.group(1))
            inside = len(parts) == 2 and parts[0] == PROVIDERS_TABLE and parts[1] == provider_id
            continue
        if not inside:
            continue
        match = _LINE_KEY_RE.match(body)
        if match and match.group(2) == name:
            return index, line
    return None


def _has_block(lines: list[str], provider_id: str) -> bool:
    """Whether the file declares this provider's own table at all."""
    for line in lines:
        body, _ = _split_ending(line)
        header = _HEADER_RE.match(body)
        if not header:
            continue
        parts = _dotted(header.group(1))
        if len(parts) == 2 and parts[0] == PROVIDERS_TABLE and parts[1] == provider_id:
            return True
    return False


def _insertion_point(lines: list[str], provider_id: str) -> tuple[int, str, str]:
    """Where a new key line goes in that block, how it is indented, how it ends.

    The position is just after the block's last non-blank line. Inserting after
    a trailing blank line would put the key next to the following section
    instead of inside this one, and inserting at the header would put it above
    the block it belongs to; both land the key in somebody else's table.

    The indent is copied from the block's first key line, and the line ending
    from the file, so a hand-indented or CRLF file keeps its own style rather
    than gaining one more convention. The file's last line may have no ending
    at all, which is why the ending is taken from a line that has one.
    """
    start: int | None = None
    cursor = 0
    indent = ""
    for index, line in enumerate(lines):
        body, _ = _split_ending(line)
        header = _HEADER_RE.match(body)
        if header:
            parts = _dotted(header.group(1))
            if start is not None and not (
                len(parts) == 2 and parts[0] == PROVIDERS_TABLE and parts[1] == provider_id
            ):
                # Any header ends the block, and the cursor already points past
                # its last non-blank line.
                break
            if len(parts) == 2 and parts[0] == PROVIDERS_TABLE and parts[1] == provider_id:
                start = index
                cursor = index + 1
            continue
        if start is None or not body.strip():
            continue
        if not indent:
            match = _LINE_KEY_RE.match(body)
            if match:
                indent = match.group(1)
        cursor = index + 1

    if start is None:  # the caller proved the block exists; this is not reachable
        raise ProviderError("provider " + provider_id + " is not in the config", status=404)

    ending = "\n"
    for line in lines:
        _, found = _split_ending(line)
        if found:
            ending = found
            break
    return cursor, indent, ending


def _replace_line(body: str, rendered: str) -> str:
    """One line with its value swapped, its spacing and its comment kept."""
    match = _LINE_KEY_RE.match(body)
    if match is None:  # _key_line already proved it matches; this is not reachable
        raise ProviderError("could not rewrite the line for " + body)
    prefix, key, separator, rest = match.groups()
    value, _, comment = _split_comment(rest)
    trailing = value[len(value.rstrip()) :]
    return prefix + key + separator + rendered + trailing + comment


def _split_comment(rest: str) -> tuple[str, str, str]:
    """A value, the whitespace after it, and any trailing comment."""
    in_basic = in_literal = False
    depth = 0
    index = 0
    while index < len(rest):
        ch = rest[index]
        if in_basic:
            if ch == "\\":
                index += 2
                continue
            if ch == '"':
                in_basic = False
        elif in_literal:
            if ch == "'":
                in_literal = False
        elif ch == '"':
            in_basic = True
        elif ch == "'":
            in_literal = True
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth = max(0, depth - 1)
        elif ch == "#" and depth == 0:
            head = rest[:index]
            return head, "", rest[index:]
        index += 1
    head = rest
    return head, "", ""


# -- validating and rendering a value --------------------------------------


def _text(value: object) -> str:
    """A string field, or empty for anything that is not one."""
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _validate(name: str, value: object) -> str:
    """The value to write, or a refusal naming what is wrong with it."""
    if not isinstance(value, str):
        raise ProviderError(name + " must be a string")
    cleaned = value.strip()
    if any(ch in cleaned for ch in "\r\n\x00"):
        raise ProviderError(name + " must be one line")
    if not cleaned:
        # An empty value is how a client says "leave this alone" - the settings
        # page shows a masked key and sends nothing when the field is untouched.
        raise ProviderError(name + " is empty, so there is nothing to change")

    if name == "base_url":
        parts = urlsplit(cleaned)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise ProviderError("base_url must be an http or https address, not " + cleaned)
    elif name == "wire_api":
        if cleaned not in WIRE_APIS:
            raise ProviderError(
                "wire_api must be one of " + ", ".join(WIRE_APIS) + ", not " + cleaned
            )
    elif name == ENV_KEY:
        # The value is a name, not a secret: a run looks it up in the
        # environment, so anything that is not a legal variable name would be
        # accepted here and fail at the next run, somewhere the caller cannot
        # connect to this request.
        if not _ENV_NAME_RE.match(cleaned):
            raise ProviderError(
                "env_key must be an environment variable name like MY_API_KEY, not " + cleaned
            )
    return cleaned


def _toml_string(value: str) -> str:
    """A TOML basic string holding exactly this text."""
    escaped = (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\t", "\\t")
        .replace("\r", "\\r")
        .replace("\n", "\\n")
    )
    return '"' + escaped + '"'


__all__ = [
    "ACTIVE_KEY",
    "CONFIG_NAME",
    "ENV_KEY",
    "KEY_ALIASES",
    "PROVIDERS_TABLE",
    "Provider",
    "ProviderError",
    "TOKEN_KEY",
    "WIRE_APIS",
    "WRITABLE_KEYS",
    "config_path",
    "read_providers",
    "update_provider_value",
    "update_provider_values",
]
