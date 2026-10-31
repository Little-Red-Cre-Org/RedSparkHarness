"""The private `_goose/unstable/*` RPC surface, answered from this engine's config.

goose's renderer is not an ACP client in the narrow sense: the conversation runs
over ACP, but everything that decides whether the window draws a chat or the
"connect a provider" page runs over these private methods. The name of each one
and the exact fields its reply must carry were read out of the renderer bundle
(`index-DiGMqr9P.js`) rather than guessed -- a reply that is missing one required
field is rejected by the client's own schema parser, and the screen it was
supposed to fill falls back to onboarding with no error shown.

Two rules shape everything here:

* Report what `config.toml` really says. `defaults/read`, `config/read` and
  `providers/list` all speak from the same file the executor reads, so a model
  shown in the picker is the model a run would use.
* Nothing is invented for a screen this backend does not implement. Recipes,
  apps, schedules, local inference and dictation have no counterpart here, and
  each answers an empty list rather than a shape that would draw controls
  wired to nothing.

The seam is `answer(method, params, session)`; `AcpServer` owns the transport and
the sessions, this module owns only what the replies say.
"""

from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any, Callable

from . import models, providers

__all__ = ["GooseSurface", "EMPTY_LISTS"]

#: Methods whose reply is a list this backend genuinely has none of. Answering
#: an empty list is true here; answering a made-up entry would draw a control
#: whose action goes nowhere.
EMPTY_LISTS = {
    "_goose/unstable/apps/list": "apps",
    "_goose/unstable/recipes/list": "recipes",
    "_goose/unstable/schedules/list": "jobs",
    "_goose/unstable/sources/list": "sources",
    "_goose/unstable/tools/list": "tools",
    "_goose/unstable/slash-commands/list": "availableCommands",
    "_goose/unstable/config/extensions/list": "extensions",
    "_goose/unstable/agent-mentions/list": "agents",
    "_goose/unstable/config/prompts/list": "prompts",
    "_goose/unstable/session/extensions/list": "extensions",
    "_goose/unstable/providers/secrets/list": "secrets",
    "_goose/unstable/providers/catalog/list": "providers",
    "_goose/unstable/providers/setup/catalog/list": "providers",
    "_goose/unstable/local-inference/models/list": "models",
    "_goose/unstable/dictation/models/list": "models",
}


