"""Keyless boot tests for the production exe and development dsh carrier.

Each carrier skips independently when absent. The dummy API key only satisfies
adapter loading; initialize and shutdown do not call a model.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from deepseek_harness import DeepSeekHarness, HarnessClient, HarnessConfig
from deepseek_harness.errors import JsonRpcError, TransportClosedError
from deepseek_harness_runtime import RUNTIME_MODE_ENV_VAR, resolve_bundled_launch_args

_MODES = ("exe", "node")


def _select_mode(mode: str, monkeypatch: pytest.MonkeyPatch) -> None:
    try:
        resolve_bundled_launch_args(mode)
    except FileNotFoundError as exc:
        pytest.skip(f"bundled {mode}-mode runtime unavailable on this machine: {exc}")
    monkeypatch.setenv(RUNTIME_MODE_ENV_VAR, mode)


def _client(
    tmp_path: Path, mode: str, monkeypatch: pytest.MonkeyPatch, *patches: Path, profile: str = "sdk"
) -> HarnessClient:
    _select_mode(mode, monkeypatch)
    return HarnessClient(
        HarnessConfig(
            dsh_home=str(tmp_path / "home"),
            profile=profile,
            patches=tuple(str(patch) for patch in patches),
            cwd=str(tmp_path),
            env={
                # The lazily mounted adapter requires a key even without a model call.
                "DEEPSEEK_API_KEY": "sk-dummy-for-boot",
                "DEEPSEEK_BASE_URL": "http://127.0.0.1:9",
                "DSH_PERMISSION_MODE": "danger-full-access",
                "DSH_TELEMETRY_DISABLED": "1",
            },
            request_timeout_seconds=120,
        )
    )


@pytest.mark.parametrize("mode", _MODES)
def test_bundled_runtime_boots_the_sdk_profile(
    tmp_path: Path, mode: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _client(tmp_path, mode, monkeypatch) as client:
        init = client.initialize(provider="deepseek-official", cwd=str(tmp_path), model="deepseek-v4-pro")

    assert init.serverInfo is not None
    assert init.serverInfo.name == "deepseek-harness-sdk-runtime"
    profile = json.loads((tmp_path / "home" / "profiles" / "sdk" / "package.json").read_text())
    assert profile["dsh"]["profile"]["runtime"] == "native"
    assert profile["dsh"]["profile"]["config"] == "rsh.profile.json"
    assert (tmp_path / "home" / "profiles" / "sdk" / "rsh.profile.json").is_file()


@pytest.mark.parametrize("mode", _MODES)
def test_python_sdk_applies_an_ordered_profile_patch(
    tmp_path: Path, mode: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    _select_mode(mode, monkeypatch)
    patch = tmp_path / "persona.patch.json"
    patch.write_text(json.dumps({"formatVersion": 1, "installations": [{
        "id": "app",
        "config": {"systemPrompt": "Python SDK ordered patch marker."},
    }]}))
    harness = DeepSeekHarness(
        model="deepseek-v4-pro",
        cwd=str(tmp_path),
        dsh_home=str(tmp_path / "home"),
        patches=(str(patch),),
        env={"DSH_PERMISSION_MODE": "danger-full-access"},
        api_key="sk-dummy-for-boot",
        base_url="http://127.0.0.1:9",
        request_timeout_seconds=120,
    )

    with harness:
        pass


@pytest.mark.parametrize("mode", _MODES)
def test_bundled_runtime_surfaces_unbundled_plugin_failure(
    tmp_path: Path, mode: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    home = tmp_path / "home"
    profile_dir = home / "profiles" / "legacy-sdk"
    profile_dir.mkdir(parents=True)
    (profile_dir / "package.json").write_text(json.dumps({
        "name": "dsh-profile-legacy-sdk",
        "private": True,
        "dsh": {"profile": {"runtime": "legacy", "bundles": [
            "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-sdk-app",
        ]}},
    }))
    (profile_dir / "cordis.patch.yml").write_text("[]\n")
    patch = tmp_path / "missing.patch.yml"
    patch.write_text(json.dumps([{
        "insert": [{"id": "missing", "name": "@deepseek-ai/dsh-does-not-exist"}],
    }]))

    client = _client(tmp_path, mode, monkeypatch, patch, profile="legacy-sdk")
    client.start()
    try:
        with pytest.raises((JsonRpcError, TransportClosedError, TimeoutError)) as excinfo:
            client.initialize(provider="deepseek-official", cwd=str(tmp_path), model="deepseek-v4-pro")
    finally:
        client.close()

    assert "@deepseek-ai/dsh-does-not-exist" in str(excinfo.value)
