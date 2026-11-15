---
description: "Standalone Cordis tree for a minimal coding agent. The shipped profile name sdk-minimal is refused; use dsh --profile sdk."
kind: "package-bundle"
---

# `@redspark/rsh-sdk-minimal`

English | [中文](README.zh.md)

## Summary

The launcher refuses the profile name `sdk-minimal` on boot, dump, plugin management, and `--from-default-profile`. Use `dsh --profile sdk` for a supported SDK launch; see [native configuration migration](../../../../Docs/native-config-migration.md). This package remains the standalone Cordis tree a custom legacy profile can compose. It advertises only a platform-selected persistent shell, persists sessions as uncompressed JSONL, and selects the model from the SDK initialization request. It deliberately excludes `dsh-base`, Web, settings, managed credentials, telemetry, compaction, filesystem tools, workspace instructions, skills, jobs, and subagents. Its danger-full-access policy lets the shell modify any path available to the process, so use it only with an isolated workspace.

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

Do not launch, dump, or manage plugins under the name `sdk-minimal`. The launcher refuses those commands and does not rewrite an existing directory. A custom legacy profile can still list `@redspark/rsh-sdk-minimal` in `dsh.profile.bundles`. Supply an explicit `RSH_HOME` and a disposable workspace when composing it. The supported SDK launch is:

```sh
export RSH_HOME=/absolute/path/to/example-dsh-home
dsh --profile sdk
```

`RSH_CONTEXT_WINDOW` sets the fallback capacity for a model absent from the adapter's advisory catalog. `RSH_SYSTEM_PROMPT` replaces the default persona. The SDK initialization request is the sole model selection and overrides environment defaults.

Plugin management under the name `sdk-minimal` is refused. Use `dsh plugin --profile sdk` for the supported SDK profile, or manage plugins on a custom legacy profile that composes this bundle. Ordered `--patch` files can replace rows or insert bundles above this package's complete default tree. A profile that composes this bundle and sets `patchReload: startup` applies those patches only at startup.

The profile mounts exactly one persistent shell stack: Bash on Linux and macOS, or PowerShell on Windows. Both stacks use a 300-second timeout and one owner-scoped terminal; the other platform's rows remain disabled.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle's single insert is the complete application tree: SDK stdio startup and JSON-RPC serving, one environment-configured DeepSeek adapter, the explicit agent core, local subprocess execution, a platform-selected persistent shell PTY, and uncompressed JSONL persistence under `$RSH_HOME/sessions`. It does not inherit another bundle, so every extra row is an explicit profile change.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Complete standalone profile tree and its environment-backed defaults |
| [`src/index.ts`](src/index.ts) | Bundle package entry |
| — | No runtime invariant companion is published; the package is a static patch-list carrier whose inserted rows own their runtime relationships and invariant companions. |
| [`tests/sdk-minimal.spec.ts`](tests/sdk-minimal.spec.ts) | Exact composition, profile-name, and platform-selection checks |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Python SDK example](../../../../Programs/SDK/python/sdk/examples/README.md) — selects `dsh --profile sdk`, not this package's refused name.
- [SDK application bundle](../sdk-app/README.md) — the JSON-RPC application layer reused by full and minimal SDK profiles.
- [Base bundle](../base/README.md) — the full product foundation that this profile deliberately omits.

-----

<a id="model-experience"></a>
## Model Experience

### Minimal coding-agent composition

#### What the model sees

The system prompt is `RSH_SYSTEM_PROMPT` or `You are a helpful software engineer assistant.`. The only advertised tool is owner-scoped persistent `bash` on Linux/macOS or `pwsh` on Windows; runtime context, filesystem tools, workspace instructions, skills, jobs controls, compaction, and Harness identity are absent.

#### Token effect

One stable persona plus one tool schema. Tool results and ordinary conversation history grow with the session.

#### KV Cache effect

Stable for a fixed persona, platform, provider, model, and bundle patch stack. Profile changes take effect on the next process.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The shipped name no longer boots** — `dsh --profile sdk-minimal`, `--from-default-profile sdk-minimal`, and `dsh plugin --profile sdk-minimal` exit with an error. Existing directories are not rewritten. Use `dsh --profile sdk`, or compose this bundle from a custom legacy profile name.
- **The composition intentionally omits shared product services** — select `dsh --profile sdk` when settings, managed credentials, policy presets, telemetry, Web tools, or the full default tool roster are required.
- **User patches can expand the tree and corrupt stdout** — profile customization is trusted application composition; a plugin that writes ordinary text to stdout can break JSON-RPC framing.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
