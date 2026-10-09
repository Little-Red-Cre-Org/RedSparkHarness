---
description: "Shared newline-delimited JSON-RPC transport over caller-owned Node streams for the SDK protocol and Codex app-server adapter."
kind: "package-library"
---

# @deepseek-ai/dsh-json-rpc-line

English | [中文](README.zh.md)

## Summary

`dsh-json-rpc-line` lets a caller exchange JSON-RPC requests, responses, and notifications over its own Node streams. The SDK protocol and Codex app-server adapter use the same transport without making either protocol own the other's messages. The caller owns stream and child-process lifetime.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The SDK client and server use this library for stdio framing; the Codex product driver uses it for app-server framing. A caller supplies readable and writable streams, calls `start()`, and closes the transport before releasing those streams. `close()` rejects pending requests and detaches listeners without destroying either stream.

```text
const transport = new JsonRpcLineTransport(input, output)
transport.start()
const result = await transport.request('method/name', {})
transport.close()
```

Wire error responses reject with `JsonRpcResponseError`, which retains the numeric code and optional data. See [`src/index.ts`](src/index.ts) for request cancellation, notification, flush, and handler behavior.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The transport decodes UTF-8 across byte chunks, dispatches complete newline-terminated frames, and correlates responses by generated request id. Each endpoint owns only its pending requests and listeners; the caller owns streams and process teardown.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Line framing, JSON-RPC dispatch, request correlation, and pending-request settlement |

No invariant companion is published because the transport has no independent state owner to compare against its own pending-request map.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Utility package map](../README.md) — other shared primitives.
- [SDK protocol](../../../Engine/subagent/sdk-protocol/README.md) — SDK method and notification types that use this transport.
- [Codex product driver](../../../Modules/Official/subagent/codex-app-server/README.md) — app-server methods carried over the same framing.

-----

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Caller-owned streams** — closing the transport never closes a child process or destroys the input and output streams.
- **No frame-size limit** — the transport buffers an incomplete line; callers must use trusted peers or bound input outside this library.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
