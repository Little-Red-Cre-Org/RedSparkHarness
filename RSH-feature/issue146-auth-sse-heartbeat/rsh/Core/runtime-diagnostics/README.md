---
description: "The runtime-diagnostics group map: package-owned runtime invariant checks for live compositions, for users and maintainers navigating the group."
kind: "package-group"
---

# rsh/Core/runtime-diagnostics

English | [中文](README.zh.md)

## Summary

The runtime-diagnostics group provides runtime self-checking and plugin ownership support for DeepSeek Harness compositions: `invariants` runs package-owned checks that verify durable event and data relationships while a composition is live, and `compat-plugin-host` records RSH role metadata while delegating legacy plugin lifecycle to Cordis. A violation surfaces as an error attributed to the package that owns the relationship; a global switch and package-name filters control which invariant checks run.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`invariants`](invariants/README.md) | Runs package-owned runtime checks and reports each failure by owning package | registers on `ctx.invariants` |
| [`compat-plugin-host`](../../Compatibility/DSH/bridge/compat-plugin-host/README.md) | Records RSH plugin roles and adapts legacy Cordis plugin lifecycles | registers on `ctx.pluginHost` |
| [`native-runtime`](native-runtime/README.md) | Resolves and activates native plugin plans with scoped services and owned cleanup | no Cordis context |

-----

<a id="related-documentation"></a>
## Related documentation

- [Runtime invariants subsystem](../../Docs/subsystems/invariants.md) — the generated service reference: selection, installer, and companion contract.
- [Invariant runtime contracts Agent Note](../../../.agents/notes/implemented/architecture/2026-07-19-package-invariant-runtime-contracts.md) — what a runtime invariant may assert and the mechanical gate enforcing companion wiring.
- [Package conventions](../../../AGENTS.md) — the `./invariant` companion rule every package follows.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
