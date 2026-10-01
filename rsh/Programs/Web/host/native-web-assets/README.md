---
description: "Desktop native Client pages and compiled assets are served from an installed runtime without Cordis services."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-web-assets

English | [中文](README.zh.md)

## Summary

`dsh-native-web-assets` resolves the installed frontend, serves a selected native Client page and its Host-built assets, and confines static-file reads to the frontend distribution. `listenNativeHttpHost` adds the Cordis-free node:http carrier: it binds the shared Connection registry, authenticates `/api` and registered RPC channels, and owns listener teardown. The existing Desktop Host uses the same routes for its optional native preview.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

`createNativeDesktopAssetHandler(runtimeDir, nativeClient, transportScript)` requires an installed `@deepseek-ai/dsh-web-frontend` distribution containing `dist/native.html`, a validated Client bundle, and a Host-owned browser transport script. Its `update(bundle)` operation publishes a complete replacement asset map atomically for a live Host. It does not require `dist/index.html`. It serves the native page at `/`, `/index.html`, `/native.html`, and unmatched application paths; compiled Client assets come only from the supplied asset map. `GET` and `HEAD` are supported, legacy `/plugins/` requests return 404, and decoded or symlinked static paths outside the installed frontend are rejected. `listenNativeHttpHost(registry, assets, bridge, config)` binds a loopback listener by default, routes `/api` and registered channels through the shared Connection policy, and exposes `close()` for deterministic teardown. The composing Host injects the native Connection bridge explicitly. `createDesktopAssetRoutes` exposes the same native and static routes to the compatibility Host, which also requires `dist/index.html` and owns the `/plugins/` endpoint.

<a id="model-experience"></a>
## Model Experience

None, as the package serves browser assets and creates no model request content.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This package does not select a Client profile or compose the full native Web application; callers provide the registry and selected asset bundle.
- The supported product Client roster has not moved to the native page; the compatibility Host still serves the legacy application by default.

No invariant companion is published because route responses are derived from the installed frontend and the supplied immutable bundle, with no independent persistent state.

<a id="dev-note"></a>
### Dev Note

None.
