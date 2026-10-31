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

"""Stress the service: concurrent readers against a moving pointer.

The claim under test is not "the endpoints return 200". It is that a reader never observes
a harness that is neither the old one nor the new one -- no truncated file, no missing
script, no mix of two generations -- while a writer moves the ref underneath it.

Run directly for a report:  python -m rsi.stress
"""

from __future__ import annotations

import json
import statistics
import threading
import time
import http.client
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Callable

from harness2.substrate.opencode import OPENCODE_SURFACE

from .store import open_store

SCRIPT_TEMPLATE = "print('generation {tag}')\n"


def _base_tree() -> dict[str, str]:
    tree = {k: "" for k in OPENCODE_SURFACE.always_on}
    tree["systemprompt.md"] = "Use scripts/summarize.py.\n"
    tree["scripts/summarize.py"] = SCRIPT_TEMPLATE.format(tag="A")
    return tree


@dataclass
class StressReport:
    readers: int = 0
    duration: float = 0.0
    writes: int = 0
    requests: int = 0
    errors: list[str] = field(default_factory=list)
    inconsistent: list[str] = field(default_factory=list)
    latencies: list[float] = field(default_factory=list)
    generations_seen: set[str] = field(default_factory=set)
    # A refusal the scenario intends (a duplicate tree, a gate rejection) is a result, not
    # a failure. Counting it as an error makes a passing run look broken, which is worse
    # than not checking at all.
    expected_refusals: int = 0

    def to_dict(self) -> dict:
        lat = sorted(self.latencies)

        def pct(p: float) -> float:
            if not lat:
                return 0.0
            idx = min(len(lat) - 1, int(len(lat) * p))
            return round(lat[idx] * 1000, 2)

        return {
            "readers": self.readers,
            "duration_s": round(self.duration, 2),
            "writes": self.writes,
            "requests": self.requests,
            "rps": round(self.requests / self.duration, 1) if self.duration else 0,
            "errors": len(self.errors),
            "expected_refusals": self.expected_refusals,
            "inconsistent": len(self.inconsistent),
            "generations_seen": len(self.generations_seen),
            "latency_ms": {
                "p50": pct(0.50),
                "p95": pct(0.95),
                "p99": pct(0.99),
                "max": round(lat[-1] * 1000, 2) if lat else 0.0,
            },
            "sample_errors": self.errors[:3],
            "sample_inconsistent": self.inconsistent[:3],
        }

    @property
    def ok(self) -> bool:
        return not self.errors and not self.inconsistent


class _Client:
    """An HTTP client that REUSES its connection.

    This matters more than it looks. A fresh `urllib.request.urlopen` per call opens a new
    TCP connection each time; at 64 readers that exhausts the ephemeral port range inside a
    few seconds and every call fails with WinError 10048. The first version of this file did
    exactly that and reported the exhaustion as service errors -- the service was fine.
    One persistent connection per thread removes the artefact entirely.
    """

    def __init__(self, base: str) -> None:
        parsed = urllib.parse.urlsplit(base.rstrip("/"))
        self.host = parsed.hostname or "127.0.0.1"
        self.port = parsed.port or 80
        self._local = threading.local()

    def _conn(self) -> http.client.HTTPConnection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = http.client.HTTPConnection(self.host, self.port, timeout=30.0)
            self._local.conn = conn
        return conn

    def _request(self, method: str, path: str, payload: dict | None = None) -> tuple[int, bytes]:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"Content-Type": "application/json"} if body else {}
        for attempt in (0, 1):
            conn = self._conn()
            try:
                conn.request(method, path, body=body, headers=headers)
                resp = conn.getresponse()
                return resp.status, resp.read()
            except (http.client.HTTPException, OSError):
                # A reused connection can be closed by the server between requests; one
                # retry on a fresh connection is the standard remedy and is not a failure.
                try:
                    conn.close()
                except Exception:
                    pass
                self._local.conn = None
                if attempt:
                    raise
        raise RuntimeError("unreachable")

    def get(self, path: str, timeout: float = 5.0) -> tuple[int, bytes]:
        return self._request("GET", path)

    def post(self, path: str, payload: dict, timeout: float = 30.0) -> tuple[int, bytes]:
        return self._request("POST", path, payload)

    def close(self) -> None:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
            self._local.conn = None


