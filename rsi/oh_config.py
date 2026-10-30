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

"""Turn the engine's `config.toml` into an OpenHands `LLM`.

The file stays the single source of truth. OpenHands does not read TOML -- it
takes a constructor call or one of its own JSON stores -- so the translation
lives here, in one place, instead of being spread over every caller that needs
a model.

`resolve` does the deciding and answers a plain dict; `to_llm` is the thin
constructor call on top of it. The split is what lets the mapping be tested
without OpenHands installed, which matters because `rsi` runs under the plain
interpreter as well as under `.venv-oh`.

Three of the mappings are not obvious:

* **The model id gains a routing prefix.** litellm routes on `provider/model`
  and rejects an id it cannot attribute: `workbuddy/deepseek-v4.1-flash` raises
  `LLM Provider NOT provided`, because `workbuddy` is not one of its providers.
  Our ids all carry a vendor segment of their own, so "already has a slash" is
  not the test -- `normalize_model` asks litellm and prefixes with `openai/`
  only when it has to. That prefix is the OpenAI-compatible wire, which is what
  every model behind our proxy speaks, and the id is then sent through
  unchanged.

* **`wire_api` becomes `api_mode`.** Our `responses` and `chat` are both
  values litellm accepts, so the mapping is the identity; an absent or unknown
  value falls back to `auto`, which lets litellm pick rather than guessing here.

* **`http_headers` is where the proxy's own header goes.** Our config carries
  a header the proxy requires; dropping the table would produce 401s that look
  like a bad key.

`${ENV_VAR}` values are expanded against the environment, the way the engine
expands them, so a config that points at an environment variable keeps working.
Nothing here writes: reads only.
"""

from __future__ import annotations

import os
import re
import tomllib
from pathlib import Path
from typing import Any

from .providers import CONFIG_NAME, config_path

# The section a provider block lives in, and the name of the key that picks one.
PROVIDERS_TABLE = "model_providers"
ACTIVE_KEY = "model_provider"

# The routing prefix litellm needs for the OpenAI-compatible wire. Every
# provider block in our config names a base URL, so this is the only wire a
# model id can mean here.
OPENAI_PREFIX = "openai/"

# What `wire_api` in our config may say, and what it becomes. A `wire_api` we
# do not know is not an error here -- the engine is the authority that refuses
# it -- so it resolves to `auto` and litellm decides.
API_MODES = {"responses": "responses", "chat": "chat"}
AUTO_API_MODE = "auto"

# Where a credential may come from, in the order they are tried: inline in the
# block, then an environment variable the block names.
TOKEN_KEY = "experimental_bearer_token"
ENV_KEY = "env_key"

_ENV_REF = re.compile(r"^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$")


