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

"""Regressions for the generation store: immutability, lineage, refs, and swap."""

import json
import os
import tempfile
import unittest
from pathlib import Path

from harness2.substrate.opencode import OPENCODE_SURFACE

from rsi.store import Store, StoreError, content_hash, make_writable, open_store

SURF = OPENCODE_SURFACE


def base_tree() -> dict[str, str]:
    return {
        "systemprompt.md": "Reconcile the ledger with python3 scripts/summarize.py.\n",
        "guardrails.md": "",
        "LongTermMEMORY.md": "",
        "tool_descriptions/tool_guidance.md": "",
        "scripts/summarize.py": "print('base')\n",
    }


class StoreTests(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "store"
        self.store = open_store(self.root, SURF)

    # -- creation --------------------------------------------------------------

    def test_init_is_idempotent_and_creates_g0001(self):
        g1 = self.store.init(tree=base_tree())
        self.assertEqual(g1.id, "g0001")
        self.assertIsNone(g1.parent)
        self.assertEqual(g1.kind, "base")
        again = self.store.init(tree=base_tree())
        self.assertEqual(again.id, "g0001")
        self.assertEqual(len(self.store.generations()), 1)

    def test_init_without_tree_is_refused_with_guidance(self):
        with self.assertRaises(StoreError) as ctx:
            self.store.init()
        self.assertIn("needs a tree", str(ctx.exception))

    def test_reimport_after_init_appends_a_child(self):
        self.store.init(tree=base_tree())
        edited = base_tree()
        edited["scripts/summarize.py"] = "print('edited')\n"
        g2 = self.store.commit("g0001", edited, kind="manual", note="drop the filter")
        self.assertEqual((g2.id, g2.parent, g2.kind), ("g0002", "g0001", "manual"))

    # -- immutability ----------------------------------------------------------

    def test_identical_tree_is_refused(self):
        self.store.init(tree=base_tree())
        with self.assertRaises(StoreError) as ctx:
            self.store.commit("g0001", base_tree())
        self.assertIn("identical", str(ctx.exception))
        self.assertEqual(len(self.store.generations()), 1)

    def test_generation_directory_is_not_rewritten(self):
        self.store.init(tree=base_tree())
        before = self.store.tree_of("g0001")
        edited = base_tree()
        edited["scripts/summarize.py"] = "print('other')\n"
        self.store.commit("g0001", edited)
        self.assertEqual(self.store.tree_of("g0001"), before)

    def test_readopting_content_already_in_the_store_is_refused(self):
        """The case the parent check misses: roll back, then re-adopt an existing tree.

        Without this, adopting A, adopting B, rolling back to A and re-adopting B writes a
        second generation with B's content_hash, and everything keyed by that hash (gate
        evidence, rollout reuse) becomes ambiguous.
        """
        self.store.init(tree=base_tree())
        t2 = dict(base_tree(), **{"guardrails.md": "v2\n"})
        self.store.commit("g0001", t2)  # g0002
        self.store.rollback("g0001")
        with self.assertRaises(StoreError) as ctx:
            self.store.commit("g0001", t2)
        self.assertIn("already generation g0002", str(ctx.exception))
        self.assertEqual(len(self.store.generations()), 2)

    def test_find_by_hash_locates_existing_content(self):
        self.store.init(tree=base_tree())
        t2 = dict(base_tree(), **{"guardrails.md": "v2\n"})
        g2 = self.store.commit("g0001", t2)
        self.assertEqual(self.store.find_by_hash(g2.content_hash).id, "g0002")
        self.assertIsNone(self.store.find_by_hash("0000000000000000"))

    def test_missing_parent_is_refused(self):
        self.store.init(tree=base_tree())
        edited = base_tree()
        edited["guardrails.md"] = "be careful\n"
        with self.assertRaises(StoreError) as ctx:
            self.store.commit("g9999", edited)
        self.assertIn("does not exist", str(ctx.exception))

    def test_written_bytes_are_lf_on_every_platform(self):
        """A generation must digest to what runmark records for it on the same disk."""
        tree = base_tree()
        tree["systemprompt.md"] = "line one\nline two\n"
        self.store.init(tree=tree)
        raw = (self.store.tree_dir("g0001") / "systemprompt.md").read_bytes()
        self.assertNotIn(b"\r\n", raw)
        self.assertIn(b"line one\nline two", raw)

    def test_content_hash_is_order_and_platform_independent(self):
        a = {"b.md": "x", "a.md": "y"}
        b = {"a.md": "y", "b.md": "x"}
        self.assertEqual(content_hash(a), content_hash(b))
        self.assertNotEqual(content_hash(a), content_hash({"b.md": "x", "a.md": "z"}))

    def test_hash_matches_upstream_fingerprint(self):
        """A generation digest must equal what runmark records for the same tree on disk."""
        from harness2.core import runmark

        tree = base_tree()
        self.store.init(tree=tree)
        self.assertEqual(
            self.store.get("g0001").content_hash,
            runmark.fingerprint(self.store.tree_dir("g0001")),
        )

    # -- lineage ---------------------------------------------------------------

    def test_lineage_walks_to_the_root(self):
        self.store.init(tree=base_tree())
        t2 = dict(base_tree(), **{"guardrails.md": "v2\n"})
        self.store.commit("g0001", t2)
        t3 = dict(base_tree(), **{"guardrails.md": "v3\n"})
        self.store.commit("g0002", t3)
        self.assertEqual([g.id for g in self.store.lineage("g0003")], ["g0003", "g0002", "g0001"])
        self.assertEqual([g.id for g in self.store.roots()], ["g0001"])
        self.assertEqual([g.id for g in self.store.children("g0002")], ["g0003"])

    def test_cyclic_lineage_is_detected(self):
        self.store.init(tree=base_tree())
        t2 = dict(base_tree(), **{"guardrails.md": "v2\n"})
        self.store.commit("g0001", t2)
        mpath = self.store.gen_dir("g0002") / "manifest.json"
        m = json.loads(mpath.read_text())
        m["parent"] = "g0002"
        make_writable(mpath)
        mpath.write_text(json.dumps(m))
        with self.assertRaises(StoreError) as ctx:
            self.store.lineage("g0002")
        self.assertIn("cyclic", str(ctx.exception))

    # -- refs ------------------------------------------------------------------

    def test_promote_moves_stable_and_rollback_moves_it_back(self):
        self.store.init(tree=base_tree())
        self.store.set_ref("stable", "g0001")
        t2 = dict(base_tree(), **{"guardrails.md": "v2\n"})
        g2 = self.store.promote("g0001", t2, note="try v2")
        self.assertEqual(self.store.get_ref("stable").generation, "g0002")
        self.assertEqual(self.store.current().id, "g0002")

        self.store.rollback("g0001")
        self.assertEqual(self.store.current().id, "g0001")
        # the newer generation still exists; rollback is a pointer move, not a delete
        self.assertTrue(self.store.exists("g0002"))
        self.assertEqual(self.store.get(g2.id).parent, "g0001")

    def test_ref_to_missing_generation_is_refused(self):
        self.store.init(tree=base_tree())
        with self.assertRaises(StoreError):
            self.store.set_ref("stable", "g0042")

    def test_current_without_ref_explains_how_to_make_one(self):
        self.store.init(tree=base_tree())
        with self.assertRaises(StoreError) as ctx:
            self.store.current()
        self.assertIn("set_ref", str(ctx.exception))

    def test_invalid_ref_name_is_refused(self):
        self.store.init(tree=base_tree())
        for bad in ("../escape", "Stable", "", "a" * 40):
            with self.subTest(bad=bad):
                with self.assertRaises(StoreError):
                    self.store.set_ref(bad, "g0001")

    def test_ref_write_is_atomic(self):
        self.store.init(tree=base_tree())
        self.store.set_ref("stable", "g0001")
        t2 = dict(base_tree(), **{"guardrails.md": "v2\n"})
        self.store.commit("g0001", t2)
        for i in range(5):
            self.store.set_ref("stable", "g0002" if i % 2 else "g0001")
            ref = json.loads((self.root / "refs" / "stable.json").read_text())
            self.assertIn(ref["generation"], {"g0001", "g0002"})
        leftovers = [p.name for p in (self.root / "refs").iterdir() if p.name.endswith(".tmp")]
        self.assertEqual(leftovers, [])

    # -- materialise / swap ----------------------------------------------------

    def test_materialise_roundtrips_a_tree(self):
        tree = base_tree()
        self.store.init(tree=tree)
        dest = Path(tempfile.mkdtemp()) / "harness"
        self.store.materialise("g0001", dest)
        from harness2.core import tree as ht

        self.assertEqual(ht.read_tree(SURF, dest), tree)

    def test_swap_replaces_content_without_leaving_staging_dirs(self):
        self.store.init(tree=base_tree())
        t2 = dict(base_tree(), **{"scripts/summarize.py": "print('v2')\n"})
        self.store.commit("g0001", t2)

        dest = Path(tempfile.mkdtemp()) / "harness"
        self.store.swap("g0001", dest)
        self.assertIn("print('base')", (dest / "scripts" / "summarize.py").read_text())
        self.store.swap("g0002", dest)
        self.assertIn("print('v2')", (dest / "scripts" / "summarize.py").read_text())
        leftovers = [p.name for p in dest.parent.iterdir() if p.name.startswith(".")]
        self.assertEqual(leftovers, [])

    # -- verify ----------------------------------------------------------------

    def test_verify_clean_store_reports_nothing(self):
        self.store.init(tree=base_tree())
        t2 = dict(base_tree(), **{"guardrails.md": "v2\n"})
        self.store.commit("g0001", t2)
        self.store.set_ref("stable", "g0002")
        self.assertEqual(self.store.verify(), [])

    def test_verify_catches_a_tampered_generation(self):
        self.store.init(tree=base_tree())
        make_writable(self.store.tree_dir("g0001"))
        p = self.store.tree_dir("g0001") / "guardrails.md"
        p.write_text("tampered\n")
        problems = self.store.verify()
        self.assertTrue(any("was modified after it was written" in x for x in problems), problems)

    def test_verify_catches_a_dangling_ref(self):
        self.store.init(tree=base_tree())
        self.store.set_ref("stable", "g0001")
        mpath = self.store.gen_dir("g0001") / "manifest.json"
        make_writable(mpath)
        mpath.unlink()
        self.assertTrue(any("missing generation" in x for x in self.store.verify()))

    # -- cross-process writes --------------------------------------------------

    def test_a_second_store_does_not_reuse_an_id(self):
        """The id index is cached per store, so a second writer must not collide.

        This is the failure a cache invites: process A writes g0002 and remembers
        "top is 2"; process B, which listed earlier, would then also pick g0002.
        """
        self.store.init(tree=base_tree())
        first = self.store.commit("g0001", dict(base_tree(), **{"guardrails.md": "a\n"}))
        self.assertEqual(first.id, "g0002")

        # Another process, opened before that write, commits its own tree.
        other = open_store(self.root, SURF)
        second = other.commit("g0001", dict(base_tree(), **{"guardrails.md": "b\n"}))
        self.assertEqual(second.id, "g0003")

    def test_a_second_store_does_not_rewrite_existing_content(self):
        """The duplicate-content rule must survive the hash cache.

        The parent has to differ from the duplicate, or the cheaper "identical to
        parent" check fires first and the content index is never consulted.
        """
        self.store.init(tree=base_tree())
        original = dict(base_tree(), **{"guardrails.md": "a\n"})
        self.store.commit("g0001", original)
        self.store.commit("g0002", dict(base_tree(), **{"guardrails.md": "b\n"}))

        other = open_store(self.root, SURF)
        with self.assertRaises(StoreError) as ctx:
            other.commit("g0003", original)
        self.assertIn("already generation", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
