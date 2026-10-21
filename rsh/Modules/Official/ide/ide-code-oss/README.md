---
description: "Code OSS Web Host lifecycle and workspace configuration for Native profiles."
kind: "package-reference"
---

# @deepseek-ai/dsh-ide-code-oss

English | [中文](README.zh.md)

## Summary

This package manages a Code OSS workspace and its process lifecycle through a Native profile.

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
| `builtinExtension` | Optional absolute local VSIX path installed before server startup; Desktop supplies its bundled workbench adapter. |
| `languagePack` | Optional publisher.extension identifier installed through the configured upstream registry before startup; Desktop supplies the Simplified Chinese pack when selected. |
| `startupTimeoutMs` | Positive deadline for each installation and server-start phase in milliseconds, at most 2147483647. |
| `shutdownGraceMs` | Positive subprocess termination grace in milliseconds, at most 2147483647. |
| `maxOutputBytes` | Per-stream retained output limit, at least 1024 bytes. |

The provider awaits VSIX installation before starting the server so its initial extension scan includes the adapter, including after a workspace reload. Installation failure prevents server startup. The server binds `127.0.0.1` and authenticates with a random connection token. `ide.url` contains that token and the workspace path; treat it as a local credential. `ide.exited` resolves with the server exit code or rejects on process failure. NativeHost disposal drains the server and extension-host descendants, then removes the temporary token file. Settings and extensions persist. Telemetry is disabled for the server; individual extensions own their telemetry settings.

Use a distribution configured for Open VSX, such as [VSCodium REH Web](https://github.com/VSCodium/vscodium/releases), and retain its notices. Installation and updates of that distribution are deployment responsibilities. Missing runtime files and invalid workspace paths fail activation. No invariant companion is published: readiness and process ownership have one lifecycle authority.

The first server launch binds an available port and records it in `dataDirectory/server-port`; later launches require the same port. An occupied port or invalid port record fails activation instead of changing the browser origin and losing access to stored workbench state. One running server owns each data directory. Connection tokens remain launch-specific and are removed after shutdown.

Each canonical project path selects a persistent `workspaces/<sha256>/RedSpark.code-workspace` beneath the data directory, opened through the upstream `workspace` URL parameter. Windows paths are case-folded for the key. The initial file contains the selected folder; Code OSS owns subsequent folder and workspace-setting edits, which the provider preserves. A stable origin and workspace URI retain upstream trust decisions and editor storage across restarts. Multi-root support avoids the first folder switch's workspace-conversion save operation; project files remain in their original directories.

## Model Experience

None, as this package manages IDE lifecycle without creating model input.

#### KV Cache effect

No model request prefix is changed.

## Known Limitations and Deferred Work

- Standalone launches open a browser; [Desktop](../../../../Programs/Desktop/README.md) owns the embedded workbench and conversation adapter.
- Compatibility depends on the selected Code OSS version, extension host and extension requirements. Open VSX and local VSIX installation do not guarantee compatibility with every VS Code extension; Microsoft product-specific extensions are not included.
- Extensions execute with the local user's permissions. Native scopes do not sandbox the Code OSS extension host.
- The runtime is installed separately; this package does not download, package or update it.

<a id="dev-note"></a>
### Dev Note

One lifecycle owns process readiness and disposal; no independent invariant companion is published.
