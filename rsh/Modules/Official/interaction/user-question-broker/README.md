---
description: "Pending human questions for authenticated native application transports."
kind: "package-reference"
---

# @deepseek-ai/dsh-user-question-broker

English | [中文](README.zh.md)

## Summary

Present a pending question to an authenticated application and accept its answer. An answer must reference the original Agent and broker-issued request id. Removing the last recipient cancels the question; removing the Provider drains all pending presentations. This package collects no terminal, SDK or browser input itself.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Select this package in a native profile together with `@deepseek-ai/dsh-user-questions`. Its `./native` entry requires `userQuestions` and provides `userQuestionBroker`; its configuration is empty. An application subscribes through `onRequest`, retaining the presented Agent, then submits JSON through `answer(id, agent, answer)`. Invalid choices fail without consuming the question; duplicate or late answers fail.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The entry forwards the single broker implementation in [user-questions](../user-questions/src/broker.ts). It adds a separately selectable Provider manifest, not another pending-request store. The question Definition authenticates live root ownership before selecting a scoped answerer. Provider removal cancels its accepted answers and awaits their settlement.

No runtime invariant companion is published: the broker owns one pending map and exposes no independent durable observation to compare against it.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Question Definition](../user-questions/README.md): exact execution ownership and shared protocol.
- [Model-facing tool](../tool-ask-user/README.md): recorded question results.
- [Native runtime](../../../../Core/runtime-diagnostics/native-runtime/README.md): installation ownership.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `ask_user_question`, whose accepted answers or cancellation errors are recorded by the Program as ordinary tool results.

#### KV Cache effect

No direct invalidation; the tool Consumer owns the visible schema and results.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A transport must subscribe before asking; without a recipient the broker delegates to another answerer.
- Live delegated invocations cannot ask. Historical child Sessions resumed as roots may ask.
- Authentication and routing belong to the consuming application; this Provider supplies no wire server or UI.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

See the [native human questions decision](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-human-questions.md).

</details>
