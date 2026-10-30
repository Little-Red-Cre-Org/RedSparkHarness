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

"""Immutable harness generations, a lineage, and a mutable pointer at the live one.

Harness2 already writes every candidate harness to its own directory, so the content of a
harness is solved. What it does not have is any notion of identity over time: a harness is
a directory name under `runs/`, there is no parent, no history, and no way to say which one
is live -- so there is nothing to roll back to and nothing to switch atomically.

This module adds exactly that, and nothing about how a harness is produced or improved:

    <root>/generations/<id>/
        manifest.json     id, parent, content_hash, kind, created_at, note
        tree/             the c1..c8 tree, written once
        evidence/         optional: why this generation exists

    <root>/refs/<name>.json    {"generation": "<id>", ...}

Two invariants hold everything together:

* **A generation is immutable.** It is written once, under a name derived from its content,
  and never rewritten. Any change is a new generation whose `parent` names the old one.
* **The live harness is a pointer, not a copy.** Switching is one atomic
  `os.replace` of a small JSON file. Nothing is rebuilt, nothing is copied, no process
  needs to restart, and a rollback is the same operation in the other direction.

The content hash is `harness2.core.runmark.fingerprint`'s algorithm (sha1 over
`rel\0content\0` in sorted order), reused rather than reimplemented so that a generation
digest and a rollout's recorded harness digest are directly comparable.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator, Mapping

from harness2.core import tree as harness_tree
from harness2.core.tree import SurfaceSpec, Tree

KINDS = ("base", "auto", "manual", "import")

_ID = re.compile(r"^g\d{4,}$")
_REF = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")

MANIFEST = "manifest.json"
TREE_DIR = "tree"
EVIDENCE_DIR = "evidence"


class StoreError(RuntimeError):
    """A store operation was refused; the message says what to do instead."""


def content_hash(tree: Mapping[str, str]) -> str:
    """Digest a tree exactly the way `runmark.fingerprint` digests a tree on disk.

    Reimplemented rather than delegated because `fingerprint` takes a directory, but the
    record order has to match, and that order is not `sorted(str)`: `fingerprint` sorts
    `Path` objects, so `LongTermMEMORY.md` (capital L) sorts after `guardrails.md` there
    but before it lexicographically. Sorting `Path` here reproduces it. Matching matters
    because a generation digest is compared against the harness digest recorded on the
    rollouts it produced; a near-miss would make every generation look unrelated to its own
    runs.
    """
    h = hashlib.sha1()
    for p in sorted(Path(harness_tree.normalize_rel(rel)) for rel in tree):
        h.update(p.as_posix().encode("utf-8", errors="replace"))
        h.update(b"\0")
        h.update(str(tree[p.as_posix()]).encode("utf-8", errors="replace"))
        h.update(b"\0")
    return h.hexdigest()[:16]


def _write_tree_lf(
    surface: SurfaceSpec, tree: Tree, dest: Path, *, stubs: bool = False
) -> Path:
    """Write a tree with LF endings on every platform.

    `Path.write_text` translates "\n" to `os.linesep` unless told otherwise, so on Windows
    the bytes on disk would differ from the bytes in `tree` while reading back the same
    text. That matters here because a generation's digest is compared against
    `runmark.fingerprint`, which hashes RAW BYTES: without this the same harness would
    digest differently per platform and a generation could not be matched to the rollouts
    it produced.
    """
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    for rel, content in tree.items():
        p = dest / harness_tree.normalize_rel(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(str(content), encoding="utf-8", newline="\n")
    if stubs:
        for rel, body in surface.stubs:
            p = dest / harness_tree.normalize_rel(rel)
            p.parent.mkdir(parents=True, exist_ok=True)
            if not p.exists():
                p.write_text(body, encoding="utf-8", newline="\n")
    return dest


def make_writable(path: Path | str) -> None:
    """Clear the write protection `Store` puts on a generation directory.

    Generation trees are frozen on purpose. This exists for the two callers that legitimately
    need to change or remove one: tests that simulate tampering, and a user disposing of a
    store directory (Windows refuses to delete a read-only file).
    """
    for p in sorted(Path(path).rglob("*"), reverse=True):
        try:
            if p.is_file():
                p.chmod(p.stat().st_mode | 0o666 if os.name == "posix" else p.stat().st_mode | 0o200)
        except OSError:
            pass
    try:
        Path(path).chmod(0o777 if os.name == "posix" else Path(path).stat().st_mode | 0o200)
    except OSError:
        pass


@dataclass(frozen=True)
class Generation:
    """One immutable harness state."""

    id: str
    parent: str | None
    content_hash: str
    kind: str
    created_at: float
    note: str = ""

    @property
    def label(self) -> str:
        return f"{self.id} ({self.kind}, {self.content_hash})"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "parent": self.parent,
            "content_hash": self.content_hash,
            "kind": self.kind,
            "created_at": self.created_at,
            "note": self.note,
        }

    @classmethod
    def from_dict(cls, d: Mapping) -> Generation:
        return cls(
            id=str(d["id"]),
            parent=(str(d["parent"]) if d.get("parent") else None),
            content_hash=str(d["content_hash"]),
            kind=str(d.get("kind") or "manual"),
            created_at=float(d.get("created_at") or 0.0),
            note=str(d.get("note") or ""),
        )


@dataclass(frozen=True)
class Ref:
    """A named pointer at one generation. `stable` is the one that is live."""

    name: str
    generation: str
    updated_at: float = 0.0
    by: str = ""
    reason: str = ""

    def to_dict(self) -> dict:
        return {
            "generation": self.generation,
            "updated_at": self.updated_at,
            "by": self.by,
            "reason": self.reason,
        }


@dataclass
class Store:
    """A generation store rooted at one directory."""

    root: Path
    surface: SurfaceSpec
    notes: list[str] = field(default_factory=list)

    # What this process has already seen: the highest generation number and every
    # content hash, or empty when unknown. Generation directories are immutable and
    # ids only grow, so these survive external writes and never need invalidating --
    # a listing on first use repairs anything another process added.
    _top: int = field(default=0, init=False, repr=False)
    _hashes: dict[str, str] = field(default_factory=dict, init=False, repr=False)

    def __post_init__(self) -> None:
        self.root = Path(self.root)

    # -- layout ----------------------------------------------------------------

    @property
    def generations_dir(self) -> Path:
        return self.root / "generations"

    @property
    def refs_dir(self) -> Path:
        return self.root / "refs"

    def gen_dir(self, gen_id: str) -> Path:
        if not _ID.match(gen_id):
            raise StoreError(
                f"{gen_id!r} is not a generation id; they look like 'g0001'"
            )
        return self.generations_dir / gen_id

    def tree_dir(self, gen_id: str) -> Path:
        return self.gen_dir(gen_id) / TREE_DIR

    def evidence_dir(self, gen_id: str) -> Path:
        return self.gen_dir(gen_id) / EVIDENCE_DIR

    # -- create ----------------------------------------------------------------

    def init(self, *, kind: str = "base", note: str = "", tree: Tree | None = None) -> Generation:
        """Create the store and its first generation. Idempotent when already initialised."""
        self.generations_dir.mkdir(parents=True, exist_ok=True)
        self.refs_dir.mkdir(parents=True, exist_ok=True)
        existing = self.generations()
        if existing:
            return existing[0]
        if tree is None:
            raise StoreError(
                "the first generation needs a tree: pass the c1..c8 tree to seed the store "
                "(see read_tree on the base harness)"
            )
        return self._write(None, tree, kind=kind, note=note or "initial generation")

    def import_tree(self, source: Path, *, kind: str = "import", note: str = "") -> Generation:
        """Seed or extend the store from a harness directory on disk."""
        tree = harness_tree.read_tree(self.surface, source)
        if not tree:
            raise StoreError(
                f"no editable files under {source}; is that a harness tree for "
                f"surface {self.surface.name!r}?"
            )
        siblings = self.generations()
        parent = siblings[-1].id if siblings else None
        return self._write(parent, tree, kind=kind, note=note or f"imported from {source}")

    def promote(
        self, parent: str, tree: Tree, *, kind: str = "manual", note: str = "", ref: str = "stable"
    ) -> Generation:
        """Write `tree` as a new generation and optionally point `ref` at it."""
        return self.commit(parent, tree, kind=kind, note=note, ref=ref)

    def commit(
        self,
        parent: str | None,
        tree: Tree,
        *,
        kind: str = "manual",
        note: str = "",
        ref: str | None = None,
        evidence: Mapping[str, str] | None = None,
    ) -> Generation:
        """Write a generation and, when `ref` is given, move that pointer to it."""
        gen = self._write(parent, tree, kind=kind, note=note, evidence=evidence)
        if ref is not None:
            self.set_ref(ref, gen.id, by=f"{kind}-commit", reason=note)
        return gen

    def _write(
        self,
        parent: str | None,
        tree: Tree,
        *,
        kind: str,
        note: str,
        evidence: Mapping[str, str] | None = None,
    ) -> Generation:
        if kind not in KINDS:
            raise StoreError(f"unknown kind {kind!r}; expected one of {KINDS}")
        if parent is not None:
            if not self.gen_dir(parent).is_dir():
                raise StoreError(f"parent generation {parent!r} does not exist")
            parent_hash = self.get(parent).content_hash
        else:
            parent_hash = None

        digest = content_hash(tree)
        if parent_hash is not None and parent_hash == digest:
            raise StoreError(
                f"tree is identical to parent {parent} (content_hash {digest}); a generation "
                f"that changes nothing would add a node to the lineage without meaning one"
            )
        # Content that already exists anywhere in the store must not be written again. The
        # check above only catches "same as parent", which misses the case that matters in
        # practice: adopt A, adopt B, roll back to A, then re-adopt B's content -- the new
        # node would duplicate a generation that is already in the lineage, and anything
        # keyed by content_hash (evidence, rollout reuse) would become ambiguous.
        #
        # Both answers come from the same index. This used to list the store twice per
        # write (``_by_hash`` then ``_next_id``), and every listing re-reads every
        # manifest, so the pair dominated commit cost: at 155 generations it was most of
        # a 67ms write. Now the listing happens once per process.
        top, known = self._seen()
        existing = known.get(digest)
        if existing is not None and existing != parent:
            raise StoreError(
                f"this tree is already generation {existing} (content_hash {digest}); "
                f"generations are content-addressed, so re-adopting it would create a "
                f"duplicate. Point a ref at {existing} instead of writing it again."
            )

        gen_id = f"g{top + 1:04d}"
        d = self.gen_dir(gen_id)
        d.mkdir(parents=True, exist_ok=False)
        try:
            _write_tree_lf(self.surface, tree, d / TREE_DIR)
            if evidence:
                ed = d / EVIDENCE_DIR
                ed.mkdir(parents=True, exist_ok=True)
                for name, body in evidence.items():
                    p = ed / harness_tree.normalize_rel(name)
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_text(str(body), encoding="utf-8")
            gen = Generation(
                id=gen_id,
                parent=parent,
                content_hash=digest,
                kind=kind,
                created_at=time.time(),
                note=note,
            )
            (d / MANIFEST).write_text(
                json.dumps(gen.to_dict(), indent=2, sort_keys=True), encoding="utf-8"
            )
            self._make_readonly(d)
        except BaseException:
            shutil.rmtree(d, ignore_errors=True)
            raise
        self._observe(gen)
        return gen

    def _by_hash(self) -> dict[str, Generation]:
        return {g.content_hash: g for g in self.generations()}

    def find_by_hash(self, digest: str) -> Generation | None:
        """The generation with this content, if the store already holds it."""
        return self._by_hash().get(digest)

    def _next_id(self) -> str:
        """The next free id.

        Only a full listing can tell us the store is untouched by other
        processes, so scan the first time and then trust `_top`: directories are
        immutable and ids only grow, so a cached number can be stale-low but never
        stale-high, and a stale-low number is corrected on the next `_write`.
        """
        if self._top == 0:
            self._top = max((int(g.id[1:]) for g in self.generations()), default=0)
        return f"g{self._top + 1:04d}"

    def _observe(self, gen: Generation) -> None:
        """Remember that `gen` now exists, so later writes skip a full listing."""
        self._top = max(self._top, int(gen.id[1:]))
        self._hashes[gen.content_hash] = gen.id

    def _seen(self) -> tuple[int, dict[str, str]]:
        """The highest id and hash index, listing the store once when unknown.

        A process that has never listed cannot know what another process wrote, so
        the first write pays for one listing and every later write does not. The
        store is small enough that this trades nothing away: a listing is bounded by
        the number of generations, and this makes it once per process instead of
        once per write.
        """
        if self._top == 0:
            gens = self.generations()
            self._top = max((int(g.id[1:]) for g in gens), default=0)
            self._hashes = {g.content_hash: g.id for g in gens}
        return self._top, self._hashes

    def _make_readonly(self, d: Path) -> None:
        """Best-effort write protection. POSIX bits do not stop the owner on Windows, so the
        read-only attribute is set there; either way the contract is also enforced in code by
        refusing to write into an existing generation directory.
        """
        for p in sorted(d.rglob("*"), reverse=True):
            try:
                if p.is_file():
                    if os.name != "posix":
                        p.chmod(p.stat().st_mode & ~0o222)
                    else:
                        p.chmod(0o444)
            except OSError:
                pass

    # -- read ------------------------------------------------------------------

    def generations(self) -> list[Generation]:
        """Every generation, oldest first, ordered by numeric id."""
        d = self.generations_dir
        if not d.is_dir():
            return []
        out = []
        for p in d.iterdir():
            if p.is_dir() and _ID.match(p.name) and (p / MANIFEST).is_file():
                try:
                    out.append(Generation.from_dict(json.loads((p / MANIFEST).read_text())))
                except (OSError, ValueError, KeyError):
                    continue
        return sorted(out, key=lambda g: int(g.id[1:]))

    def get(self, gen_id: str) -> Generation:
        m = self.gen_dir(gen_id) / MANIFEST
        if not m.is_file():
            raise StoreError(f"no generation {gen_id!r} in {self.root}")
        return Generation.from_dict(json.loads(m.read_text(encoding="utf-8")))

    def exists(self, gen_id: str) -> bool:
        try:
            return (self.gen_dir(gen_id) / MANIFEST).is_file()
        except StoreError:
            return False

    def tree_of(self, gen_id: str) -> Tree:
        """Read a generation's tree back. This is what a rollout is materialised from."""
        return harness_tree.read_tree(self.surface, self.tree_dir(gen_id))

    def lineage(self, gen_id: str) -> list[Generation]:
        """`gen_id` followed by its ancestors, nearest first."""
        out: list[Generation] = []
        seen: set[str] = set()
        cur: str | None = gen_id
        while cur:
            if cur in seen:
                raise StoreError(f"lineage of {gen_id!r} is cyclic at {cur!r}")
            seen.add(cur)
            g = self.get(cur)
            out.append(g)
            cur = g.parent
        return out

    def children(self, gen_id: str) -> list[Generation]:
        return [g for g in self.generations() if g.parent == gen_id]

    def roots(self) -> list[Generation]:
        return [g for g in self.generations() if not g.parent]

    # -- refs ------------------------------------------------------------------

    def ref_path(self, name: str) -> Path:
        if not _REF.match(name):
            raise StoreError(
                f"invalid ref name {name!r}; lowercase letters, digits, '_' or '-' "
                f"(e.g. 'stable')"
            )
        return self.refs_dir / f"{name}.json"

    def set_ref(self, name: str, gen_id: str, *, by: str = "", reason: str = "") -> Ref:
        """Point `name` at `gen_id`. Atomic: write a temp file, then `os.replace`."""
        self.get(gen_id)  # refuse a dangling pointer up front
        self.refs_dir.mkdir(parents=True, exist_ok=True)
        ref = Ref(name=name, generation=gen_id, updated_at=time.time(), by=by, reason=reason)
        target = self.ref_path(name)
        tmp = target.with_suffix(f".json.{os.getpid()}.tmp")
        tmp.write_text(json.dumps(ref.to_dict(), indent=2, sort_keys=True), encoding="utf-8")
        os.replace(tmp, target)
        return ref

    def get_ref(self, name: str = "stable") -> Ref | None:
        p = self.ref_path(name)
        if not p.is_file():
            return None
        d = json.loads(p.read_text(encoding="utf-8"))
        return Ref(
            name=name,
            generation=str(d["generation"]),
            updated_at=float(d.get("updated_at") or 0.0),
            by=str(d.get("by") or ""),
            reason=str(d.get("reason") or ""),
        )

    def refs(self) -> dict[str, Ref]:
        out: dict[str, Ref] = {}
        if not self.refs_dir.is_dir():
            return out
        for p in sorted(self.refs_dir.glob("*.json")):
            try:
                r = self.get_ref(p.stem)
            except (OSError, ValueError, KeyError, StoreError):
                continue
            if r:
                out[r.name] = r
        return out

    def current(self, name: str = "stable") -> Generation:
        """The generation `name` points at; refuses loudly when nothing is live."""
        ref = self.get_ref(name)
        if ref is None:
            raise StoreError(
                f"no {name!r} ref in {self.root}; point one with set_ref({name!r}, <gen>) "
                f"or promote a generation"
            )
        return self.get(ref.generation)

    def rollback(self, gen_id: str, *, name: str = "stable", by: str = "rollback") -> Ref:
        """Point `name` back at an existing generation. No rebuild, no copy."""
        return self.set_ref(name, gen_id, by=by, reason=f"rolled back to {gen_id}")

    # -- materialise -----------------------------------------------------------

    def materialise(self, gen_id: str, dest: Path) -> Path:
        """Write a generation's tree to `dest`, replacing whatever is there."""
        return _write_tree_lf(self.surface, self.tree_of(gen_id), dest, stubs=True)

    def swap(self, gen_id: str, dest: Path) -> Path:
        """Atomically make `dest` hold `gen_id`, using two renames.

        The new tree is built beside `dest` first, so no reader ever observes a directory
        holding half the old harness and half the new one.
        """
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        staging = dest.parent / f".{dest.name}.staging-{gen_id}-{os.getpid()}"
        retired = dest.parent / f".{dest.name}.retired-{os.getpid()}"
        shutil.rmtree(staging, ignore_errors=True)
        shutil.rmtree(retired, ignore_errors=True)
        self.materialise(gen_id, staging)
        try:
            if dest.exists():
                os.rename(dest, retired)
            os.rename(staging, dest)
        except BaseException:
            shutil.rmtree(staging, ignore_errors=True)
            if retired.exists() and not dest.exists():
                os.rename(retired, dest)
            raise
        shutil.rmtree(retired, ignore_errors=True)
        return dest

    # -- drift -----------------------------------------------------------------

    def verify(self) -> list[str]:
        """Problems that would make the lineage or a ref untrustworthy."""
        problems: list[str] = []
        gens = {g.id: g for g in self.generations()}
        for g in gens.values():
            if g.parent and g.parent not in gens:
                problems.append(f"{g.id} names missing parent {g.parent}")
            actual = content_hash(self.tree_of(g.id))
            if actual != g.content_hash:
                problems.append(
                    f"{g.id} tree digests to {actual}, manifest says {g.content_hash} "
                    f"(the generation was modified after it was written)"
                )
        for name, ref in self.refs().items():
            if ref.generation not in gens:
                problems.append(f"ref {name!r} points at missing generation {ref.generation}")
        return problems

    def __iter__(self) -> Iterator[Generation]:
        return iter(self.generations())


