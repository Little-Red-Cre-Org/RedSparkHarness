"""What the private RPC surface answers, and why each answer is that shape.

Every reply here is consumed by goose's renderer through a zod schema, and a
missing required field does not raise anything visible: the client's parse
rejects the body and the screen falls back to onboarding. That failure mode is
silent, so each reply's required fields are asserted by name rather than by
"the call returned something".

The config these tests read is a real `config.toml` written to a temporary
directory, not a stub of the reader: the point of this module is that what it
says matches what the executor would use, and a fake reader would not prove it.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from rsi import providers
from rsi.goose_rpc import EMPTY_LISTS, GooseSurface


def _config(home: Path, text: str) -> Path:
    """Write a `config.toml` into `home` and return the home."""
    (home / "config.toml").write_text(text, encoding="utf-8")
    return home


_ONE_PROVIDER = """
model_provider = "magpie"
model = "workbuddy/deepseek-v4.1-flash"

[model_providers.magpie]
name = "magpie"
base_url = "http://127.0.0.1:3425/v1"
wire_api = "responses"
experimental_bearer_token = "magpie"
"""


class DefaultsTests(unittest.TestCase):
    """The one call that decides chat or onboarding."""

    def test_a_configured_provider_is_named(self) -> None:
        """A non-empty providerId is what turns the setup page into a chat."""
        with tempfile.TemporaryDirectory() as folder:
            surface = GooseSurface(home=_config(Path(folder), _ONE_PROVIDER))
            self.assertEqual(
                surface.defaults(),
                {"providerId": "magpie", "modelId": "workbuddy/deepseek-v4.1-flash"},
            )

    def test_no_config_says_so_with_nulls_not_empty_strings(self) -> None:
        """The schema is `String.nullish()`, so "" would be a value, not absence."""
        with tempfile.TemporaryDirectory() as folder:
            surface = GooseSurface(home=Path(folder))
            self.assertEqual(surface.defaults(), {"providerId": None, "modelId": None})

    def test_a_config_that_does_not_parse_is_the_same_as_no_config(self) -> None:
        """Half a TOML file must not crash the window that asks every 2 seconds."""
        with tempfile.TemporaryDirectory() as folder:
            surface = GooseSurface(home=_config(Path(folder), "model_provider = "))
            self.assertEqual(surface.defaults(), {"providerId": None, "modelId": None})


class ConfigReadTests(unittest.TestCase):
    """Single settings the settings page loads by name."""

    def test_the_provider_name_is_read_back(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            surface = GooseSurface(home=_config(Path(folder), _ONE_PROVIDER))
            self.assertEqual(
                surface.config_read({"key": "GOOSE_PROVIDER"}), {"value": "magpie"}
            )

    def test_an_unknown_key_answers_null_rather_than_failing(self) -> None:
        """The client asks about keys this backend has no opinion on."""
        with tempfile.TemporaryDirectory() as folder:
            surface = GooseSurface(home=_config(Path(folder), _ONE_PROVIDER))
            self.assertEqual(surface.config_read({"key": "GOOSE_SOMETHING"}), {"value": None})


class ReadAllTests(unittest.TestCase):
    """One round trip for the whole settings screen."""

    def test_the_aliases_the_renderer_reads_directly_are_present(self) -> None:
        """The renderer reads `config.GOOSE_PROVIDER` without going through keys."""
        with tempfile.TemporaryDirectory() as folder:
            surface = GooseSurface(home=_config(Path(folder), _ONE_PROVIDER))
            config = surface.config_read_all()["config"]
            self.assertEqual(config["GOOSE_PROVIDER"], "magpie")
            self.assertEqual(config["GOOSE_MODEL"], "workbuddy/deepseek-v4.1-flash")
            self.assertEqual(config["active_provider"], "magpie")

    def test_each_provider_block_becomes_one_entry(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            surface = GooseSurface(home=_config(Path(folder), _ONE_PROVIDER))
            config = surface.config_read_all()["config"]
            self.assertEqual(config["providers"]["magpie"]["configured"], True)
            self.assertEqual(
                config["providers"]["magpie"]["model"], "workbuddy/deepseek-v4.1-flash"
            )


class ProviderListTests(unittest.TestCase):
    """The entries the setup and settings screens draw."""

    def test_every_field_the_client_schema_requires_is_present(self) -> None:
        """A missing one makes the client reject the whole list, not one entry."""
        with tempfile.TemporaryDirectory() as folder:
            surface = GooseSurface(home=_config(Path(folder), _ONE_PROVIDER))
            entry = surface.providers_list({})["entries"][0]
            for field in ("providerId", "providerName", "description", "defaultModel",
                          "configured", "available", "providerType", "acp",
                          "visibleInSetup", "deprecated", "configKeys", "setupSteps",
                          "supportsRefresh", "models"):
                self.assertIn(field, entry)

    def test_an_unconfigured_block_is_not_drawn_as_ready(self) -> None:
        """`available` is what decides whether a run is offered at all."""
        text = """