class ConfigError(RuntimeError):
    """A config this module will not turn into a model, with the status to report."""

    def __init__(self, message: str, *, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def load(home: Path | str) -> dict[str, Any]:
    """The parsed config. Raises `ConfigError` when it cannot be read.

    Unlike the settings page's reader, which answers "no providers" so a fresh
    install still draws, a caller that needs a model has nothing to fall back
    on: a missing or broken file is the reason it cannot run, and saying so is
    more useful than constructing a model that fails at the first request.
    """
    path = config_path(home)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise ConfigError(f"Cannot read {path}: {error.strerror or error}") from error
    try:
        return tomllib.loads(text)
    except tomllib.TOMLDecodeError as error:
        raise ConfigError(f"{path} is not valid TOML: {error}") from error


def normalize_model(model: str) -> str:
    """The model id as litellm needs it, with a routing prefix when it has none.

    litellm rejects an id whose first segment it does not recognise, and every
    id of ours has a vendor segment (`workbuddy/...`, `grok/...`) that it does
    not. Asking litellm rather than keeping a list of names means a provider id
    it does know is left alone instead of being doubled up.
    """
    model = model.strip()
    if not model:
        raise ConfigError(f"`{CONFIG_NAME}` sets no model")
    if model.startswith(OPENAI_PREFIX):
        return model
    if _litellm_knows(model):
        return model
    return OPENAI_PREFIX + model


def _litellm_knows(model: str) -> bool:
    """Whether litellm can attribute `model` to a provider it has.

    Answers `False` when litellm is not installed, which is the right guess for
    a plain interpreter: without litellm nothing routes either way, and the
    prefix is what our proxy expects.
    """
    try:
        import litellm
    except ImportError:
        return False
    try:
        litellm.get_llm_provider(model)
    except Exception:
        return False
    return True


def api_mode_for(wire_api: str) -> str:
    """`LLM.api_mode` for one `wire_api` value; `auto` when it says nothing usable."""
    return API_MODES.get(wire_api.strip().lower(), AUTO_API_MODE)


def active_provider(data: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """The `(id, block)` that `model_provider` names.

    A config with exactly one block and no `model_provider` key means that
    block: that is the only reading under which the file is not broken, and a
    settings page may well have written the block before the key.
    """
    table = data.get(PROVIDERS_TABLE)
    if not isinstance(table, dict) or not table:
        raise ConfigError(f"`{CONFIG_NAME}` has no [{PROVIDERS_TABLE}.<id>] block")
    blocks = {str(k): v for k, v in table.items() if isinstance(v, dict)}
    if not blocks:
        raise ConfigError(f"`{CONFIG_NAME}` has no [{PROVIDERS_TABLE}.<id>] block")
    named = data.get(ACTIVE_KEY)
    named = named.strip() if isinstance(named, str) else ""
    if named:
        block = blocks.get(named)
        if block is None:
            raise ConfigError(
                f"`{CONFIG_NAME}` sets {ACTIVE_KEY} = {named!r}, "
                f"but there is no [{PROVIDERS_TABLE}.{named}] block; "
                f"the file has {', '.join(sorted(blocks))}"
            )
        return named, block
    if len(blocks) == 1:
        return next(iter(blocks.items()))
    raise ConfigError(
        f"`{CONFIG_NAME}` has {len(blocks)} provider blocks and no {ACTIVE_KEY}"
    )


def provider_token(block: dict[str, Any]) -> str | None:
    """The credential for one block, or `None` when it has none.

    A `${NAME}` value is read from the environment, which is also where the
    engine reads it, so a config that never held a literal secret still works.
    """
    raw = block.get(TOKEN_KEY)
    if isinstance(raw, str) and raw.strip():
        return _expand(raw.strip())
    name = block.get(ENV_KEY)
    if isinstance(name, str) and name.strip():
        value = os.environ.get(name.strip())
        if value and value.strip():
            return value
    return None


def _expand(value: str) -> str:
    match = _ENV_REF.match(value)
    if match is None:
        return value
    return os.environ.get(match.group(1), "")


def extra_headers(block: dict[str, Any]) -> dict[str, str]:
    """The `http_headers` table as plain strings. Anything else is ignored.

    TOML allows a nested table here as well as an inline one, and a config that
    used the table form is still a table to `tomllib`, so both arrive the same.
    """
    raw = block.get("http_headers")
    if not isinstance(raw, dict):
        return {}
    return {str(k): _expand(_scalar(v)) for k, v in raw.items() if _scalar(v)}


def _scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (str, int, float)):
        return str(value)
    return ""


def resolve(
    home: Path | str,
    *,
    usage_id: str = "rsi",
    model: str | None = None,
    timeout: int | None = None,
) -> dict[str, Any]:
    """The `LLM` constructor fields this engine home's config describes.

    `model` overrides the configured id, which is what a caller switching model
    for one run needs; the provider block is unchanged either way, because it
    names the endpoint rather than the model.

    Raises `ConfigError` for a config that cannot produce a model, so a caller
    reports the file rather than a litellm error three layers down.
    """
    data = load(home)
    provider_id, block = active_provider(data)

    chosen = model if model is not None else data.get("model")
    if not isinstance(chosen, str) or not chosen.strip():
        raise ConfigError(f"`{CONFIG_NAME}` sets no model")

    base_url = block.get("base_url")
    base_url = base_url.strip() if isinstance(base_url, str) else ""
    if not base_url:
        raise ConfigError(f"provider {provider_id!r} sets no base_url")

    token = provider_token(block)
    if token is None:
        raise ConfigError(
            f"provider {provider_id!r} has no {TOKEN_KEY} and no {ENV_KEY} "
            f"naming an environment variable that is set"
        )

    wire_api = block.get("wire_api")
    wire_api = wire_api.strip() if isinstance(wire_api, str) else ""

    fields: dict[str, Any] = {
        "model": normalize_model(chosen),
        "base_url": base_url,
        "api_key": token,
        "api_mode": api_mode_for(wire_api),
        "usage_id": usage_id,
    }
    headers = extra_headers(block)
    if headers:
        fields["extra_headers"] = headers
    if timeout is not None:
        fields["timeout"] = timeout
    return fields


def to_llm(
    home: Path | str,
    *,
    usage_id: str = "rsi",
    model: str | None = None,
    timeout: int | None = None,
):
    """Build the `LLM` this engine home's config describes."""
    from openhands.sdk.llm.llm import LLM

    return LLM(**resolve(home, usage_id=usage_id, model=model, timeout=timeout))


def describe(home: Path | str) -> dict[str, Any]:
    """The block's routing fields without its credential, for logging and for a page."""
    data = load(home)
    provider_id, block = active_provider(data)
    model = data.get("model")
    wire_api = block.get("wire_api")
    base_url = block.get("base_url")
    return {
        "provider": provider_id,
        "model": normalize_model(model) if isinstance(model, str) else "",
        "base_url": base_url if isinstance(base_url, str) else "",
        "api_mode": api_mode_for(wire_api if isinstance(wire_api, str) else ""),
        "headers": sorted(extra_headers(block)),
        "has_key": provider_token(block) is not None,
    }
