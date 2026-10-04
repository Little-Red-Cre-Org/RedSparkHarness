---
description: "Native profiles can accept reversible tool contributions while the application keeps the only durable Session result record."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-tools

English | [中文](README.zh.md)

## Summary

`dsh-native-tools` adds scoped model tools and typed program bindings to a native profile. Contributions share validation, approval, cancellation and result processing. The application keeps the only Session writer and decides when a completed result becomes durable.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The `./native` entry accepts `mode: native | ptc | both` (default `both`). Native mode hides `run_code` from model calls, PTC mode exposes only that transport and requires a visible registered `run_code`, and both mode exposes all visible tools. Program bindings retain the same scoped capabilities in every mode. Unknown configuration fields fail activation.

Value contributions declare an output schema; the registry captures it, validates detached JSON and renders the canonical result. Scoped restrictions and guards run before approval and again before executor entry. Removing a contribution closes admission, cancels captured calls and drains their actual work before its disposer resolves. Result policies must delegate exactly once; finalizers finish before the application records the result. Only `acceptResult()` notifies result observers after that record is accepted. Sourced additional contexts remain separate from canonical JSON.

The pure `./types` and `./presentation` exports share durable PTC event payloads and file diffs with Host and Client consumers. The registry entry is Host-only. These declarations do not install a PTC executor or change Session event names or payload fields.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the consuming native application. Selected schemas and rendered results reach the model; sourced additional contexts become separate logged messages.

#### KV Cache effect

The consuming application owns request-prefix changes from registered schemas.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The registry supplies PTC dispatch and TypeScript/Python binding renderers; an actual code-runtime Consumer and selected runtime Provider are separate installations.
- It does not open Session storage or add a second execution loop. The application owns durable event ordering and model requests.

No invariant companion is published because there is no independent observation of the owning application's durable result acceptance.

<a id="dev-note"></a>
### Dev Note

None.
