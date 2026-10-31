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

"""`rsi` command line: seed a store, inspect a lineage, move the stable pointer.

Deliberately thin. Every command maps to one `Store` call; nothing here decides anything
about a harness.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from harness2.substrate.opencode import OPENCODE_SURFACE

from .store import KINDS, StoreError, make_writable, open_store

DEFAULT_STORE = Path(os.environ.get("RSI_STORE") or Path.cwd() / ".rsi" / "store")


def _store(args) -> "object":
    return open_store(Path(args.store), OPENCODE_SURFACE)


def _age(ts: float) -> str:
    if not ts:
        return "-"
    delta = max(0, time.time() - ts)
    for unit, size in (("d", 86400), ("h", 3600), ("m", 60)):
        if delta >= size:
            return f"{int(delta // size)}{unit} ago"
    return "just now"


def _print_tree(store, gens, refs) -> None:
    by_parent: dict[str | None, list] = {}
    for g in gens:
        by_parent.setdefault(g.parent, []).append(g)
    marks = {r.generation: r.name for r in refs.values()}

    def walk(parent: str | None, depth: int) -> None:
        for g in sorted(by_parent.get(parent, []), key=lambda x: int(x.id[1:])):
            mark = f"  <- {marks[g.id]}" if g.id in marks else ""
            pad = "  " * depth + ("+- " if depth else "")
            print(
                f"{pad}{g.id}  {g.kind:<7} {g.content_hash}  {_age(g.created_at):>10}"
                f"  {g.note[:48]}{mark}"
            )
            walk(g.id, depth + 1)

    for root in sorted(by_parent.get(None, []), key=lambda x: int(x.id[1:])):
        mark = f"  <- {marks[root.id]}" if root.id in marks else ""
        print(f"{root.id}  {root.kind:<7} {root.content_hash}  {_age(root.created_at):>10}  {root.note[:48]}{mark}")
        walk(root.id, 1)
    if not gens:
        print("(empty store)")


def cmd_init(args) -> int:
    store = _store(args)
    if args.from_dir:
        gen = store.import_tree(Path(args.from_dir), kind="base", note=args.note or "")
    else:
        surface = OPENCODE_SURFACE
        gen = store.init(
            tree={a: "" for a in surface.always_on} | {"systemprompt.md": ""},
            kind="base",
            note=args.note or "empty base",
        )
    print(f"initialised {store.root}")
    print(f"  {gen.id}  {gen.kind}  {gen.content_hash}")
    if store.get_ref("stable") is None:
        store.set_ref("stable", gen.id, by="init", reason="first generation")
        print(f"  ref stable -> {gen.id}")
    return 0


def cmd_list(args) -> int:
    store = _store(args)
    gens = store.generations()
    refs = store.refs()
    if args.json:
        import json

        print(
            json.dumps(
                {
                    "root": str(store.root),
                    "generations": [g.to_dict() for g in gens],
                    "refs": {k: v.to_dict() for k, v in refs.items()},
                },
                indent=2,
            )
        )
        return 0
    _print_tree(store, gens, refs)
    if refs:
        print()
        for name, ref in sorted(refs.items()):
            print(f"ref {name:<8} -> {ref.generation}  ({ref.by or 'unknown'}, {_age(ref.updated_at)})")
    problems = store.verify()
    if problems:
        print()
        for p in problems:
            print(f"  ! {p}")
        return 1
    return 0


def cmd_show(args) -> int:
    store = _store(args)
    g = store.current(args.ref)
    print(f"{g.id}  ({g.kind})")
    print(f"  content_hash {g.content_hash}")
    print(f"  parent       {g.parent or '-'}")
    print(f"  created      {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(g.created_at))}")
    if g.note:
        print(f"  note         {g.note}")
    print("  lineage      " + " <- ".join(x.id for x in store.lineage(g.id)))
    tree = store.tree_of(g.id)
    print(f"  files        {len(tree)}")
    for rel in sorted(tree):
        print(f"    {len(tree[rel]):>7}  {rel}")
    return 0


def cmd_promote(args) -> int:
    store = _store(args)
    parent = args.parent or store.current(args.ref).id
    src = Path(args.from_dir)
    from harness2.core import tree as ht

    tree = ht.read_tree(OPENCODE_SURFACE, src)
    if not tree:
        print(f"error: no editable files under {src}", file=sys.stderr)
        return 2
    gen = store.commit(
        parent,
        tree,
        kind=args.kind,
        note=args.note or f"promoted from {src}",
        ref=None if args.no_ref else args.ref,
    )
    print(f"{gen.id}  parent={gen.parent}  hash={gen.content_hash}")
    if not args.no_ref:
        print(f"ref {args.ref} -> {gen.id}")
    return 0


def cmd_adopt(args) -> int:
    """Gate a harness directory, and commit it only if it passes."""
    from harness2.core import tree as ht

    from .gate import Limits, gate_and_promote

    store = _store(args)
    src = Path(args.from_dir)
    tree = ht.read_tree(OPENCODE_SURFACE, src)
    if not tree:
        print(f"error: no editable files under {src}", file=sys.stderr)
        return 2

    limits = Limits(
        max_changed_files=args.max_changed,
        max_always_on_delta=args.max_always_on,
        max_added_skills=args.max_skills,
    )
    levels = tuple(args.levels.split(",")) if args.levels else None
    verdict, gen = gate_and_promote(
        store,
        tree,
        limits=limits,
        levels=levels or ("L1", "L2", "L3", "L4"),
        ref=args.ref,
        kind=args.kind,
        note=args.note,
    )

    live = store.current(args.ref)
    print(f"live   {live.id}  {live.content_hash}")
    print(f"candidate {src}")
    print()
    if verdict.ok:
        print("  L1 static   ok" + (f"   {verdict.census}" if verdict.census else ""))
        if verdict.smoke:
            print("  L2 smoke    ok")
            for k, v in verdict.smoke.items():
                print(f"                {k}: {v}")
        if verdict.baseline:
            print("  L3 parity   ok (no regression against live)")
        d = verdict.delta
        print(
            f"  L4 budget   ok   +{len(d.get('added', []))} ~{len(d.get('modified', []))} "
            f"-{len(d.get('removed', []))} files, always-on {d.get('always_on_char_delta', 0):+d}"
        )
        print()
        print(verdict.explain())
        print(f"{gen.id}  parent={gen.parent}  hash={gen.content_hash}")
        print(f"ref {args.ref} -> {gen.id}")
        return 0

    print(f"  {verdict.level} FAILED")
    print()
    print(verdict.explain())
    if verdict.smoke:
        print()
        for k, v in verdict.smoke.items():
            print(f"  {k}: {v}")
    if verdict.baseline:
        print()
        for k, v in verdict.baseline.items():
            print(f"  live {k}: {v}")
    print()
    print("nothing was written; the stable pointer did not move")
    return 1


def cmd_gate(args) -> int:
    """Dry-run the gate without committing anything."""
    from harness2.core import tree as ht

    from .gate import Limits, gate

    store = _store(args)
    live = store.current(args.ref)
    live_tree = store.tree_of(live.id)
    tree = ht.read_tree(OPENCODE_SURFACE, Path(args.from_dir))
    if not tree:
        print(f"error: no editable files under {args.from_dir}", file=sys.stderr)
        return 2
    verdict = gate(
        OPENCODE_SURFACE,
        live_tree,
        tree,
        limits=Limits(max_changed_files=args.max_changed),
        levels=tuple(args.levels.split(",")) if args.levels else ("L1", "L2", "L3", "L4"),
    )
    print(verdict.explain())
    if verdict.delta:
        d = verdict.delta
        print(f"  added    {d.get('added', [])}")
        print(f"  modified {d.get('modified', [])}")
        print(f"  removed  {d.get('removed', [])}")
    if verdict.smoke:
        for k, v in verdict.smoke.items():
            print(f"  candidate {k}: {v}")
    if verdict.baseline:
        for k, v in verdict.baseline.items():
            print(f"  live      {k}: {v}")
    return 0 if verdict.ok else 1


def cmd_serve(args) -> int:
    """Run the HTTP service in the foreground."""
    from .server import serve, url_of

    store = _store(args)
    httpd, app, _thread = serve(
        store.root, OPENCODE_SURFACE, host=args.host, port=args.port, verbose=args.verbose
    )
    # The service is the thing that runs tasks, so it needs an executor. Without
    # one it answers every read and refuses every run, which is a service that
    # looks healthy and cannot work.
    from .server import session_executor
    from .sessions import SessionStore

    app.sessions = SessionStore(store.root.parent)
    app.executor = session_executor(store, app.sessions, OPENCODE_SURFACE)
    print(f"rsi serving {store.root}")
    print(f"  {url_of(httpd)}")
    print("  Ctrl-C to stop")
    try:
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        # stopped first, so any open stream loop exits on its next poll
        # instead of waiting out the shutdown.
        app.stopped.set()
        app.events.close()
        httpd.shutdown()
        httpd.server_close()
    return 0


def cmd_acp(args) -> int:
    """Serve the ACP endpoint goose connects to.

    The engine home is resolved the same way the HTTP service resolves it, so
    both front ends read one `config.toml` instead of two that can disagree about
    which provider is in use.
    """
    from . import acp_server
    from .models import home_for
    from .store import open_store

    store = open_store(_store(args).root, OPENCODE_SURFACE)
    home = home_for(store.root)
    print(f"rsi acp on http://{args.host}:{args.port}")
    print(f"  home  {home}")
    print("  goose: GOOSE_EXTERNAL_BACKEND=1")
    print(f"        GOOSE_EXTERNAL_BACKEND_URL=http://{args.host}:{args.port}")
    if not args.secret:
        print("  no secret: any client that reaches this port is accepted")
    else:
        # The client refuses to start without this one even when the URL is
        # given, so the hint is not complete until it names the same secret
        # this process was just told to require.
        print(f"        GOOSE_SERVER__SECRET_KEY={args.secret}")
    acp_server.run(
        host=args.host,
        port=args.port,
        secret=args.secret,
        home=home,
        model=args.model or None,
    )
    return 0


def cmd_acp_stdio(args) -> int:
    """Serve ACP over stdin and stdout.

    This prints nothing. The client reads stdout as a frame stream, so a banner
    here would be answered as a request it never made; every diagnostic in this
    mode goes to stderr.
    """
    from . import acp_stdio

    acp_stdio.serve_stdio(
        home=args.home or None,
        store=args.store or None,
        model=args.model or None,
    )
    return 0


def cmd_stress(args) -> int:
    """Run the concurrency stress scenarios against a throwaway store."""
    from . import stress

    failed = False
    if args.mode in ("ref", "both"):
        print("== pointer churn (rollback while reading) ==")
        r = stress.run_stress(readers=args.readers, duration=args.duration, writes=args.writes)
        print(json.dumps(r.to_dict(), indent=2))
        failed = failed or not r.ok
    if args.mode in ("adopt", "both"):
        print("== real adoptions (gate runs while reading) ==")
        r = stress.run_adoption_stress(readers=args.readers, duration=args.duration)
        print(json.dumps(r.to_dict(), indent=2))
        failed = failed or not r.ok
    print()
    print("RESULT:", "PASS" if not failed else "FAIL")
    return 0 if not failed else 1


def cmd_ui(args) -> int:
    """Open the desktop client. There is no web UI."""
    from .desktop import main as desktop_main

    argv = ["--store", str(Path(args.store))]
    if args.sessions:
        argv.extend(["--sessions", args.sessions])
    return desktop_main(argv)


def cmd_tasks(args) -> int:
    """List the task set."""
    from . import taskset

    tasks = taskset.TASKS
    if args.domain:
        tasks = [t for t in tasks if t.domain == args.domain]
    for t in tasks:
        print(f"{t.id:<22} {t.domain:<12} {t.expected():<14} {t.note}")
    print()
    print(f"{len(tasks)} tasks, {len(set(t.domain for t in tasks))} domains")
    return 0


def cmd_runset(args) -> int:
    """Run the task set against a harness and print a machine-readable summary."""
    from . import taskset

    root = Path(args.root)
    base = taskset.seed_base_harness(root / "base")
    adapter = taskset.TaskSetAdapter(root)
    harness = Path(args.harness) if args.harness else base
    ids = args.tasks.split(",") if args.tasks else None
    if args.domain:
        ids = adapter.tasks(args.domain)
    summary = taskset.run_set(
        adapter, harness, task_ids=ids, tag=args.tag, timeout=args.timeout,
        on_result=lambda r: print(
            f"  {r['task']:<22} {r.get('shape', '?'):<11} "
            f"{'ok' if r.get('passed') else '--'}",
            flush=True,
        ),
    )
    print()
    print(f"passed {summary['passed']}/{summary['total']}  "
          f"value_ok {summary['value_ok']}/{summary['total']}  "
          f"tokens {summary['tokens']:,}  {summary['seconds']:.0f}s")
    if args.json:
        out = Path(args.json)
        out.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
        print("wrote " + str(out))
    return 0 if summary["passed"] == summary["total"] else 1


def cmd_compare(args) -> int:
    """Diff two summaries produced by `rsi runset --json`."""
    from . import taskset

    a = json.loads(Path(args.baseline).read_text(encoding="utf-8"))
    b = json.loads(Path(args.candidate).read_text(encoding="utf-8"))
    diff = taskset.compare(a, b)
    print(f"shared tasks   {diff['shared']}")
    print(f"baseline pass  {diff['baseline_pass']}")
    print(f"candidate pass {diff['candidate_pass']}")
    print(f"net            {diff['net']:+d}")
    for t in diff["gained"]:
        print("  + " + t)
    for t in diff["lost"]:
        print("  - " + t)
    return 0


def cmd_rollback(args) -> int:
    store = _store(args)
    gen = store.get(args.generation)
    ref = store.rollback(gen.id, name=args.ref, by="cli")
    print(f"ref {ref.name} -> {ref.generation}  ({gen.kind}, {gen.content_hash})")
    print("no files were copied or rebuilt; this is a pointer move")
    return 0


def cmd_verify(args) -> int:
    store = _store(args)
    problems = store.verify()
    if not problems:
        print(f"ok: {len(store.generations())} generations, all digests match")
        return 0
    for p in problems:
        print(f"  ! {p}")
    return 1


def cmd_unlock(args) -> int:
    """Clear write protection so a store directory can be edited or deleted."""
    store = _store(args)
    make_writable(store.root)
    print(f"cleared write protection under {store.root}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="rsi",
        description="Manage immutable harness generations and the live harness pointer.",
    )
    p.add_argument("--store", default=str(DEFAULT_STORE), help="store root (default: %(default)s)")
    sub = p.add_subparsers(dest="cmd", required=True)

    i = sub.add_parser("init", help="create the store and its first generation")
    i.add_argument("--from-dir", help="seed from an existing harness tree")
    i.add_argument("--note", default="")
    i.set_defaults(func=cmd_init)

    ls = sub.add_parser("list", help="show the lineage and refs")
    ls.add_argument("--json", action="store_true")
    ls.set_defaults(func=cmd_list)

    s = sub.add_parser("show", help="describe the generation a ref points at")
    s.add_argument("--ref", default="stable")
    s.set_defaults(func=cmd_show)

    pr = sub.add_parser("promote", help="commit a harness directory as a new generation")
    pr.add_argument("from_dir", metavar="FROM_DIR")
    pr.add_argument("--parent", help="parent generation id (default: current stable)")
    pr.add_argument("--kind", default="manual", choices=list(KINDS))
    pr.add_argument("--note", default="")
    pr.add_argument("--ref", default="stable")
    pr.add_argument("--no-ref", action="store_true", help="write the generation without moving a ref")
    pr.set_defaults(func=cmd_promote)

    ad = sub.add_parser("adopt", help="gate a harness directory and commit it if it passes")
    ad.add_argument("from_dir", metavar="FROM_DIR")
    ad.add_argument("--kind", default="auto", choices=["auto", "manual"])
    ad.add_argument("--note", default="")
    ad.add_argument("--ref", default="stable")
    ad.add_argument("--levels", default="", help="comma-separated subset, e.g. L1,L2,L4")
    ad.add_argument("--max-changed", type=int, default=6)
    ad.add_argument("--max-always-on", type=int, default=4000)
    ad.add_argument("--max-skills", type=int, default=3)
    ad.set_defaults(func=cmd_adopt)

    gt = sub.add_parser("gate", help="run the gate without committing")
    gt.add_argument("from_dir", metavar="FROM_DIR")
    gt.add_argument("--ref", default="stable")
    gt.add_argument("--levels", default="")
    gt.add_argument("--max-changed", type=int, default=6)
    gt.set_defaults(func=cmd_gate)

    sv = sub.add_parser("serve", help="run the HTTP service")
    sv.add_argument("--host", default="127.0.0.1")
    sv.add_argument("--port", type=int, default=8000)
    sv.add_argument("--verbose", action="store_true")
    sv.set_defaults(func=cmd_serve)

    acp = sub.add_parser("acp", help="serve ACP for goose desktop")
    acp.add_argument("--host", default="127.0.0.1")
    acp.add_argument("--port", type=int, default=57800)
    acp.add_argument(
        "--secret",
        default="",
        help="shared secret goose must present; empty disables the check on loopback",
    )
    acp.add_argument("--model", default="", help="model every run uses")
    acp.set_defaults(func=cmd_acp)

    acps = sub.add_parser(
        "acp-stdio",
        help="serve ACP over stdin/stdout for a client that spawns this process",
    )
    acps.add_argument("--home", default="", help="engine home (default: derived from the store)")
    acps.add_argument("--store", default="", help="generation store to derive the home from")
    acps.add_argument("--model", default="", help="model every run uses")
    acps.set_defaults(func=cmd_acp_stdio)

    st = sub.add_parser("stress", help="concurrency stress against a throwaway store")
    st.add_argument("--readers", type=int, default=16)
    st.add_argument("--duration", type=float, default=5.0)
    st.add_argument("--writes", type=int, default=50)
    st.add_argument("--mode", choices=["ref", "adopt", "both"], default="both")
    st.set_defaults(func=cmd_stress)

    ui = sub.add_parser("ui", help="open the desktop client (sessions, workspaces, agent)")
    ui.add_argument("--sessions", default="", help="sessions root (default: beside the store)")
    ui.set_defaults(func=cmd_ui)

    ts = sub.add_parser("tasks", help="list the task set")
    ts.add_argument("--domain", default="", help="only this domain")
    ts.set_defaults(func=cmd_tasks)

    rs = sub.add_parser("runset", help="run the task set against a harness")
    rs.add_argument("--root", default="taskset_root", help="task set working root")
    rs.add_argument("--harness", default="", help="harness dir (default: the seeded base)")
    rs.add_argument("--domain", default="", help="only this domain")
    rs.add_argument("--tasks", default="", help="comma-separated task ids")
    rs.add_argument("--tag", default="run", help="run id prefix")
    rs.add_argument("--timeout", type=int, default=120)
    rs.add_argument("--json", default="", help="write the summary here")
    rs.set_defaults(func=cmd_runset)

    cp = sub.add_parser("compare", help="diff two runset summaries")
    cp.add_argument("baseline", metavar="BASELINE")
    cp.add_argument("candidate", metavar="CANDIDATE")
    cp.set_defaults(func=cmd_compare)

    rb = sub.add_parser("rollback", help="point a ref back at an existing generation")
    rb.add_argument("generation", metavar="GEN")
    rb.add_argument("--ref", default="stable")
    rb.set_defaults(func=cmd_rollback)

    v = sub.add_parser("verify", help="check digests and refs")
    v.set_defaults(func=cmd_verify)

    u = sub.add_parser("unlock", help="clear write protection on the store (for deletion)")
    u.set_defaults(func=cmd_unlock)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return int(args.func(args))
    except StoreError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())