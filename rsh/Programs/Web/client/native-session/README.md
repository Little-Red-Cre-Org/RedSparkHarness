---
description: "Native Web Session lifecycle over shared execution and browser transport."
kind: "package-reference"
---

# Native browser Sessions

English | [中文](README.zh.md)

## Summary

This Cordis-free Client Consumer exposes the native Web Session lifecycle through the selected Connection RPC Provider.

The native profile selects this package through its `dsh.native` row and `./native` export; the legacy `dsh.client` module table does not load it. Production dependencies include packages referenced by the published declarations, but installing those packages does not activate their NativePlugins. The profile must still select the required Connection Provider; the package-selection and declaration-dependency decision is recorded in the [installation note](../../../../../.agents/notes/implemented/architecture/2026-10-06-native-web-profile-installation.md).

## Table of Contents

- [Reference](#reference)
- [Invariants](#invariants)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)

<a id="reference"></a>
## Reference

Select after client-connection in the native profile and configure a positive integer maxFollowBufferChars, limiting the SSE parser buffer. The clientNativeSession service supports list, create, history, prompt, cancel and status. A prompt requires an explicit resume boolean and completes after Host settlement. Caller cancellation aborts non-prompt requests; prompt cancellation awaits Host settlement. Host errors reject; decoded results validate their endpoint fields before reaching Consumers. The Consumer keeps no second Session cache or connection loop.

The `./list-types` export contains the neutral Host/Client wire row for stored Sessions. Its title projection stays beside the unchanged Session header and distinguishes resolved, absent and unavailable reads; the Host supplies it from durable title events.

Model controls decode the selected Host catalog and installed preset metadata. Model and preset mutations require the displayed durable revision and resolve after Host maintenance settles. A catalog does not restrict explicit model routes; the model Provider validates resolution. These methods own no selection cache.

The optional prompt observer follows accepted durable events and transient assistant text through the selected Connection Fetch response. The maintained eventsource-parser handles SSE framing. Event decoding uses the shared Session parser; missing terminal settlement, malformed frames or observer failure cancel the exact admission and await Host drain before rejection. Caller cancellation detaches following and still awaits durable settlement. A custom RPC carrier without response support rejects observed prompts before admission.

The same Consumer exposes `settingsDescribe`, revision-checked `settingsMutate`, `credentialsDescribe`, `credentialsSet` and `credentialsUnset` on the selected `/api` carrier. `settingsDescribe` returns the published namespace descriptors with request budgets supplied by the selected Host. The Settings page uses `maxCredentialRefsPerRead` for bounded credential batches and aggregates the results; it refuses edits above `maxSettingsOperations` before sending a mutation, because one revision-checked write stays atomic. The Host defaults these validated limits to 64 refs and 512 operations. Credential reads contain only presence, source and writability facts, and credential writes return acknowledgements without echoing their values. `NativeSessionRpcError` retains the Host code and conflict details for stale-write handling.

```ts type-equiv
/** Settings views and the Host-validated request budgets used by the Client. */
interface NativeSettingsDescription {
  /** Registered, redacted Settings namespaces. */
  readonly namespaces: readonly NativeSettingsDescriptor[]
  /** Per-request limits enforced by the selected Host. */
  readonly limits: {
    /** Maximum credential refs accepted by one read request. */
    readonly maxCredentialRefsPerRead: number
    /** Maximum operations accepted by one atomic Settings mutation. */
    readonly maxSettingsOperations: number
  }
}
```

Prompt uploads carry ordered encoded raster images; the Host admits them under its root owner. Advertised image limits come from the selected attachment Provider. Image reads send only a Session identity and recorded attachment identity, then validate response media type and byte length before returning a Blob.

`close()` cancels the Client's owned prompts and awaits their Host settlement replies; native installation teardown awaits this operation.

The published declarations reference native-runtime, client-connection, native-model-selection, agent-presets and brand, so those packages are production dependencies for type resolution. The shared Session package remains a peer because event validation and format interpretation use the application's same Session implementation.

A prompt first receives its exact admission identity and then awaits settlement. Caller cancellation before sending refuses admission; later cancellation requests Host drain for that identity and the Promise finishes only after durable settlement. Pending turns and settlement readers are separately bounded by maxPendingRequests; unclaimed results continue occupying slots. Installation shutdown cancels and drains all turns.

<a id="invariants"></a>

Following also carries transient approvals and question batches. answerHuman uses only this Consumer’s outstanding admission identity; the Host validates the pending root owner and input. Approval verdicts are one-shot allow or reject. Question answers preserve selected labels and custom text. These presentations do not become a second durable log.

## Invariants

No runtime invariant companion is published because the Client's per-session admission map and pending Promises correlate transport calls, cancellation and human answers with the exact Host admission; durable Session events and writer identity remain Host-owned, so the Client holds no second Session projection.

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
