# Agent Note: Native DeepSeek request-contribution ownership

Status: implemented

English | [中文](2026-10-13-native-deepseek-request-contributions.zh.md)

## Problem

The Cordis request contributors derive ownership from Loader fibers and Cordis services. Native profiles instead select package entries, scopes, and active Session owners; reusing Loader rows or inferring package identity from a plugin name would lose those exact identities.

## Decision

Package-backed Native installations carry the selected manifest's actual non-empty `name` and `version` as `NativePackageProvenance`, tied to the exact installation id and scope. `NativePluginInventory.packages(scope)` returns only ready package-backed installations visible from that scope and its ancestors; in-memory installations have no package provenance.

The request-field registry has a separate Native Host entry. `register(scope, field, provider)` binds contributions to Native scope visibility, and `prepare(scope, request)` selects the nearest visible provider. `llm-deepseek` consumes `deepseekLlmApiExtensions` optionally and also treats `activeSessions` as optional: an exact `sessionId` match uses the active Agent's scope; absence or no match uses the model installation scope. The package-inventory contributor requires the registry, `pluginInventory`, and `activeSessions`; the Session-log contributor requires the registry and `activeSessions`. Unmatched Session-log requests add no field.

Native Session-log delivery reads and appends through the exact active Session owner and records acceptance in the canonical Session event map. Native package inventory reads from the matched Agent scope, or from its contributor's installation scope when no Session matches. The focused profile composition copies the Native headless fixture for its test and does not change the shipped profile template. The existing Cordis entries retain their Loader and Session services. Native entries are explicit Host package subpaths; shipped profiles continue to assemble Cordis entries. The Cordis request-field decision remains in the [existing request-extension note](2026-08-21-deepseek-llm-api-request-extensions.md), and package placement remains in the [official model ownership note](2026-10-06-official-model-integration-ownership.md).

## Alternatives considered

**Derive package versions from Native plugin names or Cordis Loader rows.** Rejected because an entry name is not its selected npm manifest identity, and Native installations do not require a Cordis Loader.

**Require Native request services for every DeepSeek model.** Rejected because a standalone Native model remains valid without contribution providers or an active Session owner.

## Consequences

Package metadata identifies the selected installation rather than arbitrary runtime callbacks. Provider-scoped registry lookup preserves nearest-scope ownership, while the optional model capabilities keep unrelated Native compositions independent. Cordis and Native contributions share the DeepSeek wire fields and Session event authority without sharing their lifecycle services or changing shipped defaults.
