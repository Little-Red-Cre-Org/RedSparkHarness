---
description: "Select an opt-in Native external-subagent route over ACP with the CLI's fixed same-version child launcher. Use it for bounded text and image work whose selected child route and file permissions remain governed by the parent Session."
kind: "package-reference"
---

# @deepseek-ai/dsh-acp-child

English | [中文](README.zh.md)

## Summary

Select the `dsh-acp-child` route for a Native one-shot child through the CLI-owned fixed launcher. Native Subagent may admit a selected child provider/model that differs from the parent's model route; the child must retain that exact selected child route, optional reasoning effort, and accepted execution limits. ACP returns opaque child text and provides no Responses transport or Native operation broker.

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

Select this package only from an explicit Native profile installation; the shipped `native-sdk` and `native-acp` profiles do not select it.

### When to choose it

Choose this route when a Native parent needs a separate ACP child whose requests stay opaque to the parent operation broker and whose filesystem authority comes from the exact parent Session. Use the [Native SDK child](../sdk-child/README.md) when the child must use the Engine-owned SDK transport instead.

### Native profile installation

Add this installation to a Native profile that has a visible pi-ai model Provider; the CLI supplies the `providers` catalog from that Provider. The installation alone does not select the driver: align the existing Native Subagent Provider and workflow consumers to the same driver name.

```json
{
  "id": "acp-child",
  "plugin": "@deepseek-ai/dsh-acp-child",
  "scope": "root",
  "config": { "providerName": "dsh-acp-child" }
}
```

| Existing installation | Config field | Value |
|---|---|---|
| `subagents` (`@deepseek-ai/dsh-native-subagent`) | `providerName` | `dsh-acp-child` |
| `workflow-worker` (if installed) | `subagentProvider` | `dsh-acp-child` |
| `ralph-tool` (if installed) | `subagentProvider` | `dsh-acp-child` |

Keep the workflow tool's `provider` set to its selected workflow engine. The `tool-subagent` Consumer uses the selected Native Subagent Provider directly and has no separate backend-provider field.

| Field | Requirement | Meaning |
|---|---|---|
| `providerName` | Required | Exact external-driver identity registered by this package; it is not a model-provider route. |
| `providers` | Required after CLI profile resolution | Non-secret route catalog keyed by exact `route.provider` entries from the nearest visible pi-ai Provider; the selected child route must match an entry and name an `apiKeyEnv`. |

The Native profile loader rejects a missing visible pi-ai Provider or an empty route catalog. Provider entries cannot contain `apiKey` or custom `headers`; the Host credential Provider resolves the selected environment-name reference.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Service Definition in `src/runtime.ts` describes the selected route, parent policy, child process lifetime, and fixed-profile launcher. `src/native.ts` consumes that launcher and registers the ACP driver. The CLI supplies the launcher from the [Program provider](../../../../Programs/CLI/src/native-acp-child-runtime-launcher.ts) and resolves the route catalog in the [Native profile loader](../../../../Programs/CLI/src/native-profile-loader.ts).

| Source | Responsibility |
|---|---|
| [`src/runtime.ts`](src/runtime.ts) | `NativeAcpChildRuntimeRequest`, `NativeAcpChildRuntime`, and `NativeAcpChildRuntimeLauncher` Service Definition |
| [`src/native.ts`](src/native.ts) | Official ACP Consumer and Native external-subagent driver |
| [`src/index.ts`](src/index.ts) | Public package exports |
| [CLI launcher](../../../../Programs/CLI/src/native-acp-child-runtime-launcher.ts) | Program-owned provider for the fixed child runtime |
| [CLI profile template](../../../../Programs/CLI/src/native-profile-template.ts) | Fixed `native-acp-dsh-child` composition without recursive child providers |

The CLI launches the same-version `dsh` executable with the fixed `native-acp-dsh-child` profile and a private generated patch. The request carries no executable or arbitrary argv. The child profile omits Native Subagent and workflow providers, so the child cannot start another child. The launcher explicitly injects the selected route credential, requires the canonical child cwd to be within the parent workspace, and creates a private DSH_HOME for that run.

