---
description: "Defines versioned Native ACP subagent metadata for execution limits and permission modes."
kind: "package-library"
---

# @deepseek-ai/dsh-acp-protocol

English | [中文](README.zh.md)

## Summary

Use this library to read and emit versioned Native ACP subagent metadata for execution limits, permission modes, and Native request identity. It validates namespaced initialize, session/new, and permission-request metadata; consuming Programs convert accepted policy to the Engine's durable `execution/policy` event and own transport, execution, and enforcement.

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

### When to use it

Use it in an ACP peer that reads or emits versioned subagent policy or permission-request identity metadata; it provides no ACP transport or child execution.

### Entry point

Pass the value of an ACP metadata object's `_meta` field to the policy reader. It returns `undefined` when the extension is absent and throws `TypeError` for malformed or unsupported data.

```ts
import { readNativeAcpSubagentPolicy } from '@deepseek-ai/dsh-acp-protocol'

const policy = readNativeAcpSubagentPolicy({
  'com.deepseek.ai/dsh-native-subagent': {
    version: 1, maxSteps: 8, permissionMode: 'deny',
  },
})
```

### Permission request identity

The `initialize` response advertises `capabilities.permissionRequestIdentity: true` in the `com.deepseek.ai/dsh-native-subagent` metadata. `readNativeAcpSubagentServerCapabilities(response._meta)` returns `undefined` when that extension is absent and throws `TypeError` for an unsupported version, extra keys, or invalid required capabilities.

Each `session/request_permission` request may carry version `1` metadata with `permissionRequest: { sessionId, requestId, toolName, toolCallId }`; all four fields are nonempty, trimmed strings.

`requestId` identifies the Native approval request persisted in `native-approval/asked` and `native-approval/decided`. `sessionId` identifies the actual Native interaction Session and may differ from outer ACP `params.sessionId`, which names the ACP recipient used for routing.

Use `readNativeAcpSubagentPermissionRequest(params._meta)` to read the metadata; it returns `undefined` when absent and throws `TypeError` for malformed or unsupported versions, missing or invalid fields, or extra keys. The fields correlate an RPC with a durable request and grant no permission; see the [Native ACP server](../../../../Programs/ACP/packages/native-acp/README.md) for enforcement.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The versioned session policy carries positive-safe-integer `maxSteps`, optional positive-safe-integer `maxTokens`, and `permissionMode` (`deny` or `parent-relay`). Initialize capabilities advertise implemented server behavior, and permission requests carry exact Native operation identities. Readers reject unsupported versions and extra keys while metadata helpers preserve the namespaced ACP envelope.

| Source | Responsibility |
|---|---|
| `src/protocol.ts` | Versioned metadata types, validation, and encoding. |
| `src/index.ts` | Public re-export. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Subagent reference](../../../../Docs/subsystems/subagent.md) documents ownership and Native external-driver types.
- [Native ACP server](../../../../Programs/ACP/packages/native-acp/README.md) documents the program that consumes this protocol library.

-----

<a id="model-experience"></a>
## Model Experience

None, as this metadata library validates control values and does not construct model requests.

#### KV Cache effect

ACP metadata does not enter model requests or change their cacheable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- No runtime invariant companion is published because the library validates and encodes ACP metadata but owns no execution state to compare; the consuming Program owns durable-event conversion, execution limits, permission enforcement, Session persistence, and external child transport.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