[model_providers.magpie]
name = "magpie"
base_url = "http://127.0.0.1:3425/v1"
"""
        with tempfile.TemporaryDirectory() as folder:
            surface = GooseSurface(home=_config(Path(folder), text))
            entry = surface.providers_list({})["entries"][0]
            self.assertFalse(entry["configured"])
            self.assertFalse(entry["available"])

    def test_the_filter_the_client_sends_is_honoured(self) -> None:
        """The client asks for a subset when it refreshes one provider."""
        with tempfile.TemporaryDirectory() as folder:
            surface = GooseSurface(home=_config(Path(folder), _ONE_PROVIDER))
            entries = surface.providers_list({"providerIds": ["other"]})["entries"]
            self.assertEqual(entries, [])

    def test_only_the_active_block_carries_the_chosen_model(self) -> None:
        """A second block is listed but is not the one a run would use.

        With one block the active branch and the inactive one answer the same,
        so this needs two: it is the difference between "the picker shows the
        model in use" and "the picker shows whatever the last block said".
        """
        text = """
model_provider = "magpie"
model = "workbuddy/deepseek-v4.1-flash"

[model_providers.magpie]
name = "magpie"
base_url = "http://127.0.0.1:3425/v1"
experimental_bearer_token = "magpie"

[model_providers.other]
name = "other"
base_url = "http://127.0.0.1:9999/v1"
experimental_bearer_token = "other"
"""
        with tempfile.TemporaryDirectory() as folder:
            surface = GooseSurface(home=_config(Path(folder), text))
            entries = {entry["providerId"]: entry
                       for entry in surface.providers_list({})["entries"]}
            self.assertEqual(entries["magpie"]["defaultModel"],
                             "workbuddy/deepseek-v4.1-flash")
            self.assertEqual(entries["other"]["defaultModel"], "")

    def test_only_the_active_block_lists_models(self) -> None:
        """The catalogue belongs to the provider in use, not to every block."""
        text = """
model_provider = "magpie"
model = "workbuddy/deepseek-v4.1-flash"

[model_providers.magpie]
name = "magpie"
base_url = "http://127.0.0.1:3425/v1"
experimental_bearer_token = "magpie"

