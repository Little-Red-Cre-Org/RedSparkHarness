---
description: "Native one-shot approval policy and answerer registry for profile-owned tool decisions."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-approval

English | [中文](README.zh.md)

## Summary

`dsh-native-approval` provides the native `approval` service. Its `ask` policy queries registered answerers in registration order, while `never` rejects without querying an answerer. An unanswered or failed request is unavailable, cancellation is cancelled, and only `allowed-once` permits the requested operation. The service accepts only the exact registered native Agent so a stale or substituted identity cannot decide a tool action.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The `./native` entry requires `agents`, provides `approval`, and accepts an optional `policy` of `ask` (the default) or `never`; unknown fields fail activation. `registerAnswerer()` registers an ordered callback. Returning `undefined` delegates to the next callback; a returned outcome decides the request. A rejected callback resolves the request as `unavailable`. The Session owner supplies a fresh request id after durably appending `native-approval/asked`; the Provider passes answerers an abort signal and waits for their work to settle during disposal.

The service returns the supplied id, policy, and closed outcome but does not write a Session. A consuming application durably records `native-approval/asked` before calling the service and durably records the matching `native-approval/decided` before it executes the approved operation. Native headless supplies that application path for fixed writes and protected native tool contributions.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the consuming native application that appends its approval audit and renders the resulting tool outcome into the Session.

#### KV Cache effect

The consuming application owns the retained error or ordinary tool result after an approval decision.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The Provider has no built-in terminal answerer, browser projection, or external protocol transport.
- Decisions are one-shot; it has no remembered grant, rule store, or revocation record.
- The Provider does not own Session persistence, tool schemas, or tool-result rendering.

No invariant companion is published because a policy decision has no independent durable observation before its application writes the audit pair.

<a id="dev-note"></a>
### Dev Note

None.
