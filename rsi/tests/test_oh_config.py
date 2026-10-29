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

"""The translation from `config.toml` to an OpenHands `LLM` is pure, so most of
this tests values rather than a process.

The cases worth pinning are the ones that decide whether a request arrives at
all: the routing prefix litellm needs and the two ids that must not get one, a
`wire_api` we do not recognise falling back rather than raising, a credential
that only exists as an environment variable, and the difference between "no
config" (a real state the settings page draws) and "a config that cannot
produce a model" (the reason a run cannot start).

The request itself is checked separately, once, in
`test_config_reaches_the_proxy`: the value of `resolve` is a dict that the real
constructor has to accept, and only OpenHands can say whether it does.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from rsi import oh_config

REAL_HOME = Path(__file__).resolve().parent.parent / ".rsi" / "engine-home"

CONFIG = """\
model_provider = "magpie"
model = "workbuddy/deepseek-v4.1-flash"

[model_providers.magpie]
name = "magpie"
base_url = "http://127.0.0.1:3425/v1"
wire_api = "responses"
experimental_bearer_token = "magpie"
http_headers = { "x-openai-actor-authorization" = "magpie" }
"""


def write_home(tmp_path: Path, text: str) -> Path:
    home = tmp_path / "engine-home"
    home.mkdir(parents=True, exist_ok=True)
    (home / oh_config.CONFIG_NAME).write_text(text, encoding="utf-8")
    return home


# ---- the model id -------------------------------------------------------------


@pytest.mark.parametrize(
    "given,want",
    [
        ("workbuddy/deepseek-v4.1-flash", "openai/workbuddy/deepseek-v4.1-flash"),
        ("grok/grok-4.7@500k", "openai/grok/grok-4.7@500k"),
        ("hy3", "openai/hy3"),
        # A prefix the caller already wrote is left exactly as it is.
        ("openai/workbuddy/deepseek-v4.1-flash", "openai/workbuddy/deepseek-v4.1-flash"),
        ("  spaced/model  ", "openai/spaced/model"),
    ],
)
def test_model_gains_a_routing_prefix_when_litellm_cannot_route(given, want, monkeypatch):
    """The decision is "does litellm know this id"; the routing itself needs litellm.

    Stubbing the question keeps this in the default suite, which runs without
    OpenHands; `test_litellm_agrees_about_our_ids` below asks the real one.
    """
    monkeypatch.setattr(oh_config, "_litellm_knows", lambda model: False)
    assert oh_config.normalize_model(given) == want


def test_a_provider_id_litellm_knows_is_not_prefixed(monkeypatch):
    """Doubling it would send `deepseek/deepseek/...` and fail at the endpoint instead."""
    monkeypatch.setattr(oh_config, "_litellm_knows", lambda model: True)
    assert oh_config.normalize_model("deepseek/deepseek-v4.1-flash") == "deepseek/deepseek-v4.1-flash"


def test_the_prefix_still_wins_when_litellm_would_know_the_prefixed_id(monkeypatch):
    """`openai/...` is what our proxy speaks, so it is never re-decided."""
    monkeypatch.setattr(oh_config, "_litellm_knows", lambda model: True)
    assert oh_config.normalize_model("openai/hy3") == "openai/hy3"


def test_an_empty_model_is_refused_rather_than_prefixed(monkeypatch):
    monkeypatch.setattr(oh_config, "_litellm_knows", lambda model: False)
    with pytest.raises(oh_config.ConfigError):
        oh_config.normalize_model("   ")


def test_without_litellm_every_unknown_id_is_prefixed():
    """A plain interpreter has no litellm; the proxy's wire is still the right guess."""
    if oh_config._litellm_knows("deepseek/deepseek-v4.1-flash"):
        pytest.skip("litellm is installed here; the uninstalled path is not this one")
    assert oh_config.normalize_model("hy3") == "openai/hy3"


