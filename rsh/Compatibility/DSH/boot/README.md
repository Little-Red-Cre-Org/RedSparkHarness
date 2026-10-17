---
description: "The boot package group: how dsh app bins start — environment loading, profile and patch layers, clear startup failures, and app-owned command lines."
kind: "package-group"
---

# boot/ — shared app-bin boot glue

English | [中文](README.zh.md)

## Summary

The boot group provides what dsh applications need to start: `app-boot` turns a `cordis.yml` plus environment and patch layers into a running app with clear failure messages, and `cmdline` lets an app own its command-line flags and `--help`. The private `desktop-host-compatibility` package boots legacy Cordis profiles only in an explicitly selected Desktop compatibility assembly. Each package README defines its package contract; Desktop documentation owns the compatibility assembly and profile requirements.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`app-boot`](app-boot/README.md) | Boots a dsh app from a `cordis.yml`: loads `.env`, applies profile and patch layers, and reports startup failures clearly | (library for the bins) |
| [`cmdline`](cmdline/README.md) | Lets the app own its flags, `--help`, and exit code; passes everything after the launcher's flags through verbatim | `cmdlineArgs`, `appExit` |
| [`desktop-host-compatibility`](desktop-host-compatibility/README.md) | Boots legacy Cordis profiles in an explicitly selected Desktop compatibility assembly | private Desktop runtime |

<a id="related-documentation"></a>
## Related documentation

- [dsh app](../../../Programs/CLI/README.md) — the `dsh` bin that consumes these helpers for its boot sequence.
- [Desktop](../../../Programs/Desktop/README.md) — release assembly selection and supported profile runtimes.
- [Profile bundles](../bundle/README.md) — installable patch layers that `dsh --profile` compositions mount.
- [dsh-home-paths](../../../Core/util/home-paths/README.md) — the harness-home resolver both packages build on.
- [dsh-cmdline](cmdline/README.md) — how an app owns its flag family instead of the launcher.

<a id="dev-note"></a>
## Dev Note

None.