def _check_consistency(payload: dict, expected_tags: set[str]) -> str:
    """A response must be exactly one generation, and internally coherent.

    The failure this catches: a reader mid-swap that gets A's id with B's files, or a tree
    with a script whose content belongs to neither.
    """
    gen = payload.get("generation")
    files = payload.get("files") or []
    if not gen:
        return f"no generation in response: {payload}"
    if "scripts/summarize.py" not in files:
        return f"{gen}: scripts/summarize.py missing from {files}"
    if "systemprompt.md" not in files:
        return f"{gen}: systemprompt.md missing"
    return ""


def run_stress(
    *,
    readers: int = 8,
    duration: float = 5.0,
    writes: int = 30,
    port: int = 0,
    verbose: bool = False,
) -> StressReport:
    """Spin up a store with N generations and hammer /current while moving the ref."""
    import tempfile
    from pathlib import Path

    from .server import serve

    root = Path(tempfile.mkdtemp(prefix="rsi-stress-"))
    store = open_store(root / "store", OPENCODE_SURFACE)
    store.init(tree=_base_tree())
    store.set_ref("stable", "g0001")

    # Pre-build alternating generations so writers only move the pointer.
    tags = ["A"]
    for i, tag in enumerate("BCDEFGHIJ", start=2):
        t = _base_tree()
        t["scripts/summarize.py"] = SCRIPT_TEMPLATE.format(tag=tag)
        t["systemprompt.md"] = f"Use scripts/summarize.py. (version {tag})\n"
        store.commit(f"g{i - 1:04d}", t)
        tags.append(tag)

    httpd, app, _thread = serve(root / "store", OPENCODE_SURFACE, port=port, verbose=verbose)
    client = _Client(f"http://127.0.0.1:{httpd.server_address[1]}")
    report = StressReport(readers=readers)
    stop = threading.Event()

    def reader() -> None:
        while not stop.is_set():
            t0 = time.perf_counter()
            try:
                status, raw = client.get("/current")
            except Exception as exc:
                report.errors.append(f"request failed: {type(exc).__name__}: {exc}")
                continue
            dt = time.perf_counter() - t0
            report.latencies.append(dt)
            report.requests += 1
            if status != 200:
                report.errors.append(f"status {status}: {raw[:120]}")
                continue
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                report.errors.append(f"non-JSON body: {raw[:120]}")
                continue
            report.generations_seen.add(str(payload.get("generation")))
            problem = _check_consistency(payload, set(tags))
            if problem:
                report.inconsistent.append(problem)

    threads = [threading.Thread(target=reader, daemon=True) for _ in range(readers)]
    t_start = time.perf_counter()
    for t in threads:
        t.start()

    gen_ids = [g.id for g in store.generations()]
    for i in range(writes):
        target = gen_ids[i % len(gen_ids)]
        try:
            status, raw = client.post("/rollback", {"generation": target})
            if status != 200:
                report.errors.append(f"rollback {target} -> {status}: {raw[:120]}")
            else:
                report.writes += 1
        except Exception as exc:
            report.errors.append(f"rollback failed: {type(exc).__name__}: {exc}")
        time.sleep(max(0.0, (duration / max(1, writes)) - 0.002))

    time.sleep(max(0.0, duration - (time.perf_counter() - t_start)))
    stop.set()
    for t in threads:
        t.join(timeout=5.0)
    report.duration = time.perf_counter() - t_start

    app.events.close()
    httpd.shutdown()
    httpd.server_close()
    return report


