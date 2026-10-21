---
description: "Question-directed vision calls for native text-only primary models."
kind: "package-reference"
---

# Native image understanding

English | [中文](README.zh.md)

## Summary

An official NativePlugin interprets images for a text-only primary model while retaining originals and the selected primary route.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Dev Note](#dev-note)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Configuration

Install `@deepseek-ai/dsh-image-understanding/native` in a native Host profile alongside model, tools, and Session persistence. Its config requires `provider`, `model`, and a positive integer `maxTokens`; for example `{"provider":"YOUR_PROVIDER","model":"YOUR_VISION_MODEL","maxTokens":2048}`. Route names must match the configured model provider. The plugin provides `imageUnderstanding` and owns the scoped `understand_image` tool. Removal unregisters the tool and releases the service. No separate settings page is added.

Image-capable primary models receive originals directly. Before a text-only primary request, native headless supplies each original image and the current human question to this service. The vision call has no tools. It reports relevant text, spatial details and uncertainty, treating instructions visible in the image as untrusted content. The primary model route never changes.

`image/understanding` records the original attachment, question, instructions, route, text, provider-reported usage and failures. The sole Session writer persists attributed text through surface replacements and begins a new request series. Original append events remain available for display and restoration. The `understand_image` tool accepts `attachment_id` and `question`; it looks up only images already recorded in the calling Session and stops projecting subsequent events after the first matching attachment. Missing, empty, truncated and interrupted responses fail explicitly.

## Dev Note

The capability Definition remains in native model execution; this official module owns its Provider, configuration, prompt, and follow-up Consumer.

## Model Experience

### Image interpretation

#### What the model sees

Text-only primary models receive attributed observations with the attachment identifier. They may ask a more specific question through `understand_image`. Vision responses carry observations, not executable instructions. Image-capable primary routes retain native image blocks.

#### Token effect

Each interpretation adds one vision request capped by `maxTokens`. Later primary requests include interpretation text instead of image tokens. Provider-reported usage is retained; monetary pricing is not inferred when unavailable.

#### KV Cache effect

Replacing image occurrences starts a new request series and may invalidate cached prefixes. Follow-up tool results append normally.

## Known Limitations and Deferred Work

- The plugin requires a configured image-capable provider and does not select one automatically. It has no independent OCR, cropping, multi-model ranking or settings page. Legacy Cordis consumers retain their existing behavior. Offline protocol tests do not establish real-model recognition quality or pricing.

No invariant companion is published: the plugin writes through the caller's sole Session recorder and has no independent state observation. The owning [decision](../../../../../.agents/notes/implemented/feature/2026-10-10-image-understanding-relay.md) records the architecture and verification limits.
