---
description: "Run a selected Cordis-free Web Client profile behind an authenticated native HTTP Host."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-web-host

English | [中文](README.zh.md)

## Summary

`dsh-native-web-host` runs a selected native Web Client profile behind one authenticated `node:http` listener. It prepares the Client bundle, creates the shared Host Connection registry from native credentials, and publishes a Native Runtime application and Host service. It supplies the carrier and lifecycle; domain API providers still need to register their own channels on the shared Connection authority.

No runtime invariant companion is published because the carrier's authoritative guarantees are route authentication, owned listener cleanup, and native composition tests.

## Table of Contents

- [Configuration](#configuration)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="configuration"></a>
## Configuration

The native profile selects this package with `projectDir` and `runtimeDir`. `projectDir` contains `rsh.client.json`; `runtimeDir` contains the installed `@deepseek-ai/dsh-web-frontend` distribution and selected native Client packages. The optional `transportScript`, listener `host` and `port`, request-size cap, trusted authorities, browser-cookie lifetime, and `clientReload` mode are validated before activation. `clientReload: live` watches the profile file, rebuilds a complete candidate, and publishes it through the authenticated `/api/native-client/reload` route only after bundling succeeds. The listener binds loopback with an OS-assigned port by default and the application prints a tokenized URL before waiting for NativeHost shutdown.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Activation prepares the Client graph through `dsh-native-web-assets`, creates one Host Connection registry through `dsh-client-connection/native-host`, and binds its Fetch-shaped routes through the native `node:http` bridge. Live reload watches the profile directory so atomic replacement is observed, serializes candidate preparation, and updates the asset map and revision together; invalid candidates retain the current page. The browser loads candidate styles and modules before asking `NativeClientHost.replace`, so replacement or import failure leaves the current UI mounted. Later native Host providers use the published `nativeWebHost` service to register RPC channels or exact Fetch routes. NativeHost owns the listener disposer, so route contributions drain before the socket closes. The package imports no Cordis Loader, legacy Web Server, or second Agent, Session, or Tools authority.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Native Web assets](../native-web-assets/README.md) — Client bundling, page injection, and static route confinement.
- [Client Connection](../../client/connection/README.md) — authentication, RPC channels, and Host/Client transport contracts.
- [Native runtime](../../../../Core/runtime-diagnostics/native-runtime/README.md) — installation dependencies and awaited cleanup.

<a id="model-experience"></a>
## Model Experience

### Native Host

#### What the model sees

Nothing from this package. Native domain providers own every model-facing request and `Session` event.

#### Token effect

No model request content is created here.

#### KV Cache effect

No model request content is created here.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This package provides the HTTP carrier and Client boot only; native domain providers must still expose the Session, Agent, tools, and other product API channels.
- New `native-web` profiles enable `clientReload: live`; other profiles default to `startup`. This reload covers the selected native Client profile and its compiled module graph. It does not provide source-level module HMR or arbitrary legacy plugin support. The CLI's live configuration monitoring separately replaces the Host application when its native installation graph changes. See [native CLI profiles](../../../CLI/README.md#profiles).
- Non-loopback binding requires explicit trusted authorities and does not make the listener suitable for an untrusted network by itself.

<a id="dev-note"></a>
### Dev Note

No model request content is created here.
