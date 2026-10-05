---
description: "Native Web Session lifecycle over shared execution and browser transport."
kind: "package-reference"
---

# Native Web Session controller

English | [中文](README.zh.md)

## Summary

This Host Program contributes authenticated Session operations to the shared Connection and uses the selected native Agent and Session executor. The Web Host remains the application.

## Table of Contents

- [Reference](#reference)
- [Invariants](#invariants)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)

<a id="reference"></a>
## Reference

Configuration includes the native headless workspace, model, prompt and budgets plus required positive integer limits: maxPendingRequests, maxHistoryEvents and maxPromptChars. History rejects overflow instead of truncating it. Ordinary requests and cancellation/status requests have separate bounded admission so a full prompt queue does not prevent cancellation.

The Client Consumer owns list, blank creation, history, explicit fresh/resumed prompts, cancellation and status. Prompt success follows durable settlement; exact execution cancellation returns exitCode 130 after draining. A Session accepts one pending browser turn. Busy submissions reject instead of silently entering another queue. Live history uses the exact active writer; cold history closes its read handle before responding. Installation teardown withdraws routes, cancels requests and drains the executor.

Attachments, incremental following, questions, approvals, directory policies, title and fork controls are separate Consumers. This package does not provide those operations.

<a id="invariants"></a>
## Invariants

The selected executor owns writer exclusivity and Agent identity. This Program owns only transport admission; it introduces no independent Session state requiring a runtime invariant.

The CLI carries the native Web Host, Session controller and frontend static artifact package directly. The shipped native-web Host runtime directory resolves the frontend through that exact CLI installation. The frontend package publishes static dist files without runtime dependencies; its development Cordis graph is not installed as a runtime dependency.

<a id="dev-note"></a>
## Dev Note

The native Session executor owns persistence and Agents; this package owns transport operations only.

<a id="model-experience"></a>
## Model Experience

### Human input

#### What the model sees

Human text enters the native executor's durable inbox and normal Session model history. This Program adds no tools or hidden prompt sections.

#### Token effect

The `prompt` text submitted to `session/prompt` contributes ordinary user-message tokens to current and later resumed requests.

#### KV Cache effect

This package does not alter the history prefix; a new user message extends the request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Incremental event following, full product UI, attachments, approvals and question interactions are not provided by this package.
