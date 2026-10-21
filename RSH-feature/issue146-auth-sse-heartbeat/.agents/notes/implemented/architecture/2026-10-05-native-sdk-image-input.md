# Agent Note: Native SDK image input

Status: implemented

English | [中文](2026-10-05-native-sdk-image-input.zh.md)

## Problem

The native SDK rejected encoded image blocks even though both clients and the selected model adapter already supported the shared wire and attachment vocabulary.

## Decision

The native SDK consumes the existing encoded-image protocol through the selected Attachment Provider. Admission validates and stores images before creating the user message; the existing Session executor records durable references. The shipped native-sdk profile installs local attachment storage, and both SDKs send ordered text and encoded image blocks through their existing run methods. The pi-ai Provider reads verified request variants from those references on every dispatch.

## Alternatives considered

Writing base64 into Session messages would bypass attachment validation and repeat upload bytes in history. A separate SDK image store would duplicate storage ownership and request transformation. Neither is required by the existing attachment capability.

## Consequences

Invalid uploads fail before the durable inbox receipt and model dispatch. Cold Session restores and forks retain image references and reuse the same attachment store. The selected model still owns image capability refusal. Caller-provided durable references and subagent notifications remain outside this native SDK slice. One existing recorded-session scenario drives both SDKs through upload rejection, image admission and cold image restoration.
