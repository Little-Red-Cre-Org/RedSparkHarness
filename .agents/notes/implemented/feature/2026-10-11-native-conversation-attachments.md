# Agent Note: Native conversation attachments reuse shared presentation

Status: implemented

English | [中文](2026-10-11-native-conversation-attachments.zh.md)

## Problem

The Native Web conversation could upload recorded images and render durable image references, but its composer did not provide a limit-aware picker, drag target, pending-image rail, or reusable lightbox presentation.

## Decision

`@deepseek-ai/dsh-client-ui-attachment` exposes its Cordis-free presentation components through `./native`, separate from its legacy `./client` plugin. `native-application` owns image selection, advertised-limit checks, localized rejection notices, image Blob URLs, and Host image reads. It uses the shared `AttachmentRail`, `DropOverlay`, `FileCard`, `MessageImage`, and `ImageLightbox` components. `MessageImage` retains a type-only reference to `@deepseek-ai/dsh-attachment/types`.

The composer admits only files whose media type and size fit the selected model's image limits, the per-message image count, and aggregate byte limit. Durable message images load through the selected Session's `loadImage(sessionId, image, signal)` operation; draft and loaded-image Blob URLs are revoked when their owners release them.

## Alternatives considered

- **Import the legacy attachment plugin into the Native application.** Its Cordis plugin entry owns legacy slots and would couple the Cordis-free Native Client package to the browser plugin lifecycle.
- **Rebuild the attachment visuals inside `native-application`.** This would duplicate the rail, drop overlay, image sizing, and lightbox behavior already maintained by `ui-attachment`.

## Consequences

- Native Web provides model-limited image picking, page-level dropping, removable thumbnails, and recorded-image previews through shared components.
- The Native application owns intake and Host reads; shared presentation components remain independent of Cordis, Session services, and Native application state.
- Generic files and broader resource management remain outside the Native composer.