def open_store(root: Path | str, surface: SurfaceSpec) -> Store:
    """A store handle; the directory is created on first write, not here."""
    return Store(Path(root), surface)


def ensure_ready(root: Path | str, surface: SurfaceSpec) -> Store:
    """Open a store, giving a fresh one a first generation and a stable ref.

    Every read path starts from 'stable', so a store that has never been
    written refuses the first run with "no 'stable' ref" -- which is a fine
    error for a CLI that has an init subcommand, and a dead end for a window
    that has no way to tell the reader to go run one. Seeding the same empty
    base that init writes makes opening the app enough on its own.
    """
    store = open_store(root, surface)
    if store.get_ref("stable") is not None:
        return store
    existing = store.generations()
    if existing:
        # Generations without a pointer happen when a commit skipped the ref;
        # the newest one is what a reader means by "current".
        store.set_ref("stable", existing[-1].id, by="init", reason="newest generation")
        return store
    gen = store.init(
        tree={a: "" for a in surface.always_on} | {"systemprompt.md": ""},
        kind="base",
        note="empty base",
    )
    store.set_ref("stable", gen.id, by="init", reason="first generation")
    return store


__all__ = [
    "Generation",
    "Ref",
    "Store",
    "StoreError",
    "content_hash",
    "ensure_ready",
    "make_writable",
    "open_store",
    "KINDS",
]
