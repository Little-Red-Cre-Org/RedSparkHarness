---
description: "Add the current tmux location to native headless requests and preserve it in Session history across restarts."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-tmux-context

English | [中文](README.zh.md)

## Summary

Add the current tmux session, window, and pane location to native headless model requests. A changed location is saved in Session history before dispatch and recovered after restart. The shipped Native Headless templates keep the Provider disabled because they do not install a shell executor.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Install the Provider in a Native profile when model requests should include the agent process's current tmux location.

### When to choose it

Choose this Provider for an explicitly selected Native Headless profile that also installs a shell executor. Use the separate `dsh-tmux-context` package for the compatibility Agent pre-step path.

### Minimal configuration

The shipped profiles already declare a disabled row. This overlay enables it and sets a refresh floor; the same composition must also install a shell Provider:

```json
{
  "formatVersion": 1,
  "installations": [
    { "id": "tmux-context", "disabled": false, "config": { "refreshIntervalMs": 30000 } }
  ]
}
```

`refreshIntervalMs` defaults to `0`; a positive value is the minimum interval between committed readings, including changed locations. The Provider's [`Config`](src/index.ts) declaration lists the accepted field.

<a id="understand-the-implementation"></a>
## Understand the implementation

The Provider queries through the selected `shell` service and returns a source-attributed user message. It verifies that the agent process's controlling terminal matches the selected tmux pane, then records only location metadata. Native Headless owns the Session writer, reconstructs duplicate-suppression state from committed events, and appends a returned message after preparation and cancellation checks.

<a id="further-exploration"></a>
## Further Exploration

- [tmux-context subsystem](../../../../Docs/subsystems/tmux-context.md)
- [Cordis-free tmux-context Definition](../../../../Engine/context/tmux-context-definition/README.md)
- [Native Headless](../../../../Engine/core/native-headless/README.md)
- [Compatibility tmux-context Provider](../../../../Engine/context/tmux-context/README.md)
- [Durable Native tmux location decision](../../../../../.agents/notes/implemented/feature/2026-10-12-native-tmux-context.md)

## Model Experience

Indirectly, through the Provider's message that the consuming native application appends to the Session before model dispatch.

#### KV Cache effect

The message adds the current location on the first step when that location differs from the last committed reading.

## Known Limitations and Deferred Work

- The query needs POSIX `ps` and `tmux`, a `TMUX_PANE` value, and a matching controlling terminal; otherwise it contributes no location message.
- The Provider reads location metadata only; it does not read pane text, terminal contents, or pixel dimensions.
- A location change during a turn appears on the next turn because preparation runs on step one only.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
