---
description: "Native Web Session lifecycle over shared execution and browser transport."
kind: "package-reference"
---

# Native browser Sessions

English | [中文](README.zh.md)

## Summary

This Cordis-free Client Consumer exposes the native Web Session lifecycle through the selected Connection RPC Provider.

## Table of Contents

- [Reference](#reference)
- [Invariants](#invariants)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)

<a id="reference"></a>
## Reference

Install after client-connection with required positive integer maxFollowBufferChars, limiting the SSE parser buffer. The clientNativeSession service supports list, create, history, prompt, cancel and status. A prompt requires an explicit resume boolean and completes after Host settlement. Caller cancellation aborts non-prompt requests; prompt cancellation awaits Host settlement. Host errors reject; decoded results validate their endpoint fields before reaching Consumers. The Consumer keeps no second Session cache or connection loop.

Model controls decode the selected Host catalog and installed preset metadata. Model and preset mutations require the displayed durable revision and resolve after Host maintenance settles. A catalog does not restrict explicit model routes; the model Provider validates resolution. These methods own no selection cache.

The optional prompt observer follows accepted durable events and transient assistant text through the selected Connection Fetch response. The maintained eventsource-parser handles SSE framing. Event decoding uses the shared Session parser; missing terminal settlement, malformed frames or observer failure cancel the exact admission and await Host drain before rejection. Caller cancellation detaches following and still awaits durable settlement. A custom RPC carrier without response support rejects observed prompts before admission.

The same Consumer exposes `settingsDescribe`, revision-checked `settingsMutate`, `credentialsDescribe`, `credentialsSet` and `credentialsUnset` on the selected `/api` carrier. Settings descriptors are limited to explicitly published namespaces; credential reads contain only presence, source and writability facts, and credential writes return acknowledgements without echoing their values. `NativeSessionRpcError` retains the Host code and conflict details for stale-write handling.

Prompt uploads carry ordered encoded raster images; the Host admits them under its root owner. Advertised image limits come from the selected attachment Provider. Image reads send only a Session identity and recorded attachment identity, then validate response media type and byte length before returning a Blob.

`close()` cancels the Client's owned prompts and awaits their Host settlement replies; native installation teardown awaits this operation.

The shared Session package is a peer because event validation and format interpretation use the application's same Session implementation.

A prompt first receives its exact admission identity and then awaits settlement. Caller cancellation before sending refuses admission; later cancellation requests Host drain for that identity and the Promise finishes only after durable settlement. Pending turns and settlement readers are separately bounded by maxPendingRequests; unclaimed results continue occupying slots. Installation shutdown cancels and drains all turns.

<a id="invariants"></a>

Following also carries transient approvals and question batches. answerHuman uses only this Consumer’s outstanding admission identity; the Host validates the pending root owner and input. Approval verdicts are one-shot allow or reject. Question answers preserve selected labels and custom text. These presentations do not become a second durable log.

## Invariants

No independent state can diverge from the Host authority, so this package publishes no invariant installer.

<a id="dev-note"></a>
## Dev Note

The native Session executor owns persistence and Agents; this package owns transport operations only.

<a id="model-experience"></a>
## Model Experience

### Human input

#### What the model sees

Submitted human text and admitted durable image references become model input through the Host executor; this package contributes no model tools or prompt sections.

#### Token effect

The `prompt` text submitted to `session/prompt` contributes ordinary user-message tokens to current and later resumed requests.

#### KV Cache effect

This package does not alter the history prefix; a new user message extends the request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Full product UI, file and audio uploads are not provided by this package.
