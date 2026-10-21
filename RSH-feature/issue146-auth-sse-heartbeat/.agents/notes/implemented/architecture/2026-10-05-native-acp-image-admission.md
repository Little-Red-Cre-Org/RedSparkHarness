# Agent Note: Native ACP image admission

Status: implemented

English | [中文](2026-10-05-native-acp-image-admission.zh.md)

## Problem

ACP image prompts need the same normalization, limits and durable references as other native Program inputs. Transport-local image storage would separate model input from Session reconstruction.

## Decision

The ACP carrier maps ordered text and configured raster-image blocks into the selected attachment Provider's existing batch admission. The shared root executor's `prepareMessage` callback checks the next durable model selection and prepares attachments under one execution owner before inbox append. Model selection cannot change between the image check and input admission. Invalid or unsupported input rejects before user-message admission. Existing executor cancellation and disposal retain preparation and execution until settlement.

Initialization advertises images only when attachment and model-directory Providers are installed. Capability advertisement does not override the selected model's declared input modalities. The Session stores admitted image references; model preparation resolves their caption and image bytes through the existing attachment lifecycle.

## Alternatives considered

Inline wire bytes without durable attachment references would prevent cold reconstruction. Separate ACP image decoding and limits would duplicate the selected Provider's policy. Advertising audio, embedded context or unavailable interaction channels would cause clients to depend on unsupported requests.

## Consequences

ACP accepts ordered text/image prompts through the explicit native profile while compatibility defaults remain unchanged. Audio, embedded content, MCP mounts, mutable model controls, human interaction and attachment presentation remain separate batches. The recorded model-input oracle checks the exact stored image bytes and generated caption, replacing only its verified temporary file path.
