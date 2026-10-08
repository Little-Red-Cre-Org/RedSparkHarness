---
description: "Native model streaming and durable assistant events for a Session step."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-model-execution

English | [中文](README.zh.md)

## Summary

`dsh-native-model-execution` provides `modelExecution` to native Host profiles that install a streaming `model` Provider. A consumer supplies a Session step whose model-visible inputs are already persisted. The service streams one request, assembles its assistant message with the shared LLM assembler, and persists `assistant/message` before returning its terminal finish reason. A cancelled or invalid stream appends `assistant/attempt`; the caller's Session close path persists that partial record.

## Table of Contents

- [Configuration](#configuration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Configuration

The `./native` Provider accepts no configuration. Its `execute` call requires an open Session, turn and step numbers, `GenerateOptions`, and append/persist callbacks owned by the Session writer. The caller owns request construction, tool execution, turn closure, and storage lifetime. A model stream must end with one terminal `finish` and cannot emit more chunks afterward. A terminal error or aborted finish fails the step after recording the attempt, unless a recovery policy retries it.

Each request also supplies `rebuildOptions`, which derives fresh options from the current Session. When a recovery policy replaces the visible Session surface and requests a retry, the executor uses this callback before dispatch; prepared model controls must still match the refreshed options. This keeps the retry on the same selected route while using the replacement history.

`onRecovery(policy)` installs a recovery policy and returns its remover. After a failed attempt is recorded, policies receive the normalized failure, the route's retry policy and the Session writer callbacks. The retry policy comes from the model's `retryPolicy(provider)`, or the LLM runtime default when the model declares none. Later registrations run first; each policy may call `next()` at most once, and returning without it claims the failure. A `{ kind: 'retry' }` decision dispatches a fresh attempt for the same step. An adapter that throws is offered the same way; when no policy retries it, the original error is rethrown. A cancelled request is never offered for recovery.

An optional `onChunk` observer receives accepted stream chunks from this same dispatch. Observer failures interrupt the attempt and preserve its recorded partial stream; the observer creates neither another model request nor another writer.

Selected Model Providers can expose `resolveModel` for exact route metadata; an image tool refuses when that capability is absent. `NativeAdapterModel` forwards an actual LLM adapter with installation cancellation, retains accepted metadata and stream operations, and closes paused iterators during removal. A failed or cancelled next call closes and drains its iterator before rejecting with the original request error; iterator cleanup failures remain recorded for the shared close promise. This helper supplies no model catalog or settings authority. Its optional image-pricing operation forwards the same selected adapter’s existing synchronous pricing; adapters without declared pricing return no quote.

The `./model-directory` Definition and `NativeAdapterModelDirectory` expose advisory catalogs from the same selected adapter, without a default store. `prepareStep` binds resolved controls and dispatch to one Provider generation. Consumers persist that exact configuration before `execute`; a foreign prepared identity or different dispatch controls reject. The pure `./model-selection` leaf owns durable selection vocabulary and its history projection.

## Dev Note

No invariant companion is published: the service records the stream in its caller's Session and has no independent observation that could diverge from it.

## Model Experience

### Assistant stream

#### What the model sees

The returned assistant message is available to later requests only after its durable `assistant/message` event is flushed. A failed `assistant/attempt` stays outside model history.

#### Token effect

The service adds no input tokens. Later requests may include the committed assistant content.

#### KV Cache effect

The service does not alter the request prefix; any later cache effect follows the persisted assistant content.

## Known Limitations and Deferred Work

- The caller still owns the turn and step sequence. Native SDK and Web consumers remain to be migrated.
- The package manifest and the Session and LLM dependencies retain Cordis during the repository transition.
