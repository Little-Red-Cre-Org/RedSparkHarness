---
description: "Code OSS Web Host lifecycle and workspace configuration for Native profiles."
kind: "package-reference"
---

# @deepseek-ai/dsh-ide-code-oss

English | [中文](README.zh.md)

## Summary

Open a local workspace in a complete Code OSS workbench, using its own VS Code extension host. Install a compatible REH Web runtime separately. Native profile shutdown owns the server and its descendants.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Configuration

The `./native` entry requires `subprocess` and provides `ide`. Supply all configuration fields explicitly:

| Field | Meaning |
|---|---|
| `runtimeDirectory` | Absolute directory containing `node.exe` (Windows) or `node`, and `out/server-main.js` from a Code OSS REH Web distribution. |
| `workspaceDirectory` | Absolute existing directory opened by the workbench. |
| `dataDirectory` | Absolute directory for server state, user settings and installed extensions. |
| `startupTimeoutMs` | Positive startup deadline in milliseconds, at most 2147483647. |
| `shutdownGraceMs` | Positive subprocess termination grace in milliseconds, at most 2147483647. |
| `maxOutputBytes` | Per-stream retained output limit, at least 1024 bytes. |

The server binds `127.0.0.1` on an available port and authenticates with a random connection token. `ide.url` contains that token and the workspace path; treat it as a local credential. `ide.exited` resolves with the server exit code or rejects on process failure. NativeHost disposal drains the server and extension-host descendants, then removes the temporary token file. Settings and extensions persist. Telemetry is disabled for the server; individual extensions own their telemetry settings.

Use a distribution configured for Open VSX, such as [VSCodium REH Web](https://github.com/VSCodium/vscodium/releases), and retain its notices. Installation and updates of that distribution are deployment responsibilities. Missing runtime files and invalid workspace paths fail activation. No invariant companion is published: readiness and process ownership have one lifecycle authority.

## Model Experience

### IDE lifecycle

#### What the model sees

Nothing. The provider does not create model requests or Session events.

#### Token effect

No model request tokens are added.

#### KV Cache effect

No model request prefix is changed.

## Known Limitations and Deferred Work

- The workbench runs in a browser. RSH Desktop embedding and an RSH command bridge are not provided.
- Compatibility depends on the selected Code OSS version, extension host and extension requirements. Open VSX and local VSIX installation do not guarantee compatibility with every VS Code extension; Microsoft product-specific extensions are not included.
- Extensions execute with the local user's permissions. Native scopes do not sandbox the Code OSS extension host.
- The runtime is installed separately; this package does not download, package or update it.

## Dev Note

None.
