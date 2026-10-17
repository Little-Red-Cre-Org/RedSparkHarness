---
description: "The DSH compatibility Web package group: legacy Cordis browser shell and its isolated worker-preview build."
kind: "package-group"
---

# DSH compatibility Web packages

English | [中文](README.zh.md)

## Summary

The compatibility Web package group keeps the existing Cordis browser shell available to Hosts that still select Client plugins through the legacy module table. Its frontend package builds a separate compatibility page and worker preview from shared application source. The Native Web package remains the default Cordis-free browser distribution.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Use the compatibility frontend when a Host needs the existing Cordis page and module route.

| Package | Role |
|---|---|
| [`frontend/`](frontend/README.md) | Legacy browser shell and private worker-preview build |

<a id="related-documentation"></a>
## Related documentation

- [Native Web package decision](../../../../.agents/notes/implemented/architecture/2026-10-17-native-web-default-and-compatibility-browser-owner.md) — separates the default Native page from compatibility ownership.
- [Web Client architecture](../../../Docs/subsystems/web-client.md) — describes the Cordis browser module table used by this package.
- [Native Web Client package](../../../Programs/Web/client/web/README.md) — Cordis-free browser composition API.

<a id="dev-note"></a>
## Dev Note

None.