The driver converts text and image prompt blocks to ACP, then requires the child to advertise and accept the exact selected child provider/model, reasoning effort, step/token ceilings, and permission mode. A child that cannot retain the selected route or an equal-or-stricter limit fails before prompt delivery. The result contains opaque ACP text; the driver does not use the Engine `request.model` Responses capability or publish any of the six `subagent/external-operation` facts: `model-request`, `model-response`, `model-failure`, `tool-call`, `tool-result`, and `tool-settlement`.

The child receives only parent-authorized builtin file tools. `write_file` is retained only when the exact child permission request matches the parent approval identity, the parent requires approval, the parent policy is `workspace-write`, and that builtin is admitted; otherwise the child runs with permission mode `deny` and no write tool. When write access is admitted, the canonical `workspaceWriteRoot` must equal the parent's sandbox workspace root. The launcher derives the child policy as `workspace-write` only when that write authority is admitted and otherwise uses `read-only`, then passes it to the shared `dsh-sandbox-local` ProcessSandbox. The child preserves its reported `full` or `partial` enforcement level. This level describes file-effect enforcement, not complete process isolation. The Windows ACL backend reports `partial`: Everyone access and NTFS hard-link aliases remain relevant, and the backend does not constrain reads, network access, or process visibility. If no backend is available or its runner fails, startup fails without an unconfined retry. See [sandbox-local policy and enforcement](../../sandbox/sandbox-local/README.md) and [Windows ACL limits](../../sandbox/sandbox-windows-acl/README.md).

Shutdown closes ACP and child stdio work and settles the complete managed process range before `dispose()` removes the private DSH_HOME. The package publishes no `./invariant` export because it has no independent registry or durable identity to compare: Native Subagent owns admission and parent Session writes, while the launcher runtime owns process cleanup.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Subagent subsystem](../../../../Docs/subsystems/subagent.md) — Native external-driver ownership and runtime types.
- [CLI profiles](../../../../Programs/CLI/README.md#profiles) — Native profile files and composition.
- [ACP policy protocol](../acp-protocol/README.md) — Versioned permission and execution-limit metadata.
- [Native Subagent package](../../../../Engine/subagent/native-subagent/README.md) — Parent admission and Session authority.
- [Native external-operation broker decision](../../../../../.agents/notes/implemented/architecture/2026-10-10-native-external-operation-broker.md) — Which external operations the Engine records.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Native Subagent route, which returns the child's opaque output through the delegated tool call.

#### KV Cache effect

Each launched child uses an independent ACP Session; this adapter does not reuse or alter the parent's request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The ACP route is bounded by the child server's negotiated capabilities and the parent Session's authority.

- **Prompt and result** — Text and images are accepted; other prompt block types fail, and the child returns opaque text.
- **Model operations** — The route has no Engine-owned Responses transport and emits none of the six `subagent/external-operation` facts.
- **File access** — `write_file` requires the exact parent approval relay and `workspace-write` policy; otherwise the child has no write tool.
- **Acceptance** — A Windows recorded-session snapshot launches the fixed child from the built product and records/replays one parent-approved `write_file` against an independent workspace oracle. It verifies exact child permission metadata and allow-once response, durable parent and child approval identities, per-route model ceilings, zero `subagent/external-operation` facts, and managed process/private-home cleanup. The platform matrix and complete ACP batch acceptance remain pending, so this integration remains an opt-in candidate.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The CLI-owned runtime interfaces and the ACP policy metadata are separate declarations; the CLI launcher starts only the fixed same-version profile. The [external-driver ownership decision](../../../../../.agents/notes/implemented/architecture/2026-10-08-native-external-subagent-driver.md) and [operation-broker decision](../../../../../.agents/notes/implemented/architecture/2026-10-10-native-external-operation-broker.md) own their respective rationale.

</details>
