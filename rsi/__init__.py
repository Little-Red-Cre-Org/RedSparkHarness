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

"""RSI Harness: the lifecycle layer around a Harness2 harness.

Harness2 decides what a harness should contain. This package decides which harness is
live, how it got there, and how to get back. Nothing here re-implements the upstream
search: `rsi` imports `harness2.core` and adds identity on top of it.
"""

from .store import Generation, Ref, Store, StoreError, content_hash, open_store

__all__ = ["Generation", "Ref", "Store", "StoreError", "content_hash", "open_store"]
__version__ = "0.1.0"
