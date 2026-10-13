# Agent Note: Native ACP child runtime

Status: implemented

English | [中文](2026-10-13-native-acp-child-runtime.zh.md)

## Problem

The Native Subagent can consume an external driver, but an ACP child does not carry the Engine-owned SDK Session protocol or model-operation broker facts. The adapter also must not choose its own executable, child profile, or process policy.

## Decision

The Official `dsh-acp-child` adapter consumes `NativeExternalSubagentDriver` and the `NativeAcpChildRuntime*` Service Definition. The CLI provides the launcher and starts only the same-version `native-acp-dsh-child` profile. A parent profile must install the adapter explicitly; the shipped `native-sdk` and `native-acp` profiles do not select it.

The CLI derives a non-secret route catalog from the nearest visible pi-ai Provider. The adapter's `providerName` identifies the external driver, while `providers` is keyed by exact model-route provider. Native Subagent may select a child provider/model that differs from the parent's model route under parent admission; the child must retain that exact selected child route, optional reasoning effort, accepted step/token ceilings, and negotiated permission mode before it receives a prompt. The adapter accepts text and image prompts and returns opaque ACP text; it does not use Engine `request.model` Responses transport or publish the six `subagent/external-operation` broker facts.

The launcher accepts no caller-selected executable or arbitrary argv, explicitly injects the selected route credential, requires the canonical child cwd to be within the parent workspace, and omits Native Subagent and workflow providers from the child profile. It derives the child policy as `workspace-write` only when the exact parent approval relay and admitted builtin `write_file` have parent `workspace-write` authority; otherwise it derives `read-only`. When writes are admitted, the canonical `workspaceWriteRoot` must equal the parent sandbox workspace root. Child file writes still require the exact approval identity, an approval-required parent, `workspace-write` authority, and the admitted builtin `write_file`; otherwise the child has no write tool. The runtime preserves the backend-reported `full` or `partial` file-effect enforcement. Windows ACL enforcement is `partial` and does not constrain reads, network access, or process visibility; unavailable or failed runners do not fall back to unconfined launch. See the [sandbox-local policy](../../../../rsh/Modules/Official/sandbox/sandbox-local/README.md) and [Windows ACL limits](../../../../rsh/Modules/Official/sandbox/sandbox-windows-acl/README.md). Shutdown settles the whole managed process range before private DSH_HOME removal.

## Consequences

- ACP remains an opt-in opaque child route; it does not claim SDK Session, Responses, or Native operation-broker semantics.
- The CLI owns fixed-profile process launch, while the parent Native Session remains the source of route, permission, and approval authority.
- A Windows recorded-session snapshot launches the fixed child from the built product and records/replays one parent-approved `write_file` against an independent workspace oracle. It verifies durable parent and child approval identities, route ceilings, zero external-operation facts, and process/private-home cleanup. The platform matrix and complete acceptance remain pending, so ACP stays an opt-in candidate; the package README owns current limitations.

## Alternatives considered

- **Reuse the SDK child runtime** — rejected because ACP keeps its own child protocol and returns opaque text rather than the Engine-owned SDK Session and operation stream.
- **Let the Official adapter choose an executable and argv** — rejected because the CLI must own same-version profile selection and whole-process-range cleanup.
- **Enable the adapter in a shipped profile** — rejected because this route lacks the Native Responses and broker facts expected by those profiles; the Windows recorded-session snapshot covers one parent-approved file write, while complete platform acceptance remains pending.

## Related decisions

- [Native SDK external child runtime](2026-10-08-native-sdk-external-child-runtime.md) records SDK child ownership and its protocol semantics.
- [Native external-subagent driver ownership](2026-10-08-native-external-subagent-driver.md) records the shared Native driver seam.
- [Native external-operation broker](2026-10-10-native-external-operation-broker.md) records the six broker facts.
