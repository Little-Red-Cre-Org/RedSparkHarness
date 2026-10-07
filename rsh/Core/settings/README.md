---
description: "The Core Settings group map: framework-neutral service and Native declarations shared by settings providers and consumers."
kind: "package-group"
---

# rsh/Core/settings

English | [中文](README.zh.md)

## Summary

The Core Settings group provides shared declarations for settings providers, APIs, and consumers. `settings-definition` owns the framework-neutral service types and Native service augmentation. The compatibility group owns Cordis declarations, while concrete storage and resolution remain with the selected Settings provider.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`settings-definition`](settings-definition/README.md) | Shared Settings service, wire, and Native declarations |

<a id="related-documentation"></a>
## Related documentation

- [Settings subsystem](../../Docs/subsystems/settings.md) — shared, Cordis, and Native service declarations.
- [Compatibility bridge group](../../Compatibility/DSH/bridge/README.md) — selected Cordis extensions.
- [Official Settings group](../../Modules/Official/settings/README.md) — Settings providers and consumers.

<a id="dev-note"></a>
## Dev Note

None.
