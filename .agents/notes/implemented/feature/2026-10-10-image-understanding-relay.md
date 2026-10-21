# Agent Note: Question-directed image understanding

Status: implemented

English | [中文](2026-10-10-image-understanding-relay.zh.md)

## Problem

Text-only primary models cannot inspect uploaded images or image tool results. Switching the entire task to a vision model changes the user's selected execution route, while a generic image caption can omit details needed for the task.

## Decision

The [official NativePlugin](../../../../rsh/Modules/Official/image/image-understanding/README.md) provides a vision-only interpreter through the native capability interface. Engine retains only that interface and the Program integration point. Native headless passes the current human question and original image, persists the interpretation, and replaces only model-visible image occurrences through existing Session surface operations. Original events remain available for presentation and follow-up questions. The configured primary route stays authoritative. Vision calls carry no tools, treat visible instructions as untrusted content, and record provider-reported usage separately from main-model output. Failures remain explicit.

## Evidence

Four parameterized Native Host composition cases cover direct vision input, text-only relay, a follow-up question using the original image, and a stream without a terminal finish. Durable history is reopened and reconstructed, and model routes and interpretation text have owner-local snapshots. These tests mock the external model provider. Live provider accuracy, pricing, and desktop interaction require separately configured credentials and are not inferred from these checks.

## Alternatives considered

Switching the primary model for the whole task changes the selected executor and its tool behavior. A single generic caption loses question-specific detail. The selected plugin instead keeps the primary route and allows repeated questions against the original.

## Consequences

Each interpretation adds a model call and latency. Text descriptions may omit visual detail, so the `understand_image` tool accepts a new question against a Session-owned original attachment. The first version uses one explicit vision route with a response token cap; it has no model selection framework, OCR pipeline, or automatic image cropping. Legacy Cordis entrypoints retain their existing image behavior.
