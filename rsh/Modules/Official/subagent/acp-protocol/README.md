---
description: "Defines versioned Native ACP subagent metadata for execution limits and permission modes."
kind: "package-library"
---

# @deepseek-ai/dsh-acp-protocol

English | [中文](README.zh.md)

## Summary

Use this library to read and emit versioned Native ACP subagent metadata for execution limits and permission modes. It validates namespaced initialize and session/new metadata values; the consuming Program converts accepted ACP policy into the Engine's durable `execution/policy` event and owns transport, execution, and enforcement.

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

Use it in an ACP peer that reads or emits versioned subagent policy metadata; it provides no ACP transport or child execution.

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

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The versioned extension carries `maxSteps`, optional `maxTokens`, and a permission mode (`deny` or `parent-relay`); both limits must be positive safe integers. Readers reject unsupported versions and additional extension keys, while the metadata helpers preserve the namespaced ACP envelope.

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