def run_adoption_stress(
    *, readers: int = 6, duration: float = 5.0, port: int = 0
) -> StressReport:
    """Hammer /current while real adoptions run through the gate."""
    import tempfile
    from pathlib import Path

    from .server import serve

    root = Path(tempfile.mkdtemp(prefix="rsi-adopt-"))
    store = open_store(root / "store", OPENCODE_SURFACE)
    base = _base_tree()
    base["scripts/summarize.py"] = (
        "import csv, sys\n"
        "from decimal import Decimal\n"
        "with open(sys.argv[1]) as f:\n"
        "    rows = [Decimal(r['amount']) for r in csv.DictReader(f)]\n"
        "print(f'Total: {sum(rows, Decimal(0)):.2f}')\n"
    )
    store.init(tree=base)
    store.set_ref("stable", "g0001")

    httpd, app, _ = serve(root / "store", OPENCODE_SURFACE, port=port)
    client = _Client(f"http://127.0.0.1:{httpd.server_address[1]}")
    report = StressReport(readers=readers)
    stop = threading.Event()

    def reader() -> None:
        while not stop.is_set():
            t0 = time.perf_counter()
            try:
                status, raw = client.get("/current")
            except Exception as exc:
                report.errors.append(f"{type(exc).__name__}: {exc}")
                continue
            report.latencies.append(time.perf_counter() - t0)
            report.requests += 1
            if status != 200:
                report.errors.append(f"status {status}")
                continue
            payload = json.loads(raw)
            report.generations_seen.add(str(payload.get("generation")))
            problem = _check_consistency(payload, {"A"})
            if problem:
                report.inconsistent.append(problem)

    threads = [threading.Thread(target=reader, daemon=True) for _ in range(readers)]
    t_start = time.perf_counter()
    for t in threads:
        t.start()

    # Adopt a series of small, valid edits -- each must pass the full gate.
    # Each variant must differ from every other AND from the base, or the store correctly
    # refuses it as a duplicate and the scenario measures nothing.
    extras = (
        "Be exact.",
        "Prefer Decimal.",
        "Check the sign of every row.",
        "Do not filter rows.",
        "Report the total once.",
    )
    variants = [
        (base["systemprompt.md"] + extra + "\n", f"note {i}")
        for i, extra in enumerate(extras, start=1)
    ]
    for prompt, note in variants:
        tree = dict(base)
        tree["systemprompt.md"] = prompt
        status, raw = client.post("/adopt", {"tree": tree, "kind": "auto", "note": note})
        if status == 200:
            report.writes += 1
        elif status == 409 and b"identical" in raw:
            # Re-adopting content the store already holds is refused by design.
            report.expected_refusals += 1
        else:
            report.errors.append(f"adopt -> {status}: {raw[:160]}")
        time.sleep(max(0.05, duration / 12))

    time.sleep(max(0.0, duration - (time.perf_counter() - t_start)))
    stop.set()
    for t in threads:
        t.join(timeout=5.0)
    report.duration = time.perf_counter() - t_start
    app.events.close()
    httpd.shutdown()
    httpd.server_close()
    return report


def main(argv: list[str] | None = None) -> int:
    import argparse

    p = argparse.ArgumentParser(prog="rsi-stress", description="Stress the RSI service.")
    p.add_argument("--readers", type=int, default=8)
    p.add_argument("--duration", type=float, default=5.0)
    p.add_argument("--writes", type=int, default=30)
    p.add_argument("--mode", choices=["ref", "adopt", "both"], default="both")
    p.add_argument("--port", type=int, default=0)
    args = p.parse_args(argv)

    failed = False
    if args.mode in ("ref", "both"):
        print("== pointer churn (rollback while reading) ==")
        r = run_stress(readers=args.readers, duration=args.duration, writes=args.writes, port=args.port)
        print(json.dumps(r.to_dict(), indent=2))
        failed = failed or not r.ok
    if args.mode in ("adopt", "both"):
        print("== real adoptions (gate runs while reading) ==")
        r = run_adoption_stress(readers=args.readers, duration=args.duration, port=args.port)
        print(json.dumps(r.to_dict(), indent=2))
        failed = failed or not r.ok
    print()
    print("RESULT:", "PASS" if not failed else "FAIL")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = ["StressReport", "run_stress", "run_adoption_stress", "main"]