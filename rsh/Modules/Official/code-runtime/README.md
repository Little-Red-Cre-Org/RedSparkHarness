---
description: "Package map for the code-execution capability family: what program execution does for you, and which package owns each part."
kind: "package-group"
---

# code-runtime/ — code-execution capability family

English | [中文](README.zh.md)

## Summary

The family separates the portable run contract, the Cordis adapter, and execution backends. Choose the worker-thread TypeScript backend for a fresh Node worker, the process-sandbox backend for an explicitly native confined process, or the private experimental Python backend for CPython. Each run starts without state from earlier programs, and failures are returned as results.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The Definition, compatibility adapter, and runtime Providers divide the portable contract, Cordis service, and execution mechanisms; each README describes its owner.

| Package | Role | ctx key |
|---|---|---|
| [`code-runtime-definition`](../../../Engine/core/code-runtime-definition/README.md) | Defines portable code-run requests and provider operations without a framework dependency | — |
| [`compat-code-runtime/`](../../../Compatibility/DSH/bridge/compat-code-runtime/README.md) | Implements the Cordis `ctx.codeRuntime` service contract | `ctx.codeRuntime` |
| [`native-code-runtime/`](native-code-runtime/README.md) | Supplies the native worker runtime shared by execution Providers | — |
| [`code-runtime-worker-thread/`](code-runtime-worker-thread/README.md) | Executes TypeScript programs, each in a fresh Node worker thread | registers `ctx.codeRuntime` |
| [`code-runtime-process-sandbox/`](code-runtime-process-sandbox/README.md) | Provides sandboxed process execution for explicitly native profiles | — |
| [`experimental/code-runtime-python/`](../../Community/experimental/code-runtime-python/README.md) | The experimental Python backend: owns the fd-3 wire protocol between a Node host and a CPython subprocess | — |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference for the service contract, then the PTC mode design that consumes this capability and the capability-seam model it follows.

- [Code runtime subsystem reference](../../../Docs/subsystems/code-runtime.md) — request/result vocabulary, bindings, and the `ctx.codeRuntime` Cordis surface.
- [PTC mode Agent Note](../../../../.agents/notes/implemented/feature/2026-06-15-ptc.md) — how the tool registry presents `run_code` to the model.
- [Capability seams](../../../Docs/capability-seams.md) — the Service Definition / Service Provider / Consumer split this family follows.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
