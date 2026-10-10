---
description: "Shared coded errors and diagnostic rendering without service dependencies."
kind: "package-library"
---

# @deepseek-ai/dsh-errors

English | [中文](README.zh.md)

## Summary

This dependency-free library owns `HarnessError`, `isHarnessError` and `errorChain`. Filesystem and model errors share one constructor identity. The LLM package re-exports these values for existing consumers and owns model-specific failure classification.

## Table of Contents

- [Use errors](#use-errors)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-errors"></a>
## Use errors

Extend `HarnessError` with a stable machine-readable code and optional standard `cause`. Route failures by code; `errorChain` renders messages, nested causes and aggregate members for diagnostics only, without repeating a cause already included in its wrapper message. It tolerates circular causes and hostile accessors. `isHarnessError` checks constructor identity, so plain objects and errors from another realm do not qualify.

No invariant companion is published: errors are ordinary values with no separately maintained service state.

<a id="model-experience"></a>
## Model Experience

None, as this library does not construct model requests; consumers choose where error diagnostics appear.

#### KV Cache effect

No request content is added or reordered.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Serialized errors require their owning transport's decoding. This package does not restore class identity across processes.

<a id="dev-note"></a>
### Dev Note

None.
