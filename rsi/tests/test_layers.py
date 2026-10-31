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

"""The layers must stay apart, and the test says so by importing them apart.

"Storage does not decide execution" is the invariant this project is built
around, and it is the kind that erodes quietly: one import at the top of a
module and the client is executing again. Asserting on the import graph is
cruder than asserting on behaviour, but it is the only check that notices the
import being added, which is exactly how this goes wrong.

Each module is imported in a subprocess so a module already loaded elsewhere in
the suite cannot make the check pass by accident.
"""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# module to import -> what it must not pull in, and why.
CASES = {
    "rsi.sessions": (
        ["rsi.agent"],
        "a session stores runs and owns a workspace; it does not execute them",
    ),
    "rsi.desktop": (
        ["rsi.agent", "rsi.engine"],
        "the window talks to a service over HTTP; the engine is the server's",
    ),
    "rsi.service": (
        ["rsi.agent"],
        "the client-side handle speaks HTTP and nothing else",
    ),
}


def imported_after(module: str) -> set[str]:
    code = (
        "import sys;"
        "before=set(sys.modules);"
        f"import {module};"
        "print(chr(10).join(sorted(set(sys.modules)-before)))"
    )
    out = subprocess.run(
        [sys.executable, "-c", code],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=120,
    )
    if out.returncode != 0:
        raise AssertionError("could not import " + module + ":\n" + out.stderr[-2000:])
    return {line.strip() for line in out.stdout.splitlines() if line.strip()}


class LayeringTests(unittest.TestCase):
    def test_modules_do_not_import_the_agent(self):
        for module, (forbidden, why) in CASES.items():
            with self.subTest(module=module):
                loaded = imported_after(module)
                pulled = [m for m in forbidden if m in loaded]
                self.assertEqual(
                    pulled, [], module + " imported " + str(pulled) + " -- " + why
                )

    def test_the_server_reaches_the_agent_only_when_it_runs_something(self):
        """server must import the agent lazily, inside session_executor.

        A module-level import would make importing the service pull in an HTTP
        model client, which is the coupling the seam exists to avoid.
        """
        loaded = imported_after("rsi.server")
        self.assertNotIn("rsi.agent", loaded)


if __name__ == "__main__":
    unittest.main()
