# Copyright 2026 Google LLC
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

"""An advisory whole-file lock that exists on every platform.

The summary writer merges per-mode records that separate processes append, so it needs
mutual exclusion around a read-modify-write. POSIX has `fcntl.flock`; Windows does not, and
a bare `import fcntl` inside the writer aborted the ENTIRE write on Windows -- after every
rollout had already been paid for. This module is the one place that difference lives.

The two implementations are NOT equivalent, and the difference is acceptable only for the
job they do here:

* `fcntl.flock` takes a whole-file advisory lock. Other processes that do not ask for it
  are unaffected.
* `msvcrt.locking` takes a mandatory lock on a byte range. We lock byte 0 and unlock the
  same byte, which makes two cooperating writers serialise exactly as they do on POSIX.

Both are locks between cooperating writers in one run directory, not a defence against
other processes, and not a substitute for atomic replace: the caller still writes to a
temporary file and `os.replace`es it into place.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, TextIO

if os.name == "posix":
    import fcntl

    def _acquire(fh: TextIO) -> None:
        fcntl.flock(fh, fcntl.LOCK_EX)

    def _release(fh: TextIO) -> None:
        fcntl.flock(fh, fcntl.LOCK_UN)

else:
    import msvcrt

    def _acquire(fh: TextIO) -> None:
        fh.seek(0)
        # LK_LOCK retries for ~10s, then raises; the writers it serialises hold the lock
        # for one read-modify-write of a small JSON file.
        msvcrt.locking(fh.fileno(), msvcrt.LK_LOCK, 1)

    def _release(fh: TextIO) -> None:
        fh.seek(0)
        msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)


@contextmanager
def exclusive(path: Path | str) -> Iterator[TextIO]:
    """Hold an exclusive lock on `path` for the duration of the block."""
    lock = Path(path)
    lock.parent.mkdir(parents=True, exist_ok=True)
    with open(lock, "w") as fh:
        _acquire(fh)
        try:
            yield fh
        finally:
            _release(fh)


__all__ = ["exclusive"]
