---
description: "Shared safe terminal transcript presentation."
kind: "package-library"
---

# @deepseek-ai/dsh-terminal-ui

English | [中文](README.zh.md)

## Summary

This library renders user messages, assistant streams and tool results. Native and compatibility terminals share its Ink rows and terminal-control filtering. Callers supply localized copy and completed messages; the library does not run an Agent.

## Table of Contents

- [Use and configuration](#configuration)
- [Implementation](#implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Use and configuration

The dependency entry exports `ChatRow`, `StreamBlock`, the typed `computeViewport` line estimate and text helpers. `./presentation` also exports the compatibility terminal’s `App`, `ResumePicker` and existing helpers; `./utilities` exports terminal color and control-character helpers. This library is not a profile plugin; callers own Ink mounting and disposal. Transcript rows receive [typed copy](src/copy.ts) through `copy`, with English compatibility copy when omitted.

<a id="implementation"></a>
## Implementation

<details>
<summary>Implementation internals</summary>

The [presentation](src/ui.js) retains compatibility formatting and safe filtering; [helpers](src/utils.js) remain pure. MIT attribution is retained in [LICENSE](LICENSE). No invariant companion is published: the library has no independent mutable service state.

</details>

<a id="model-experience"></a>
## Model Experience

None, as this library only renders caller-supplied text and does not alter model requests.

#### KV Cache effect

Presentation and input admission do not rewrite recorded model prefixes; the executor owns cache-relevant request changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The complete `App` expects compatibility interaction interfaces; the native application consumes only shared transcript rows.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
