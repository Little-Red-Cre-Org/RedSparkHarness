# Agent Note: ChatGPT-plan models use the public SIWC Responses route

Status: implemented

English | [中文](2026-10-08-codex-siwc-provider.zh.md)

## Problem

The pi-ai `openai-codex` catalog describes a bundled release rather than the account that signed into the Harness, and its Codex transport is not the public integration contract for a third-party ChatGPT-plan app. A static model list can therefore hide newly available models or advertise models the selected account cannot use.

## Decision

The `openai-codex` route uses an app-owned Sign in with ChatGPT OAuth registration. The authorization flow uses a loopback callback, state, nonce, and PKCE; it verifies the returned ID token against OpenAI's published JWKS and binds the saved subject to the issued client ID. The existing credential store retains the stable agent host ID before browser authorization and the issued client ID before token exchange, then remains the single authority for the grant and rotating refresh token. The route neither reads Codex CLI files nor decodes access-token claims.

`listModels` and Models-page discovery use the same pi-ai `Models` collection and saved OAuth grant as inference. The account catalog comes from `GET https://api.openai.com/v1/models`; only `models[]` rows with `visibility: "list"` enter the picker, with `slug` as the request id and `display_name` as its label. The first exact-model resolution in a fresh collection loads this catalog before inference, so a saved model does not need a prior UI listing call. Requests go to the public `POST https://api.openai.com/v1/responses` route through pi-ai's OpenAI Responses implementation. The request uses `store: false` and streaming, and the provider accepts completion only after the Responses stream's terminal event.

The server catalog does not promise context limits, output-token caps, prices, or reasoning controls, so the adapter does not publish those fields. It rejects unsupported request controls such as output-token limits and temperature, and refuses profile overrides that would redirect or replace the SIWC authority. The native ModelDirectory passes its operation signal into provider model listing so account refresh can be cancelled with the catalog query. The shared discovery module imports provider-neutral errors, API-key normalization, attribution and model-discovery types from `@deepseek-ai/dsh-llm/native`; protocol-specific listing parsing stays in this provider.

## Alternatives considered

**Use pi-ai's static Codex catalog and app-server backend.** Rejected because those describe a bundled Codex release and Codex-specific route, not the currently signed-in account's public SIWC model and inference contract.

**Decode `chatgpt_account_id` from the bearer token or reuse Codex CLI credentials.** Rejected because the documented public Responses flow needs the same OAuth bearer for listing and inference; it does not require a private backend account header. Consumer-side token decoding and CLI credential access would create a second, undocumented auth authority.

**Hardcode current GPT-6 identifiers and capability or price estimates.** Rejected because account model access and catalog entries change independently of this package release, and the public listing does not declare those capabilities.

## Consequences

The route requires an app-owned SIWC login with `chatgpt.tokens.use.direct`; older or unrelated OAuth records do not activate it. The account-specific model list refreshes when a consumer asks for models, and a provider or network failure is returned instead of falling back to pi-ai's bundled Codex catalog. Models with unknown capabilities remain text-only and unsized in this adapter's public descriptor. This implementation has composition fixtures for list and inference wiring, while a real account login, live catalog, and user inference still require credentialed validation.

`jose` is a direct runtime dependency for ID-token verification. The code-review boundary is the `llm-pi-ai` SIWC provider and its two adapter contracts; it does not move Agent, Session, or subagent authority.

The native Provider registers the same Cordis-free flows on the optional native `authorization` service, and its credential writes carry the attempt signal. Token, refresh, JWKS and catalog requests each have a 30-second deadline, and the browser callback waits at most 10 minutes; the JWKS is fetched with that signal instead of through `createRemoteJWKSet`. A committed `llm-pi-ai` credential record drops the adapter's cached provider collection, so the next listing loads the account catalog under the new grant.