class GooseSurface:
    """Answers goose's private methods from this engine's own configuration.

    Args:
        home: The engine home whose `config.toml` and model catalogue are read.
        session_of: How to describe one session the transport knows about.
            Passed in rather than stored because sessions live on the server.
    """

    def __init__(
        self,
        *,
        home: Path | str,
        session_of: Callable[[str], dict[str, Any] | None] | None = None,
    ) -> None:
        self.home = Path(home)
        self._session_of = session_of

    # -- what the window needs to draw a chat instead of onboarding --------

    def defaults(self) -> dict[str, Any]:
        """The provider and model a new chat starts on.

        This one call is the onboarding gate: the client reads it, and a
        non-empty `providerId` is what turns the setup page into the chat.
        """
        config = self._config()
        provider = _text(config.get(providers.ACTIVE_KEY))
        model = _text(config.get("model"))
        return {"providerId": provider or None, "modelId": model or None}

    def config_read(self, params: dict[str, Any]) -> dict[str, Any]:
        """One setting by name, in the shape the settings page parses."""
        key = _text(params.get("key"))
        config = self._config()
        value: Any = None
        if key == "GOOSE_PROVIDER":
            value = _text(config.get(providers.ACTIVE_KEY)) or None
        elif key == "GOOSE_MODEL":
            value = _text(config.get("model")) or None
        elif key == "GOOSE_TELEMETRY_ENABLED":
            value = False
        return {"value": value}

    def config_read_all(self) -> dict[str, Any]:
        """Every setting the client asks for in one round trip.

        The shape follows what a real goosed returns: an active provider name,
        the `GOOSE_*` aliases the renderer reads directly, and a per-provider
        map. Extensions are empty because this backend has none to enable.
        """
        config = self._config()
        active = _text(config.get(providers.ACTIVE_KEY))
        model = _text(config.get("model"))
        configured: dict[str, Any] = {}
        for entry in providers.read_providers(self.home):
            configured[entry.id] = {
                "enabled": True,
                "model": model if entry.id == active else "",
                "configured": entry.key_source in ("token", "env_key"),
            }
        return {
            "config": {
                "active_provider": active,
                "extensions": {},
                "GOOSE_TELEMETRY_ENABLED": False,
                "GOOSE_PROVIDER": active,
                "GOOSE_MODEL": model,
                "providers": configured,
            }
        }

    # -- the provider list the setup and settings screens draw -------------

    def providers_list(self, params: dict[str, Any]) -> dict[str, Any]:
        """One entry per configured provider, with the models it serves."""
        wanted = params.get("providerIds")
        only = {str(item) for item in wanted} if isinstance(wanted, list) else None
        config = self._config()
        active = _text(config.get(providers.ACTIVE_KEY))
        chosen = _text(config.get("model"))
        catalogue = models.catalog(self.home)

        entries: list[dict[str, Any]] = []
        for provider in providers.read_providers(self.home):
            if only is not None and provider.id not in only:
                continue
            is_active = provider.id == active
            entries.append(
                {
                    "providerId": provider.id,
                    "providerName": provider.label or provider.id,
                    "description": provider.base_url,
                    "defaultModel": chosen if is_active else "",
                    "configured": provider.key_source in ("token", "env_key"),
                    # A block with no usable credential is drawn as needing
                    # setup, which is exactly what a run would find.
                    "available": bool(provider.base_url)
                    and provider.key_source in ("token", "env_key"),
                    "providerType": "Declarative",
                    "acp": False,
                    "visibleInSetup": True,
                    "deprecated": False,
                    "replacement": None,
                    "configKeys": [
                        {
                            "name": providers.ENV_KEY,
                            "required": True,
                            "secret": False,
                            "default": None,
                            "oauthFlow": False,
                            "deviceCodeFlow": False,
                            "primary": True,
                        }
                    ],
                    "setupSteps": [],
                    "supportsRefresh": False,
                    "refreshing": False,
                    "models": [
                        {
                            "id": entry.id,
                            "name": entry.label,
                            "family": entry.provider or None,
                            "contextLimit": entry.context_window or None,
                            "reasoning": entry.offers_reasoning,
                            "recommended": entry.id == chosen,
                        }
                        for entry in (catalogue.models if is_active else ())
                    ],
                    "lastUpdatedAt": None,
                    "lastRefreshAttemptAt": None,
                    "lastRefreshError": None,
                    "stale": False,
                }
            )
        return {"entries": entries}

    def supported_models(self, params: dict[str, Any]) -> dict[str, Any]:
        """The model ids one provider serves, for the model picker."""
        provider_id = _text(params.get("providerId"))
        config = self._config()
        if provider_id != _text(config.get(providers.ACTIVE_KEY)):
            return {"providerId": provider_id, "models": []}
        catalogue = models.catalog(self.home)
        return {"providerId": provider_id, "models": [entry.id for entry in catalogue.models]}

    def config_status(self) -> dict[str, Any]:
        """Whether each provider has what a run needs."""
        return {
            "statuses": [
                {
                    "providerId": entry.id,
                    "isConfigured": entry.key_source in ("token", "env_key"),
                }
                for entry in providers.read_providers(self.home)
            ]
        }

    def config_fields(self, params: dict[str, Any]) -> dict[str, Any]:
        """The editable fields of one provider, without any secret value.

        `isSet` says whether a credential is configured; the value itself is
        never sent, so the settings page can show a filled box without the
        secret crossing the wire.
        """
        provider_id = _text(params.get("providerId"))
        for entry in providers.read_providers(self.home):
            if entry.id != provider_id:
                continue
            return {
                "fields": [
                    {
                        "key": "base_url",
                        "value": entry.base_url,
                        "isSet": bool(entry.base_url),
                        "isSecret": False,
                        "required": True,
                    },
                    {
                        "key": providers.TOKEN_KEY,
                        "value": None,
                        "isSet": entry.key_source == "token",
                        "isSecret": True,
                        "required": False,
                    },
                ]
            }
        return {"fields": []}

    def readiness(self, params: dict[str, Any]) -> dict[str, Any]:
        """Whether a provider would accept a run right now."""
        provider_id = _text(params.get("providerId"))
        for entry in providers.read_providers(self.home):
            if entry.id != provider_id:
                continue
            if not entry.base_url:
                return {"providerId": provider_id, "ready": False,
                        "error": "the provider has no base_url"}
            if entry.key_source == "env_key_unset":
                return {"providerId": provider_id, "ready": False,
                        "error": "the environment variable named by env_key is not set"}
            if entry.key_source is None:
                return {"providerId": provider_id, "ready": False,
                        "error": "the provider has no credential"}
            return {"providerId": provider_id, "ready": True, "error": None}
        return {"providerId": provider_id, "ready": False,
                "error": "no provider block named " + provider_id}

    # -- sessions ----------------------------------------------------------

    def session_info(self, params: dict[str, Any]) -> dict[str, Any]:
        """One session, described the way the client's session type expects."""
        session_id = _text(params.get("sessionId"))
        described = self._session_of(session_id) if self._session_of else None
        if described is None:
            raise _NoSession(session_id)
        return {"session": described}

    # -- dispatch ----------------------------------------------------------

    def answer(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        """The reply to one private method.

        Raises `_Unknown` for a method this backend has no answer for, so the
        transport can report a JSON-RPC error instead of a body the client's
        parser would reject.
        """
        if method == "_goose/unstable/defaults/read":
            return self.defaults()
        if method == "_goose/unstable/config/read":
            return self.config_read(params)
        if method == "_goose/unstable/config/read-all":
            return self.config_read_all()
        if method == "_goose/unstable/providers/list":
            return self.providers_list(params)
        if method == "_goose/unstable/providers/supported-models/list":
            return self.supported_models(params)
        if method == "_goose/unstable/providers/config/status":
            return self.config_status()
        if method == "_goose/unstable/providers/config/read":
            return self.config_fields(params)
        if method == "_goose/unstable/providers/readiness/check":
            return self.readiness(params)
        if method == "_goose/unstable/session/info":
            return self.session_info(params)
        if method == "_goose/unstable/preferences/read":
            return {"values": []}
        if method in EMPTY_LISTS:
            return {EMPTY_LISTS[method]: []}
        raise _Unknown(method)

    def _config(self) -> dict[str, Any]:
        """The engine's `config.toml`, or an empty mapping when unreadable."""
        try:
            return tomllib.loads(providers.config_path(self.home).read_text(encoding="utf-8"))
        except (OSError, tomllib.TOMLDecodeError, UnicodeDecodeError):
            return {}


class _Unknown(Exception):
    """A private method this backend has no answer for."""

    def __init__(self, method: str) -> None:
        super().__init__(method)
        self.method = method


class _NoSession(Exception):
    """A session id the transport does not know."""

    def __init__(self, session_id: str) -> None:
        super().__init__(session_id)
        self.session_id = session_id


def _text(value: object) -> str:
    """A stripped string, or empty for anything that is not one."""
    return value.strip() if isinstance(value, str) and value.strip() else ""