def test_litellm_agrees_about_our_ids():
    """The stub above assumes litellm rejects our ids; this asks it.

    Runs only where litellm is installed — the default interpreter does not
    have it, so the assumption would otherwise go unchecked in the one place
    that matters.
    """
    pytest.importorskip("litellm")
    for model in ("workbuddy/deepseek-v4.1-flash", "grok/grok-4.7-build-fast@500k", "hy3"):
        assert not oh_config._litellm_knows(model), model
        assert oh_config.normalize_model(model) == oh_config.OPENAI_PREFIX + model
    assert oh_config._litellm_knows("deepseek/deepseek-v4.1-flash")


# ---- wire_api ----------------------------------------------------------------


@pytest.mark.parametrize("wire,want", [("responses", "responses"), ("chat", "chat"), (" CHAT ", "chat")])
def test_each_wire_api_keeps_its_name(wire, want):
    assert oh_config.api_mode_for(wire) == want


@pytest.mark.parametrize("wire", ["", "grpc", "Responses API"])
def test_an_unknown_wire_api_lets_litellm_decide(wire):
    assert oh_config.api_mode_for(wire) == oh_config.AUTO_API_MODE


# ---- which block -------------------------------------------------------------


def test_the_named_block_is_the_one_used(tmp_path):
    home = write_home(
        tmp_path,
        'model_provider = "b"\nmodel = "m"\n'
        '[model_providers.a]\nbase_url = "http://a/v1"\n'
        '[model_providers.b]\nbase_url = "http://b/v1"\n',
    )
    assert oh_config.active_provider(oh_config.load(home))[0] == "b"


def test_a_lone_block_is_used_even_without_the_key(tmp_path):
    """A page may write the block before it writes `model_provider`; one block is unambiguous."""
    home = write_home(tmp_path, 'model = "m"\n[model_providers.only]\nbase_url = "http://x/v1"\n')
    assert oh_config.active_provider(oh_config.load(home))[0] == "only"


def test_a_named_block_that_is_not_there_names_both_sides(tmp_path):
    home = write_home(
        tmp_path,
        'model_provider = "missing"\n[model_providers.present]\nbase_url = "http://x/v1"\n',
    )
    with pytest.raises(oh_config.ConfigError) as caught:
        oh_config.active_provider(oh_config.load(home))
    assert "missing" in str(caught.value) and "present" in str(caught.value)


def test_two_blocks_and_no_key_is_refused(tmp_path):
    home = write_home(
        tmp_path,
        '[model_providers.a]\nbase_url = "http://a/v1"\n'
        '[model_providers.b]\nbase_url = "http://b/v1"\n',
    )
    with pytest.raises(oh_config.ConfigError) as caught:
        oh_config.active_provider(oh_config.load(home))
    assert "2 provider blocks" in str(caught.value)


def test_a_config_with_no_provider_block_is_refused(tmp_path):
    home = write_home(tmp_path, 'model = "m"\n')
    with pytest.raises(oh_config.ConfigError):
        oh_config.active_provider(oh_config.load(home))


# ---- reading the file --------------------------------------------------------


def test_an_unreadable_home_is_a_config_error_not_an_oserror(tmp_path):
    with pytest.raises(oh_config.ConfigError) as caught:
        oh_config.load(tmp_path / "nowhere")
    assert not isinstance(caught.value.__cause__, type(None))


def test_broken_toml_is_a_config_error(tmp_path):
    home = write_home(tmp_path, "this is not toml =")
    with pytest.raises(oh_config.ConfigError) as caught:
        oh_config.load(home)
    assert "not valid TOML" in str(caught.value)


# ---- the credential ---------------------------------------------------------


def test_the_inline_token_is_the_credential(tmp_path):
    home = write_home(tmp_path, CONFIG)
    assert oh_config.provider_token(oh_config.active_provider(oh_config.load(home))[1]) == "magpie"