[model_providers.other]
name = "other"
base_url = "http://127.0.0.1:9999/v1"
experimental_bearer_token = "other"
"""
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "magpie-models.json").write_text(
                '{"models": [{"slug": "workbuddy/deepseek-v4.1-flash",'
                ' "display_name": "DeepSeek", "context_window": 128000}]}',
                encoding="utf-8",
            )
            surface = GooseSurface(home=_config(Path(folder), text))
            entries = {entry["providerId"]: entry
                       for entry in surface.providers_list({})["entries"]}
            self.assertGreaterEqual(len(entries["magpie"]["models"]), 1)
            self.assertEqual(entries["other"]["models"], [])


class PlaceholderTests(unittest.TestCase):
    """Screens this backend has no counterpart for."""

    def test_each_empty_list_names_the_key_the_client_reads(self) -> None:
        """Every one of these ends in `/list`; `providers` does not answer `items`."""
        with tempfile.TemporaryDirectory() as folder:
            surface = GooseSurface(home=_config(Path(folder), _ONE_PROVIDER))
            for method, key in EMPTY_LISTS.items():
                self.assertEqual(surface.answer(method, {}), {key: []}, method)

    def test_a_method_with_no_answer_raises_rather_than_inventing_one(self) -> None:
        """The transport turns this into a JSON-RPC error the client can show."""
        with tempfile.TemporaryDirectory() as folder:
            surface = GooseSurface(home=_config(Path(folder), _ONE_PROVIDER))
            with self.assertRaises(Exception) as caught:
                surface.answer("_goose/unstable/nothing/here", {})
            self.assertEqual(type(caught.exception).__name__, "_Unknown")


class SessionInfoTests(unittest.TestCase):
    """One session described for the client's session type."""

    def test_a_known_session_is_described_by_the_callback(self) -> None:
        described = {"sessionId": "rsi-0001", "cwd": "D:/tmp"}
        surface = GooseSurface(home=Path("."), session_of=lambda _id: described)
        self.assertEqual(surface.session_info({"sessionId": "rsi-0001"}), {"session": described})

    def test_an_unknown_session_raises_so_the_transport_can_say_32602(self) -> None:
        surface = GooseSurface(home=Path("."), session_of=lambda _id: None)
        with self.assertRaises(Exception) as caught:
            surface.session_info({"sessionId": "nope"})
        self.assertEqual(type(caught.exception).__name__, "_NoSession")


class ReadinessTests(unittest.TestCase):
    """Whether a run would be accepted right now."""

    def test_a_provider_with_a_token_is_ready(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            surface = GooseSurface(home=_config(Path(folder), _ONE_PROVIDER))
            self.assertEqual(
                surface.readiness({"providerId": "magpie"}),
                {"providerId": "magpie", "ready": True, "error": None},
            )

    def test_an_env_key_naming_no_variable_is_not_ready(self) -> None:
        """This is the state that fails a run with nothing on screen to explain it."""
        text = """
[model_providers.magpie]
name = "magpie"
base_url = "http://127.0.0.1:3425/v1"
env_key = "RSI_NO_SUCH_VARIABLE_SET_ANYWHERE"
"""
        with tempfile.TemporaryDirectory() as folder:
            surface = GooseSurface(home=_config(Path(folder), text))
            answer = surface.readiness({"providerId": "magpie"})
            self.assertFalse(answer["ready"])
            self.assertIn("env_key", answer["error"])

    def test_an_unknown_provider_is_reported_not_ready(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            surface = GooseSurface(home=_config(Path(folder), _ONE_PROVIDER))
            self.assertFalse(surface.readiness({"providerId": "nope"})["ready"])


class ProviderFieldTests(unittest.TestCase):
    """The editable fields of one provider, with no secret on the wire."""

    def test_the_token_is_reported_as_set_and_never_sent(self) -> None:
        """`isSet` is the whole reason the settings page can show a filled box."""
        with tempfile.TemporaryDirectory() as folder:
            surface = GooseSurface(home=_config(Path(folder), _ONE_PROVIDER))
            fields = {field["key"]: field
                      for field in surface.config_fields({"providerId": "magpie"})["fields"]}
            self.assertTrue(fields[providers.TOKEN_KEY]["isSet"])
            self.assertIsNone(fields[providers.TOKEN_KEY]["value"])
            self.assertEqual(fields["base_url"]["value"], "http://127.0.0.1:3425/v1")

    def test_an_unknown_provider_gets_no_fields(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            surface = GooseSurface(home=_config(Path(folder), _ONE_PROVIDER))
            self.assertEqual(surface.config_fields({"providerId": "nope"})["fields"], [])
