# Agent Note: Native closure skips compatibility-only peers

Status: implemented

English | [中文](2026-10-20-native-closure-skips-compatibility-peers.zh.md)

## Problem

The Native Desktop package set has to ship the Cordis kernel so a Native row can host one Cordis plugin, and it still has to omit the legacy assembly packages. A selected package can peer one of those omitted packages. Following that peer selects the omitted package, and the Native assembly guard fails. Marking the peer optional in the plugin manifest would hide a Cordis-mode requirement and would have to be repeated for the next peer.

## Decision

`@deepseek-ai/cordis` is a Native runtime package. `CORDIS_RUNTIME_PACKAGES` names it, and `@deepseek-ai/dsh` plus `@deepseek-ai/dsh-cordis-bridge` depend on it. It is not a member of `DESKTOP_COMPATIBILITY_OPTIONAL_DEPENDENCIES`. The loader, bundle, and boot packages remain in that set.

`selectClosure` does not follow a peer or optional edge into that set. A hard `dependencies` edge into it throws `requires compatibility-only package` during selection. The compatibility assembly passes an empty skip set and still follows every edge. Desktop install keeps `autoInstallPeers: false`, so an unmet compatibility-only peer is not fetched from the registry.

`@deepseek-ai/dsh-persona` keeps `@deepseek-ai/cordis` as a non-optional peer. The bridge package depends on Cordis when the Native persona row runs; the peer still declares what the Cordis plugin requires.

## Alternatives considered

**Mark each offending peer optional:** this changes Cordis-mode installation to satisfy the Desktop walker. The next non-optional peer, such as `dsh-system-prompt` peering `dsh-invariants`, fails the same guard.

**Remove the compatibility-only package from the exclusion set:** this ships the Cordis invariant companion in the default Native assembly. The exclusion set exists to prevent that.

**Drop only the bridge dependency that first reached the peer:** `dsh-persona` still peers `dsh-system-prompt`, and that package peers `dsh-invariants`. Removing one dependency does not close the walk.

## Consequences

A Native package set can include a package that peers a compatibility-only package without selecting that package. A hard dependency on one fails before tarballs are copied. Compatibility packaging still includes those peers when an included package declares them. This extends the [native Desktop private Host](2026-10-05-native-desktop-private-host.md) decision and does not replace the Host split.
