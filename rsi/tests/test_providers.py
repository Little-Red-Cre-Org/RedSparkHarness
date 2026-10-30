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

"""Provider settings are a file, so most of this tests the file.

The interesting cases are the ones a hand-edited config already contains: a
comment on the line being changed, another provider next to the one being
changed, a sub-table that shares the key name, and an `http_headers` table that
must survive a base URL edit untouched. The routes are tested for what they do
not send as much as for what they change: no route may answer with a key.
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

from harness2.substrate.opencode import OPENCODE_SURFACE
from rsi import providers
from rsi.server import serve
from rsi.store import open_store

SURF = OPENCODE_SURFACE

CONFIG = """\
# hand-written, keep the comments
model_provider = "alpha"
model = "alpha/one"

unrelated = 1

[model_providers.alpha]
name = "Alpha"
base_url = "https://alpha.test/v1"   # trailing note
wire_api = "responses"
experimental_bearer_token = "sk-alpha"
http_headers = { "x-openai-actor-authorization" = "magpie", "x-b" = "2" }

[model_providers.beta]
name = "Beta"
base_url = "https://beta.test/v1"
wire_api = "chat"

[model_providers.alpha.env]
base_url = "must-not-touch"
"""


# Temporary directories are freed when the object is collected, and the
# returned path would not keep it alive: the home has to outlive the call.
_HELD: list = []


def home_with(text: str = CONFIG) -> Path:
    """A temporary engine home holding one config file."""
    tmp = tempfile.TemporaryDirectory()
    _HELD.append(tmp)
    path = Path(tmp.name) / "engine-home"
    path.mkdir()
    (path / "config.toml").write_text(text, encoding="utf-8", newline="")
    return path


class ReadTests(unittest.TestCase):
    def test_every_block_is_listed_in_file_order(self):
        found = providers.read_providers(home_with())
        self.assertEqual([p.id for p in found], ["alpha", "beta"])

    def test_the_active_block_is_the_one_the_file_names(self):
        found = providers.read_providers(home_with())
        self.assertTrue(found[0].active)
        self.assertFalse(found[1].active)

    def test_a_block_without_a_token_has_no_key(self):
        found = providers.read_providers(home_with())
        self.assertTrue(found[0].has_key)
        self.assertFalse(found[1].has_key)

    def test_env_key_counts_as_a_key(self):
        """The engine accepts a token from the environment instead of the file."""
        text = CONFIG.replace('experimental_bearer_token = "sk-alpha"', 'env_key = "ALPHA_KEY"')
        self.assertTrue(providers.read_providers(home_with(text))[0].has_key)

    def test_describe_carries_no_credential(self):
        described = providers.read_providers(home_with())[0].describe()
        self.assertNotIn("sk-alpha", json.dumps(described))
        self.assertEqual(described["has_key"], True)

    def test_a_missing_config_is_no_providers(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(providers.read_providers(Path(tmp)), [])

    def test_a_broken_config_is_no_providers(self):
        """The engine refuses to start on this file; the page still has to draw."""
        self.assertEqual(providers.read_providers(home_with("not [ toml")), [])


class KeySourceTests(unittest.TestCase):
    """Which credential a run would use, separately from whether one exists.

    The window has to be able to say "you set env_key, but the literal token is
    covering it" and "the variable you named is not visible to this process";
    `has_key` alone cannot tell those apart from a working key.
    """

    def _described(self, home: Path) -> dict:
        return providers.read_providers(home)[0].describe()

    def test_a_literal_token_is_the_source(self):
        described = self._described(home_with())
        self.assertEqual(described["key_source"], "token")
        self.assertTrue(described["has_key"])

    def test_a_variable_that_is_set_is_the_source(self):
        text = CONFIG.replace('experimental_bearer_token = "sk-alpha"', 'env_key = "ALPHA_KEY"')
        with mock.patch.dict(os.environ, {"ALPHA_KEY": "sk-from-env"}):
            described = self._described(home_with(text))
        self.assertEqual(described["key_source"], "env_key")
        self.assertTrue(described["has_key"])

    def test_a_variable_that_is_not_set_is_still_configured_but_unusable(self):
        text = CONFIG.replace(
            'experimental_bearer_token = "sk-alpha"', 'env_key = "MISSING_KEY_XYZ"'
        )
        with mock.patch.dict(os.environ, {}, clear=True):
            described = self._described(home_with(text))
        self.assertEqual(described["key_source"], "env_key_unset")
        # Configured, so the page draws a filled key box, and says what will
        # actually reach the engine through `key_source`.
        self.assertTrue(described["has_key"])

    def test_a_variable_with_an_empty_value_is_the_same_as_missing(self):
        """The engine checks `if value and value.strip()`, so empty is no value."""
        text = CONFIG.replace('experimental_bearer_token = "sk-alpha"', 'env_key = "EMPTY_KEY"')
        with mock.patch.dict(os.environ, {"EMPTY_KEY": "   "}):
            described = self._described(home_with(text))
        self.assertEqual(described["key_source"], "env_key_unset")

    def test_no_credential_at_all_is_null(self):
        described = self._described(home_with())
        beta = providers.read_providers(home_with())[1].describe()
        self.assertEqual(beta["key_source"], None)
        self.assertFalse(beta["has_key"])
        self.assertEqual(described["id"], "alpha")

    def test_the_literal_token_wins_when_a_block_holds_both(self):
        """The engine reads the token first and never looks at the variable.

        Reporting `env_key` here would describe a credential the engine does not
        use, and the page would show the wrong one as in effect.
        """
        text = CONFIG.replace(
            'experimental_bearer_token = "sk-alpha"',
            'experimental_bearer_token = "sk-alpha"\nenv_key = "ALPHA_KEY"',
        )
        with mock.patch.dict(os.environ, {"ALPHA_KEY": "sk-from-env"}):
            described = self._described(home_with(text))
        self.assertEqual(described["key_source"], "token")


class WriteTests(unittest.TestCase):
    def test_only_the_changed_line_differs(self):
        home = home_with()
        before = (home / "config.toml").read_text(encoding="utf-8").splitlines(keepends=True)
        providers.update_provider_value(home, "alpha", "base_url", "https://new.test/v1")
        after = (home / "config.toml").read_text(encoding="utf-8").splitlines(keepends=True)
        self.assertEqual(len(before), len(after))
        differing = [i for i, (a, b) in enumerate(zip(before, after)) if a != b]
        self.assertEqual(len(differing), 1)
        self.assertIn("https://new.test/v1", after[differing[0]])

    def test_a_trailing_comment_survives(self):
        home = home_with()
        providers.update_provider_value(home, "alpha", "base_url", "https://new.test/v1")
        text = (home / "config.toml").read_text(encoding="utf-8")
        self.assertIn('base_url = "https://new.test/v1"   # trailing note', text)

    def test_the_headers_table_is_untouched(self):
        home = home_with()
        providers.update_provider_value(home, "alpha", "base_url", "https://new.test/v1")
        text = (home / "config.toml").read_text(encoding="utf-8")
        self.assertIn(
            'http_headers = { "x-openai-actor-authorization" = "magpie", "x-b" = "2" }', text
        )

    def test_the_neighbouring_provider_is_untouched(self):
        home = home_with()
        providers.update_provider_value(home, "alpha", "base_url", "https://new.test/v1")
        text = (home / "config.toml").read_text(encoding="utf-8")
        self.assertIn('base_url = "https://beta.test/v1"', text)

    def test_a_sub_table_with_the_same_key_is_not_edited(self):
        """`[model_providers.alpha.env]` also has a base_url line, and it is not ours."""
        home = home_with()
        providers.update_provider_value(home, "alpha", "base_url", "https://new.test/v1")
        text = (home / "config.toml").read_text(encoding="utf-8")
        self.assertIn('base_url = "must-not-touch"', text)

    def test_the_key_alias_writes_the_engine_spelling(self):
        home = home_with()
        providers.update_provider_value(home, "alpha", "api_key", "sk-new")
        text = (home / "config.toml").read_text(encoding="utf-8")
        self.assertIn('experimental_bearer_token = "sk-new"', text)

    def test_a_second_identical_write_reports_no_change(self):
        home = home_with()
        self.assertTrue(providers.update_provider_value(home, "beta", "wire_api", "responses"))
        self.assertFalse(providers.update_provider_value(home, "beta", "wire_api", "responses"))

    def test_no_temporary_file_is_left_behind(self):
        home = home_with()
        providers.update_provider_value(home, "beta", "wire_api", "responses")
        self.assertEqual([p.name for p in home.iterdir()], ["config.toml"])

    def test_an_unwritable_value_leaves_the_file_alone(self):
        home = home_with()
        before = (home / "config.toml").read_bytes()
        with self.assertRaises(providers.ProviderError):
            providers.update_provider_value(home, "alpha", "base_url", "ftp://nope.test")
        self.assertEqual((home / "config.toml").read_bytes(), before)


class RefusalTests(unittest.TestCase):
    def _refused(self, *args) -> providers.ProviderError:
        home = home_with()
        with self.assertRaises(providers.ProviderError) as caught:
            providers.update_provider_value(home, *args)
        return caught.exception

    def test_the_headers_table_is_not_writable_from_here(self):
        exc = self._refused("alpha", "http_headers", "x")
        self.assertEqual(exc.status, 400)
        self.assertIn("cannot change http_headers", str(exc))

    def test_the_label_is_not_writable_from_here(self):
        self.assertEqual(self._refused("alpha", "name", "x").status, 400)

    def test_a_base_url_must_be_http(self):
        self.assertEqual(self._refused("alpha", "base_url", "ftp://x.test").status, 400)

    def test_a_blank_value_is_refused_rather_than_clearing_the_line(self):
        self.assertEqual(self._refused("alpha", "base_url", "   ").status, 400)

    def test_a_wire_api_must_be_one_the_engine_speaks(self):
        self.assertEqual(self._refused("alpha", "wire_api", "sse").status, 400)

    def test_a_multi_line_value_is_refused(self):
        self.assertEqual(self._refused("alpha", "wire_api", "responses\nx = 1").status, 400)

    def test_an_unknown_provider_is_a_404(self):
        self.assertEqual(self._refused("gamma", "base_url", "https://x.test").status, 404)

    def test_an_unknown_provider_says_it_is_missing_not_that_a_line_is(self):
        # "has no base_url line" would send the reader looking for a key inside
        # a block that was never declared; only an existing block can miss a key.
        with self.assertRaises(providers.ProviderError) as caught:
            providers.update_provider_value(home_with(), "gamma", "base_url", "https://x.test")
        self.assertIn("gamma is not in", str(caught.exception))

    def test_an_existing_provider_without_that_key_gains_the_line(self):
        # beta exists and has a base_url, but never declares a token: the write
        # adds that one line inside beta's own block rather than refusing.
        home = home_with()
        providers.update_provider_value(home, "beta", "api_key", "sk-beta")
        text = (home / "config.toml").read_text(encoding="utf-8")
        beta = text.split("[model_providers.beta]")[1].split("[model_providers.alpha.env]")[0]
        self.assertIn('experimental_bearer_token = "sk-beta"', beta)

    def test_a_missing_config_is_a_409(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(providers.ProviderError) as caught:
                providers.update_provider_value(Path(tmp), "alpha", "base_url", "https://x.test")
            self.assertEqual(caught.exception.status, 409)


class EnvKeyTests(unittest.TestCase):
    """`env_key` is a variable name, and the safer of the two credentials.

    It is writable because it is the only one of the writable fields that can
    take a secret out of the file: a provider that names a variable keeps no
    literal on disk.
    """

    def test_switching_to_env_key_adds_the_line_and_keeps_the_token(self):
        """The switch users asked for: add `env_key` inside the block.

        The literal token line stays where it was. Deleting it would make this
        module edit a line nobody named, and it is the engine -- not this writer
        -- that decides which credential wins.
        """
        home = home_with()
        changed = providers.update_provider_values(home, "alpha", {"env_key": "ALPHA_KEY"})
        self.assertEqual(changed, ["env_key"])
        text = (home / "config.toml").read_text(encoding="utf-8")
        self.assertIn('experimental_bearer_token = "sk-alpha"', text)
        self.assertIn('env_key = "ALPHA_KEY"', text)

    def test_env_key_is_written_when_the_line_exists(self):
        text = CONFIG.replace(
            'experimental_bearer_token = "sk-alpha"', 'env_key = "OLD_NAME"   # keep me'
        )
        home = home_with(text)
        changed = providers.update_provider_values(home, "alpha", {"env_key": "NEW_NAME"})
        self.assertEqual(changed, ["env_key"])
        written = (home / "config.toml").read_text(encoding="utf-8")
        self.assertIn('env_key = "NEW_NAME"   # keep me', written)

    def test_a_name_that_is_not_a_variable_is_refused(self):
        text = CONFIG.replace('experimental_bearer_token = "sk-alpha"', 'env_key = "OLD_NAME"')
        home = home_with(text)
        before = (home / "config.toml").read_bytes()
        for bad in ["my key", "1ABC", "A-B", "has$dollar", 'quote"d']:
            with self.subTest(bad=bad):
                with self.assertRaises(providers.ProviderError) as caught:
                    providers.update_provider_values(home, "alpha", {"env_key": bad})
                self.assertEqual(caught.exception.status, 400)
                self.assertIn("environment variable name", str(caught.exception))
        self.assertEqual((home / "config.toml").read_bytes(), before)

    def test_both_credentials_at_once_is_refused_before_the_file_is_opened(self):
        """The engine reads the token first, so both at once silently ignores
        `env_key`. There is no way to tell which one the caller meant."""
        text = CONFIG.replace(
            'experimental_bearer_token = "sk-alpha"',
            'experimental_bearer_token = "sk-alpha"\nenv_key = "OLD_NAME"',
        )
        home = home_with(text)
        before = (home / "config.toml").read_bytes()
        with self.assertRaises(providers.ProviderError) as caught:
            providers.update_provider_values(
                home, "alpha", {"api_key": "sk-new", "env_key": "NEW_NAME"}
            )
        self.assertEqual(caught.exception.status, 400)
        self.assertIn("either experimental_bearer_token or env_key, not both", str(caught.exception))
        self.assertEqual((home / "config.toml").read_bytes(), before)

    def test_one_credential_alone_does_not_disturb_the_other(self):
        """Changing the token leaves an existing `env_key` line where it was.

        Deleting it would make this module, whose whole promise is "only the
        target line changes", the one place that edits a line nobody named.
        """
        text = CONFIG.replace(
            'experimental_bearer_token = "sk-alpha"',
            'experimental_bearer_token = "sk-alpha"\nenv_key = "OLD_NAME"',
        )
        home = home_with(text)
        providers.update_provider_values(home, "alpha", {"api_key": "sk-new"})
        written = (home / "config.toml").read_text(encoding="utf-8")
        self.assertIn('experimental_bearer_token = "sk-new"', written)
        self.assertIn('env_key = "OLD_NAME"', written)

    def test_env_key_is_writable_through_the_route(self):
        text = CONFIG.replace('experimental_bearer_token = "sk-alpha"', 'env_key = "OLD_NAME"')
        home = home_with(text)
        base, _app, cleanup = _serve(home)
        self.addCleanup(cleanup)
        status, body = call(
            base, "/settings/providers/alpha", method="PATCH", payload={"env_key": "ROUTE_KEY"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["changed"], ["env_key"])
        self.assertEqual(body["provider"]["key_source"], "env_key_unset")

    def test_the_route_refuses_both_credentials(self):
        text = CONFIG.replace(
            'experimental_bearer_token = "sk-alpha"',
            'experimental_bearer_token = "sk-alpha"\nenv_key = "OLD_NAME"',
        )
        home = home_with(text)
        before = (home / "config.toml").read_bytes()
        base, _app, cleanup = _serve(home)
        self.addCleanup(cleanup)
        status, body = call(
            base,
            "/settings/providers/alpha",
            method="PATCH",
            payload={"api_key": "sk-new", "env_key": "NEW"},
        )
        self.assertEqual(status, 400)
        self.assertIn("not both", body["error"])
        self.assertEqual((home / "config.toml").read_bytes(), before)


class InsertTests(unittest.TestCase):
    """A key the block does not declare yet becomes one new line inside it.

    Adding a line is where a careless writer lands a key in a neighbouring
    section, or gains a line ending the rest of the file does not use.
    """

    def test_the_new_line_goes_after_the_blocks_last_non_blank_line(self):
        text = (
            'model_provider = "alpha"\n'
            "\n"
            "[model_providers.alpha]\n"
            'base_url = "https://alpha.test/v1"\n'
            'wire_api = "responses"\n'
            "\n"
            "[model_providers.beta]\n"
            'base_url = "https://beta.test/v1"\n'
        )
        home = home_with(text)
        providers.update_provider_values(home, "alpha", {"env_key": "ALPHA_KEY"})
        written = (home / "config.toml").read_text(encoding="utf-8")
        # Not after the blank line: that would sit next to beta's header, and
        # the key would read as part of the wrong block.
        self.assertIn(
            'wire_api = "responses"\nenv_key = "ALPHA_KEY"\n\n[model_providers.beta]', written
        )

    def test_the_last_block_gains_the_line_at_the_end(self):
        text = (
            'model_provider = "alpha"\n'
            "\n"
            "[model_providers.alpha]\n"
            'base_url = "https://alpha.test/v1"\n'
        )
        home = home_with(text)
        providers.update_provider_values(home, "alpha", {"env_key": "ALPHA_KEY"})
        written = (home / "config.toml").read_text(encoding="utf-8")
        self.assertTrue(written.endswith('base_url = "https://alpha.test/v1"\nenv_key = "ALPHA_KEY"\n'))

    def test_the_indent_follows_the_block(self):
        text = (
            'model_provider = "alpha"\n'
            "\n"
            "[model_providers.alpha]\n"
            '    base_url = "https://alpha.test/v1"\n'
            '    wire_api = "responses"\n'
        )
        home = home_with(text)
        providers.update_provider_values(home, "alpha", {"env_key": "ALPHA_KEY"})
        written = (home / "config.toml").read_text(encoding="utf-8")
        self.assertIn('    env_key = "ALPHA_KEY"', written)

    def test_a_crlf_file_gains_a_crlf_line(self):
        text = (
            'model_provider = "alpha"\r\n'
            "\r\n"
            "[model_providers.alpha]\r\n"
            'base_url = "https://alpha.test/v1"\r\n'
        )
        home = home_with(text)
        providers.update_provider_values(home, "alpha", {"env_key": "ALPHA_KEY"})
        raw = (home / "config.toml").read_bytes()
        self.assertIn(b'env_key = "ALPHA_KEY"\r\n', raw)
        self.assertNotIn(b'env_key = "ALPHA_KEY"\n', raw.replace(b'env_key = "ALPHA_KEY"\r\n', b""))

    def test_a_sub_table_does_not_borrow_the_new_line(self):
        text = (
            'model_provider = "alpha"\n'
            "\n"
            "[model_providers.alpha]\n"
            'base_url = "https://alpha.test/v1"\n'
            "\n"
            "[model_providers.alpha.env]\n"
            'base_url = "must-not-touch"\n'
        )
        home = home_with(text)
        providers.update_provider_values(home, "alpha", {"env_key": "ALPHA_KEY"})
        written = (home / "config.toml").read_text(encoding="utf-8")
        self.assertIn('[model_providers.alpha.env]\nbase_url = "must-not-touch"', written)
        self.assertIn('base_url = "https://alpha.test/v1"\nenv_key = "ALPHA_KEY"\n', written)

    def test_a_missing_block_is_not_created(self):
        """Adding a line to a block that is not there is a different operation."""
        home = home_with()
        before = (home / "config.toml").read_bytes()
        with self.assertRaises(providers.ProviderError) as caught:
            providers.update_provider_values(home, "gamma", {"env_key": "GAMMA_KEY"})
        self.assertEqual(caught.exception.status, 404)
        self.assertIn("gamma is not in", str(caught.exception))
        self.assertEqual((home / "config.toml").read_bytes(), before)

    def test_replacing_and_adding_land_in_one_write(self):
        # The edit is one file replacement for the whole request, so the two
        # fields cannot arrive separately.
        home = home_with()
        changed = providers.update_provider_values(
            home, "beta", {"base_url": "https://new.test/v1", "env_key": "BETA_KEY"}
        )
        self.assertEqual(changed, ["base_url", "env_key"])
        written = (home / "config.toml").read_text(encoding="utf-8")
        self.assertIn('base_url = "https://new.test/v1"', written)
        self.assertIn('env_key = "BETA_KEY"', written)

    def test_one_write_and_no_temporary_file(self):
        home = home_with()
        with mock.patch.object(providers.os, "replace", wraps=providers.os.replace) as replaced:
            providers.update_provider_values(
                home, "beta", {"base_url": "https://new.test/v1", "env_key": "BETA_KEY"}
            )
        self.assertEqual(replaced.call_count, 1)
        self.assertEqual([p.name for p in home.iterdir()], ["config.toml"])

    def test_key_source_after_the_switch(self):
        """Adding env_key next to a literal token leaves the token in charge.

        The engine reads the literal first, so `key_source` reports `token`; the
        window shows the credential that would actually be used.
        """
        home = home_with()
        described = providers.read_providers(home)[0].describe()
        self.assertEqual(described["key_source"], "token")
        providers.update_provider_values(home, "alpha", {"env_key": "ALPHA_KEY"})
        after = providers.read_providers(home)[0].describe()
        self.assertEqual(after["key_source"], "token")
        self.assertIn("ALPHA_KEY", (home / "config.toml").read_text(encoding="utf-8"))

    def test_a_blank_line_at_the_block_end_does_not_swallow_the_insert(self):
        text = (
            'model_provider = "alpha"\n'
            "\n"
            "[model_providers.alpha]\n"
            'base_url = "https://alpha.test/v1"\n'
            "\n"
            "\n"
        )
        home = home_with(text)
        providers.update_provider_values(home, "alpha", {"env_key": "ALPHA_KEY"})
        written = (home / "config.toml").read_text(encoding="utf-8")
        self.assertIn('base_url = "https://alpha.test/v1"\nenv_key = "ALPHA_KEY"\n\n\n', written)


def _serve(home: Path):
    """Serve a store in a temporary directory, editing the given engine home.

    The store and the engine home are separate here on purpose: the route would
    otherwise derive the home from the store, and these tests have to watch the
    file they wrote.
    """
    tmp = tempfile.TemporaryDirectory()
    store_root = Path(tmp.name) / "store"
    open_store(store_root, SURF).init(tree={"systemprompt.md": "hello\n"})
    httpd, app, _ = serve(store_root, SURF, home=home)

    def cleanup() -> None:
        app.events.close()
        httpd.shutdown()
        httpd.server_close()
        tmp.cleanup()

    return f"http://127.0.0.1:{httpd.server_address[1]}", app, cleanup


def call(base: str, path: str, *, method: str = "GET", payload: dict | None = None):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


class RouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.home = home_with()
        self.base, self.app, cleanup = _serve(self.home)
        self.addCleanup(cleanup)

    def test_reading_the_providers(self):
        status, body = call(self.base, "/settings/providers")
        self.assertEqual(status, 200)
        self.assertEqual([p["id"] for p in body["providers"]], ["alpha", "beta"])

    def test_reading_never_sends_the_key(self):
        status, body = call(self.base, "/settings/providers")
        self.assertEqual(status, 200)
        self.assertNotIn("sk-alpha", json.dumps(body))

    def test_patching_one_field(self):
        status, body = call(
            self.base,
            "/settings/providers/alpha",
            method="PATCH",
            payload={"base_url": "https://patched.test/v1"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["provider"]["base_url"], "https://patched.test/v1")
        text = (self.home / "config.toml").read_text(encoding="utf-8")
        self.assertIn('base_url = "https://patched.test/v1"', text)

    def test_a_blank_key_leaves_the_stored_one_alone(self):
        """The window sends the box back empty when the user did not type in it."""
        status, body = call(
            self.base,
            "/settings/providers/alpha",
            method="PATCH",
            payload={"base_url": "https://patched.test/v1", "api_key": ""},
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["provider"]["has_key"])
        text = (self.home / "config.toml").read_text(encoding="utf-8")
        self.assertIn('experimental_bearer_token = "sk-alpha"', text)

    def test_a_refused_field_answers_its_own_status(self):
        status, body = call(
            self.base,
            "/settings/providers/alpha",
            method="PATCH",
            payload={"base_url": "ftp://nope.test"},
        )
        self.assertEqual(status, 400)
        self.assertIn("http", body["error"])

    def test_an_unknown_provider_is_a_404(self):
        status, _body = call(
            self.base, "/settings/providers/gamma", method="PATCH", payload={"wire_api": "chat"}
        )
        self.assertEqual(status, 404)

    def test_an_unwritable_key_is_a_400(self):
        status, body = call(
            self.base,
            "/settings/providers/alpha",
            method="PATCH",
            payload={"http_headers": "x"},
        )
        self.assertEqual(status, 400)
        self.assertIn("writable keys", body["error"])

    def test_an_empty_body_is_a_400(self):
        status, _body = call(self.base, "/settings/providers/alpha", method="PATCH", payload={})
        self.assertEqual(status, 400)

    def test_a_rejected_second_field_leaves_the_first_unwritten(self):
        """A request is one edit: a bad field must not land the good one beside it."""
        before = (self.home / "config.toml").read_bytes()
        status, body = call(
            self.base,
            "/settings/providers/alpha",
            method="PATCH",
            payload={"base_url": "https://ok.test/v1", "wire_api": "sse"},
        )
        self.assertEqual(status, 400)
        self.assertIn("chat", body["error"])
        self.assertEqual((self.home / "config.toml").read_bytes(), before)

    def test_both_fields_are_written_when_both_are_valid(self):
        status, body = call(
            self.base,
            "/settings/providers/alpha",
            method="PATCH",
            payload={"base_url": "https://ok.test/v1", "wire_api": "chat"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["changed"], ["base_url", "wire_api"])
        text = (self.home / "config.toml").read_text(encoding="utf-8")
        self.assertIn('base_url = "https://ok.test/v1"', text)
        self.assertIn('wire_api = "chat"', text)

    def test_a_settings_write_is_not_an_event(self):
        """A subscriber watching for adoptions should not wake for a base URL edit."""
        before = self.app.events.last_seq
        call(
            self.base,
            "/settings/providers/alpha",
            method="PATCH",
            payload={"wire_api": "chat"},
        )
        self.assertEqual(self.app.events.last_seq, before)


if __name__ == "__main__":
    unittest.main()
