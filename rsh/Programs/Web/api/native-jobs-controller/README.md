---
description: "Expose Native background-job metadata to the browser through authenticated RPC and a live job feed."
kind: "package-reference"
---

# Native jobs controller

English | [中文](README.zh.md)

## Summary

The Native Web application can list a Session's background jobs and follow committed changes. Job rows omit the owning Agent object, which cannot cross the transport. The application must install the Native job registry and this controller.

## Table of Contents

- [Reference](#reference)
- [Invariants](#invariants)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="reference"></a>
## Reference

The Native Web profile installs this controller after the Native job registry. It requires the Host Connection, the Native agent registry, and the Native job registry.

`session/jobs/list` returns one row per job grouped by the Session that owns it. `/api/session/jobs/follow` is an authenticated Fetch route that sends an SSE baseline followed by upserted and removed rows. Each poll re-reads the registry at most once per second; the wait happens before the read, and an abort ends the feed at once.

`owner` is dropped deliberately: the browser keys on `sessionId`, and an Agent object cannot cross the transport. Everything else the registry reports is already plain data.

Failures use `native/jobs` with a generic message. The Client Consumer is `clientNativeSessionJobs` from [Native Session](../../client/native-session/README.md).

<a id="invariants"></a>
## Invariants

No runtime invariant companion is published because this controller reads the registry's committed job state without maintaining a second copy.

<a id="dev-note"></a>
## Dev Note

The Native job registry owns job state and cancellation. This package owns the authenticated browser projection.

<a id="model-experience"></a>
## Model Experience

### Native Host

#### What the model sees

Nothing from this package: `session/jobs/list` and `/api/session/jobs/follow` are browser-only RPCs and add no model-facing input or tools.

#### Token effect

No model request content is created here.

#### KV Cache effect

No model request content is created here.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The job registry publishes no change notification, so the feed polls and diffs instead of pushing. The browser contract does not depend on that: the `follow` frames stay the same if a subscription is added later.
- This controller only reads jobs; it does not cancel them.
