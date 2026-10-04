---
description: "Native profiles can accept reversible tool contributions while the application keeps the only durable Session result record."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-tools

English | [中文](README.zh.md)

## Summary

`dsh-native-tools` lets a native profile add model-callable tools without adding a second tool loop or Session writer. Each contribution supplies one schema and execution function, and its disposer removes only that contribution. Execution receives the exact native Agent alongside its Session and cancellation signal. The consuming application owns tool-call validation and records the returned result once.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The `./native` entry accepts only an empty configuration object. It requires `agents` and provides `tools`; consumers must declare that service before registering contributions. A contribution can declare `approval` with a reason. Its consuming application supplies the matching `authorize()` callback; the registry invokes it before the executor, and fails when a protected contribution has no approval authority. Duplicate schema names fail during activation, calls with an unregistered Agent fail before execution, and teardown clears remaining registrations.

The pure `./types` and `./presentation` exports share durable PTC event payloads and file diffs with Host and Client consumers. The registry entry is Host-only. These declarations do not install a PTC executor or change Session event names or payload fields.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the consuming native application that selects schemas and appends results to its Session.

#### KV Cache effect

The consuming application owns request-prefix changes from registered schemas.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The registry does not parse model arguments, render UI, or write Session events.
- Registrations are scoped to one native installation and are not a replacement for legacy tool lifecycle services.

No invariant companion is published because the registry has no independent durable observation beyond its owning application.

<a id="dev-note"></a>
### Dev Note

None.
