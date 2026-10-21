---
description: "Launch a native Code OSS IDE through a dsh profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-ide

English | [中文](README.zh.md)

## Summary

This package manages a Code OSS workspace and its process lifecycle through a Native profile.

## Table of Contents

- [Launch](#launch)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Launch

Install a Code OSS REH Web distribution in `$DSH_HOME/ide/runtime`, with its bundled Node executable and `out/server-main.js` directly under that directory. From the workspace to edit, run `pnpm dsh --profile native-ide` and open the printed local URL in a browser. No model credentials are required.

First use writes `$DSH_HOME/profiles/native-ide/rsh.profile.json`. The workspace is captured from that first invocation's working directory; edit `workspaceDirectory` in the profile to select another folder. The profile also selects runtime location, persistent data and process timeouts. See the [provider configuration](../../../../Modules/Official/ide/ide-code-oss/README.md).

The application takes no task arguments or plugin configuration. It waits for cancellation or server exit; the profile owns cleanup. It publishes no invariant companion because lifecycle and exit status come from the selected IDE provider.

## Model Experience

None, as this package manages IDE lifecycle without creating model input.

#### KV Cache effect

No model request prefix is changed.

## Known Limitations and Deferred Work

- This profile owns the IDE server. [Desktop](../../../Desktop/README.md) owns the embedded conversation adapter; the standalone browser launch has no RSH Agent connection.
- Distribution installation and updates are manual. The runtime is not included in the npm package.

<a id="dev-note"></a>
### Dev Note

One lifecycle owns process readiness and disposal; no independent invariant companion is published.
