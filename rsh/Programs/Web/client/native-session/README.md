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

Install after client-connection with an empty configuration. The clientNativeSession service supports list, create, history, prompt, cancel and status. A prompt requires an explicit resume boolean and completes after Host settlement. Caller cancellation aborts its transport; installation cancellation also aborts outstanding calls. Host errors reject; decoded results validate their endpoint fields before reaching Consumers. The Consumer keeps no second Session cache or connection loop.

The shared Session package is a peer because event validation and format interpretation use the application's same Session implementation.

<a id="invariants"></a>
## Invariants

No independent state can diverge from the Host authority, so this package publishes no invariant installer.

<a id="dev-note"></a>
## Dev Note

The native Session executor owns persistence and Agents; this package owns transport operations only.

<a id="model-experience"></a>
## Model Experience

### Human input

#### What the model sees

Only submitted human text becomes model input through the Host executor; this package contributes no model tools or prompt sections.

#### Token effect

The `prompt` text submitted to `session/prompt` contributes ordinary user-message tokens to current and later resumed requests.

#### KV Cache effect

This package does not alter the history prefix; a new user message extends the request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Incremental event following, full product UI, attachments, approvals and question interactions are not provided by this package.
