# Agent Note: Native Web LlmError code passthrough

Status: implemented

English | [中文](2026-10-17-native-web-llm-error-code-passthrough.zh.md)

## Problem

The Host Session RPC catch-all replaced model `LlmError` codes with `native/session`, hiding stable failure codes from the Client.

## Decision

The [Host RPC handler](../../../../rsh/Programs/Web/api/native-web-session-controller/src/native.ts) forwards the model failure code while preserving the message and details. A model failure is an Error named `LlmError` that carries its own `failure` facts, so a copy from another package counts even though `instanceof` fails; its code comes from `normalizeLlmFailure`. A model failure that is a direct member of the turn's feed/execution `AggregateError` also forwards its code. Other errors retain the image or Session code. The [conversation error view](../../../../rsh/Programs/Web/client/native-application/src/conversation-error.tsx) still classifies the failure text because the conversation snapshot retains only that text.

## Alternatives considered

Keeping only `native/session` would hide stable model failure codes, and text matching cannot reliably recover them.

## Consequences

Model failure codes reach RPC consumers without changing displayed failure text. Image admission and non-model failures keep their existing codes.

## Verification

The existing [Host spec](../../../../rsh/Programs/Web/api/native-web-session-controller/tests/native.host.spec.ts) verifies nested aggregate messages, a direct `AUTH` code, an `AUTH` code wrapped in an `AggregateError`, a `QUOTA` code from a cross-package copy, and that a non-model error carrying a `failure` property keeps `native/session`.
