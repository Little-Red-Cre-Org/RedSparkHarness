---
description: "Launch a native Code OSS IDE through a dsh profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-ide

English | [中文](README.zh.md)

## Summary

Start a local browser IDE with `dsh --profile native-ide`. The profile prints the authenticated workspace URL and waits for shutdown. The Code OSS runtime is a separate installation.

## Table of Contents

- [Launch](#launch)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Launch

Install a Code OSS REH Web distribution in `$DSH_HOME/ide/runtime`, with its bundled Node executable and `out/server-main.js` directly under that directory. From the workspace to edit, run `pnpm dsh --profile native-ide` and open the printed local URL in a browser. No model credentials are required.

First use writes `$DSH_HOME/profiles/native-ide/rsh.profile.json`. The workspace is captured from that first invocation's working directory; edit `workspaceDirectory` in the profile to select another folder. The profile also selects runtime location, persistent data and process timeouts. See the [provider configuration](../../../../Modules/Official/ide/ide-code-oss/README.md).

The application takes no task arguments or plugin configuration. It waits for cancellation or server exit; the profile owns cleanup. No runtime invariant companion is published because lifecycle and exit status come from the selected IDE provider.

## Model Experience

### IDE application

#### What the model sees

Nothing. This profile does not start an agent or Session.

#### Token effect

No model requests are made.

#### KV Cache effect

No model cache is involved.

## Known Limitations and Deferred Work

- This is a browser IDE profile. It does not add an IDE panel to the Desktop application or connect editor commands to the RSH agent.
- Distribution installation and updates are manual. The runtime is not included in the npm package.

## Dev Note

None.
