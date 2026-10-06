# Agent Note: Native Web edits registered Settings and Credentials

Status: implemented

English | [中文](2026-10-06-native-web-settings-credentials.zh.md)

## Problem

The native Web Host profile already installs Settings and Credentials Providers, but its Session Consumer exposed no browser operations for editing their user configuration or credentials.

## Decision

The native Web Session controller adds Settings and Credentials operations to the existing authenticated `/api` Connection carrier. It creates no Engine, Connection registry, listener or authorization service. Desktop reuses the existing private native Host carrier and the selected profile's Providers.

Settings owners opt registrations into configuration presentation by supplying schema metadata and optional apply timing. The Host describes only those active registrations, removes schema-declared secret values and all schema default metadata, rejects secret fields hidden behind unsupported schema nodes, and applies visible path edits against an expected revision. Native edits can address existing array indices but cannot create gaps or remove entries; edits at or above secret fields are refused. A stale write returns the expected and current revisions; the Client refreshes the authoritative projection while retaining the user's draft.

Credential references are discovered from registered schemas marked `credential-ref`, rather than a provider or key catalog. The Host projects only configured, source and writable facts. Settings or Credentials Provider exception text is replaced with a generic RPC failure; revision conflicts retain only the namespace and expected/current revisions. The Client sends a value once to set it, clears its local input after success and receives only an acknowledgement; unset also returns no value.

The native Client adds locale-owned Settings navigation, JSON editing of user overrides and write-only controls for the discovered references. Array edits operate at existing indices; the editor reports unsupported resizing or visible row movement instead of claiming the save succeeded. It does not change the default profile composition.

## Supported scope

The surface covers schemas explicitly published by active Settings registrations and credential references in their current resolved values. Secret fields must be reachable through the Settings redactor's `object`, `dict` or `array` traversal; unsupported secret schema nodes remain unsafe to publish. The UI does not edit hidden `role('secret')` fields, create authorization grants, complete opaque grant-record editing or reproduce the legacy plugin settings page. Browser authorization login remains separate work.

## Alternatives considered

**Add a second settings listener or a separate Web service.** The Host already owns one authenticated Connection registry, Fetch carrier and request lifetime; another endpoint would duplicate those owners.

**Hardcode provider names and credential keys in the page.** Registrations already own their schemas and current credential references, so a static list would drift from installed Consumers and profiles.

**Return credentials through describe or echo them after writes.** The existing Credentials reference view intentionally has no value field; the browser only needs presence/source/writability and a write acknowledgement.

## Consequences

Settings presentation is opt-in through registration metadata, and schema-backed edits retain unobserved fields through path operations. Callers must refresh after conflicts and preserve their draft. Credential values remain write-only across the Web RPC and UI; grant authorization and opaque records remain unsupported.

## Testing

The settings package regression covers schema opt-in, secret value and default redaction, credential-reference discovery, object and array path edits, hidden-value preservation and revision conflicts. The authenticated native HTTP test exercises raw descriptor redaction, secret-bearing Provider failures, stale-write projection and write-only Credentials RPC. Client tests cover indexed array edits and explicit structural refusal; focused package compilation and browser checks cover the changed source.