def test_an_env_key_holds_the_token_outside_the_file(tmp_path, monkeypatch):
    home = write_home(
        tmp_path,
        '[model_providers.p]\nbase_url = "http://x/v1"\nenv_key = "MAGPIE_TOKEN"\n',
    )
    monkeypatch.setenv("MAGPIE_TOKEN", "from-env")
    block = oh_config.active_provider(oh_config.load(home))[1]
    assert oh_config.provider_token(block) == "from-env"


def test_an_env_key_whose_variable_is_unset_is_the_same_as_no_credential(tmp_path, monkeypatch):
    home = write_home(
        tmp_path,
        '[model_providers.p]\nbase_url = "http://x/v1"\nenv_key = "NOT_SET_ANYWHERE"\n',
    )
    monkeypatch.delenv("NOT_SET_ANYWHERE", raising=False)
    block = oh_config.active_provider(oh_config.load(home))[1]
    assert oh_config.provider_token(block) is None


def test_an_env_reference_inside_the_token_is_expanded(tmp_path, monkeypatch):
    home = write_home(
        tmp_path,
        '[model_providers.p]\nbase_url = "http://x/v1"\n'
        'experimental_bearer_token = "${MAGPIE_TOKEN}"\n',
    )
    monkeypatch.setenv("MAGPIE_TOKEN", "expanded")
    block = oh_config.active_provider(oh_config.load(home))[1]
    assert oh_config.provider_token(block) == "expanded"


# ---- headers -----------------------------------------------------------------


def test_the_header_table_survives_as_strings(tmp_path):
    home = write_home(tmp_path, CONFIG)
    block = oh_config.active_provider(oh_config.load(home))[1]
    assert oh_config.extra_headers(block) == {"x-openai-actor-authorization": "magpie"}


def test_a_header_written_as_a_sub_table_reads_the_same(tmp_path):
    home = write_home(
        tmp_path,
        'model_provider = "p"\n[model_providers.p]\nbase_url = "http://x/v1"\n'
        '[model_providers.p.http_headers]\n"x-a" = "1"\n',
    )
    block = oh_config.active_provider(oh_config.load(home))[1]
    assert oh_config.extra_headers(block) == {"x-a": "1"}


def test_no_headers_is_an_empty_dict_not_none(tmp_path):
    home = write_home(tmp_path, '[model_providers.p]\nbase_url = "http://x/v1"\n')
    block = oh_config.active_provider(oh_config.load(home))[1]
    assert oh_config.extra_headers(block) == {}


# ---- resolve -----------------------------------------------------------------


def test_resolve_carries_every_field_the_constructor_needs(tmp_path):
    home = write_home(tmp_path, CONFIG)
    fields = oh_config.resolve(home, usage_id="probe")
    assert fields == {
        "model": oh_config.normalize_model("workbuddy/deepseek-v4.1-flash"),
        "base_url": "http://127.0.0.1:3425/v1",
        "api_key": "magpie",
        "api_mode": "responses",
        "usage_id": "probe",
        "extra_headers": {"x-openai-actor-authorization": "magpie"},
    }


def test_a_model_override_keeps_the_endpoint(tmp_path):
    home = write_home(tmp_path, CONFIG)
    fields = oh_config.resolve(home, model="grok/grok-4.7@500k")
    assert fields["base_url"] == "http://127.0.0.1:3425/v1"
    assert fields["model"].endswith("grok/grok-4.7@500k")


def test_no_headers_means_no_key_at_all(tmp_path):
    """Passing `extra_headers={}` would be a value the constructor did not need."""
    home = write_home(tmp_path, 'model = "m"\n[model_providers.p]\nbase_url = "http://x/v1"\n'
                             'experimental_bearer_token = "k"\n')
    assert "extra_headers" not in oh_config.resolve(home)


