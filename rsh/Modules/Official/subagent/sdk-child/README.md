---
description: "Native Subagent adapter that runs one child through the standard dsh Native SDK profile and Host-managed stdio connection."
kind: "package-reference"
---

# @deepseek-ai/dsh-sdk-child

English | [中文](README.zh.md)

## Summary

This Native Module supplies the `dsh-sdk` external Subagent route. For each admitted child, it uses the public, Engine-owned SDK transport over a Program-provided fixed launcher and the Host-owned managed stdio connection. Native Subagent remains the sole admission, lineage, result publication, and parent-writer owner. The selected Native SDK server runs its existing single Headless step loop.

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

Use the explicit `native-sdk-dsh-child` profile to opt in. The existing `native-sdk` profile and its `spawn` default do not change. This profile selects the sandboxing filesystem, Native sandbox policy, and local process-sandbox Provider, then mounts this Module and the fixed launcher carrier. Its launcher creates a fresh, randomly named DSH_HOME under the OS temporary directory and removes only that directory after the managed process range is quiescent. It copies only the chosen pi-ai provider profile into that home. The child receives the selected provider credential resolved through the Host credential Provider; it does not inherit the parent environment wholesale or read stored OAuth/API-key records. The selected profile must name an explicit `apiKeyEnv`.

The child process uses the exact parent Session cwd. Its model-visible file grants come only from parent Native Headless builtins; a custom Plugin tool with the same name grants no child builtin. Child reads remain bounded to cwd. A child receives `write_file` only when the parent snapshot grants that builtin, the parent requires approval, the snapshot supplies a workspace-write root, and the `dsh-sdk` driver holds the approval callback bound to the admitted owner, epoch, and turn. The fixed launcher then installs Native Approval with `ask` only in that private child composition. The child request is correlated by operation, request, Session, and tool-call identities; the parent authority alone records asked/decided events and may answer `allowed-once`. Cancellation or owner retirement drains the relay and rejects late decisions. The process sandbox separately confines filesystem effects; its backend also has its documented temporary-directory behavior, and Windows enforcement is reported as partial where applicable, not as a full OS boundary.

The SDK entry accepts only the workspace, provider/model/reasoning route, per-request `maxTokens`, parent `maxSteps`, and exact granted builtin file tools. The Program-owned launcher resolves the same-version standard `dsh` package with fixed `--profile native-sdk`; neither the Module nor the public Host adapter can select an arbitrary executable, argv, profile, or patch. The injected launcher and `childConnection` are capabilities for fixed launch and managed transport/lifecycle, not command escapes.

<a id="understand-the-implementation"></a>
## Understand the implementation

The adapter maps one admitted Native external-child request to a child SDK Session. It reports readiness after the SDK handshake negotiates `maxSteps`; the selected server clamps that value to its profile ceiling, and the Headless loop enforces it when a subsequent turn runs. `maxTokens` caps each child model request. The Module returns a child `result` promise and `dispose` function; the result may settle before disposal completes. The Native Subagent Provider awaits the result and managed-process cleanup before persisting and publishing the terminal fact/result. Native Subagent owns admission, lineage, parent Session writes, and terminal publication; the [shared SDK runtime](../../../../Engine/subagent/sdk-runtime/README.md) owns the protocol client.

No runtime invariant companion is published because the adapter's per-request lifecycle has no independent runtime observation; Native Subagent owns admission, lineage, parent Session writes, and terminal publication, while the child server owns durable Session events.

<a id="further-exploration"></a>
## Further Exploration

- [Subagent subsystem](../../../../Docs/subsystems/subagent.md) — shared admission and lifecycle ownership.
- [Shared SDK runtime](../../../../Engine/subagent/sdk-runtime/README.md) — protocol client and Session API.
- [Agent Note](../../../../../.agents/notes/implemented/architecture/2026-10-08-native-sdk-external-child-runtime.md) — launcher and authority decisions.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the selected Native SDK server, which assembles child requests from the delegated prompt and granted tools and records the child Session.

#### KV Cache effect

Each child Session has its own request history; this adapter does not change provider cache behavior.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

These constraints determine which external-child requests this adapter can run and how much authority a child receives.

- **Prompt content** — text and durable image references are supported; other content blocks are rejected before launch.
- **Subagent capabilities** — persona, tool-filter passthrough, and structured output are unsupported, so the profile rejects those requests and cannot run Ralph.
- **Credentials** — the selected provider profile must name an `apiKeyEnv`; stored OAuth/API-key records and wholesale parent-environment inheritance are unsupported.
- **Write access** — `write_file` is available only when the exact parent grant, required approval, workspace-write root, and bound approval callback are all present.
- **Process confinement** — the backend retains its temporary-directory allowance, and Windows enforcement is partial where reported.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The Engine runtime owns one provider-neutral SDK protocol implementation; Programs retain the public SDK facade and fixed CLI resolver. TypeScript and Python SDK clients expose the server-to-client approval request and correlated decision. The parent Native Headless owner remains the sole approval authority and durable event writer. See the [Agent Note](../../../../../.agents/notes/implemented/architecture/2026-10-08-native-sdk-external-child-runtime.md) for the ownership decision.

</details>
