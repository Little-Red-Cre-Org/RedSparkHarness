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

The `./native` Provider accepts no configuration. Its `execute` call requires an open Session, turn and step numbers, `GenerateOptions`, and append/persist callbacks owned by the Session writer. The caller owns request construction, tool execution, turn closure, and storage lifetime. A model stream must end with one terminal `finish` and cannot emit more chunks afterward. A terminal error or aborted finish fails the step after recording the attempt.

Selected Model Providers can expose `resolveModel` for exact route metadata; an image tool refuses when that capability is absent. `NativeAdapterModel` forwards an actual LLM adapter with installation cancellation, retains accepted metadata and stream operations, and closes paused iterators during removal. A failed or cancelled next call closes and drains its iterator before rejecting with the original request error; iterator cleanup failures remain recorded for the shared close promise. This helper supplies no model catalog or settings authority.

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