def test_a_missing_base_url_names_the_provider(tmp_path):
    home = write_home(
        tmp_path,
        'model_provider = "p"\nmodel = "m"\n'
        '[model_providers.p]\nexperimental_bearer_token = "k"\n',
    )
    with pytest.raises(oh_config.ConfigError) as caught:
        oh_config.resolve(home)
    assert "'p'" in str(caught.value) and "base_url" in str(caught.value)


def test_a_missing_credential_is_refused_before_any_request(tmp_path):
    home = write_home(tmp_path, 'model_provider = "p"\nmodel = "m"\n'
                             '[model_providers.p]\nbase_url = "http://x/v1"\n')
    with pytest.raises(oh_config.ConfigError) as caught:
        oh_config.resolve(home)
    assert "experimental_bearer_token" in str(caught.value)


def test_describe_never_carries_the_credential(tmp_path):
    """`describe` is what a page or a log line may print; the secret must not be in it.

    The token and the block id are both `magpie` in the fixture, so the check
    is against the fields a page receives rather than against the word.
    """
    home = write_home(tmp_path, CONFIG)
    described = oh_config.describe(home)
    assert "api_key" not in described
    assert described["has_key"] is True
    assert json.dumps(described).count("magpie") == 1  # the provider id, nothing else


# ---- against the config that actually exists --------------------------------


@pytest.mark.skipif(not (REAL_HOME / oh_config.CONFIG_NAME).exists(), reason="no engine home here")
def test_describe_reads_this_repositorys_config():
    described = oh_config.describe(REAL_HOME)
    assert described["provider"] == "magpie"
    assert described["model"].startswith(oh_config.OPENAI_PREFIX)
    assert described["base_url"].startswith("http://")
    assert described["has_key"] is True


# ---- the one place the real constructor is required -------------------------

VENV = Path(__file__).resolve().parent.parent / ".venv-oh"
VENV_PYTHON = VENV / ("Scripts/python.exe" if (VENV / "Scripts/python.exe").exists() else "bin/python")


def proxy_is_up(host: str = "127.0.0.1", port: int = 3425) -> bool:
    import socket

    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


@pytest.mark.skipif(not VENV_PYTHON.exists(), reason="no .venv-oh beside the repository")
def test_config_reaches_the_proxy():
    """`resolve` is correct only if the real `LLM` accepts it and the proxy answers.

    `.venv-oh` carries OpenHands and this interpreter does not, so the check
    runs there as a child: building the fields here and constructing there is
    the whole point, since a field name `resolve` invents would pass locally.
    Skipped when the proxy is not listening -- that is a machine state, not a
    failure of this module.
    """
    if not proxy_is_up():
        pytest.skip("magpie proxy is not listening on 127.0.0.1:3425")
    script = (
        "import json, sys\n"
        f"sys.path.insert(0, {str(Path(__file__).resolve().parent.parent)!r})\n"
        "from rsi import oh_config\n"
        "from openhands.sdk.llm import Message\n"
        f"llm = oh_config.to_llm({str(REAL_HOME)!r}, usage_id='rsi-oh-config-test', timeout=60)\n"
        "r = llm.completion(messages=[Message(role='user', "
        "content=[{'type': 'text', 'text': 'reply with exactly: PONG'}])])\n"
        "u = r.metrics.accumulated_token_usage\n"
        "print(json.dumps({'model': llm.model, 'text': r.message.content[0].text, "
        "'prompt': u.prompt_tokens, 'completion': u.completion_tokens}))\n"
    )
    import subprocess

    done = subprocess.run(
        [str(VENV_PYTHON), "-c", script],
        capture_output=True,
        text=True,
        timeout=180,
        env={**os.environ, "OPENHANDS_SUPPRESS_BANNER": "1"},
    )
    assert done.returncode == 0, done.stderr[-2000:]
    answer = json.loads(done.stdout.strip().splitlines()[-1])
    assert answer["text"].strip() == "PONG"
    assert answer["prompt"] > 0 and answer["completion"] > 0
    assert answer["model"].startswith(oh_config.OPENAI_PREFIX)
