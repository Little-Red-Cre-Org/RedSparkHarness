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

Configuration includes the native headless workspace, model, prompt and budgets plus required positive integer limits: maxPendingRequests, maxHistoryEvents, maxPromptChars, maxFollowBufferBytes, maxFollowers and maxPendingHumanRequests. History rejects overflow instead of truncating it. Ordinary requests and cancellation/status requests have separate bounded admission so a full prompt queue does not prevent cancellation.

The Client Consumer owns list, blank creation, history, explicit fresh/resumed prompts, cancellation and status. Prompt success follows durable settlement; exact execution cancellation returns exitCode 130 after draining. A Session accepts one pending browser turn. Busy submissions reject instead of silently entering another queue. Live history uses the exact active writer; cold history closes its read handle before responding. Installation teardown withdraws routes, cancels requests and drains the executor.

Optional modelDirectory advertises model metadata and provider failures; modelSelection validates and records intent through the sole Session maintenance owner. Selection requests carry an exact durable revision and reject pending turns. Retained writers reserve idle Agent maintenance before directory resolution and durable selection; cold operations retain their existing maintenance admission. Optional agentPresets advertises installed compositions; rootExecution applies blank-root selection and awaits epoch cleanup. Missing selection Providers fail explicit mutation requests rather than substituting defaults.

Optional attachments and modelDirectory admit ordered raster uploads after resolving the effective next model inside root execution. The shared attachment Provider validates canonical encoding and batch limits; only durable references enter the user message. Authentication and complete Session history govern image reads, including inherited references. The endpoint rejects another workspace, absent references and oversized images, and returns verified raster bytes with exact media type and no-store headers. Directory policies, title and fork controls remain separate Consumers.

Optional following delivers accepted durable events and transient assistant text through authenticated POST `/api/native-session/follow`. Each admission permits one follower with its exact Session and admission identity. The unread SSE queue is byte-bounded; overflow cancels execution and fails settlement without masking an execution or cleanup failure. Disconnect releases the follower and its queue; turn ownership remains with the executor until settlement. Installation shutdown closes followers before draining execution.

A prompt first receives its exact admission identity and then awaits settlement. Caller cancellation before sending refuses admission; later cancellation requests Host drain for that identity and the Promise finishes only after durable settlement. Pending turns and settlement readers are separately bounded by maxPendingRequests; unclaimed results continue occupying slots. Installation shutdown cancels and drains all turns.

<a id="invariants"></a>

Optional approval and userQuestions Providers receive Web answerers only for exact active root turns owned by this Program. The executor captures that exact application owner before presentation or answer; matching Session ids alone never admit another Program's request. Human presentations are transient FIFO requests per turn with a global maxPendingHumanRequests limit. Answers require the authenticated Session, admission and presentation identities; stale or cancelled answers refuse. Existing Providers and tool consumers retain decision audit and result persistence. Teardown withdraws pending input before draining execution.

Optional Settings and Credentials Providers use the same authenticated `/api` Connection carrier. `settings/describe` returns only active namespaces whose owners published presentation metadata, with secret values removed and all schema defaults omitted; registration rejects secret fields hidden behind unsupported schema nodes. `settings/mutate` applies visible path edits against the displayed revision, rejects secret paths and reports stale writes as `native/settings-conflict`. Provider exception text is replaced with generic Settings or Credentials failures; revision conflicts retain only the namespace and expected/current revisions. Credential references come from those registered schemas; `credentials/describe` returns only configured/source/writable facts, while set and unset return acknowledgements without reading a value back. Browser authorization flows, opaque grant-record editing and the complete legacy plugin page are not provided.

## Invariants

The selected executor owns writer exclusivity and Agent identity. This Program owns only transport admission; it introduces no independent Session state requiring a runtime invariant.

Runtime entry chunks use the shared-* prefix declared by the publication manifest.

The CLI carries the native Web Host, Session controller and frontend static artifact package directly. The shipped native-web Host runtime directory resolves the frontend through that exact CLI installation. The frontend package publishes static dist files without runtime dependencies; its development Cordis graph is not installed as a runtime dependency.

<a id="dev-note"></a>
## Dev Note

The native Session executor owns persistence and Agents; this package owns transport operations only. Its optional modelSelection service preserves the selected Session model when installed.

<a id="model-experience"></a>
## Model Experience

### Human input

#### What the model sees

Human text and admitted image references enter the native executor's durable inbox and normal Session model history. The selected model Provider projects those references into image inputs. This Program adds no tools or hidden prompt sections.

#### Token effect

The `prompt` text submitted to `session/prompt` contributes ordinary user-message tokens to current and later resumed requests.

#### KV Cache effect

This package does not alter the history prefix; a new user message extends the request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Full product UI, file and audio uploads are not provided by this package.
