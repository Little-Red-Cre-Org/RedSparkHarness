# Agent Note: Official model integration ownership

Status: implemented

English | [中文](2026-10-06-official-model-integration-ownership.zh.md)

## Problem

The provider-neutral `dsh-llm` service and provider-specific adapters shared an Engine package group. The physical layout made upstream protocols and provider request metadata appear to be part of agent execution, even though the adapters implement official integrations. `dsh-session-log-deepseek` reads the canonical Session service to add request metadata and record delivery acceptance, but it does not own Session storage, format, or query behavior.

## Decision

Keep `dsh-llm`, `dsh-native-model-selection`, `dsh-llm-retry`, and `dsh-token-meter` in the Engine LLM group. Place `dsh-llm-deepseek`, `dsh-llm-pi-ai`, `dsh-deepseek-llm-api-extensions`, `dsh-plugin-package-inventory-deepseek`, and `dsh-session-log-deepseek` in `Modules/Official/llm`. Package names, public exports, and runtime composition remain unchanged. The two provider adapters already expose Cordis and Native faces; the three request-contribution packages remain Cordis-only, and this ownership move does not change their face support. The Session package continues to own its event-map root, persistence APIs, and format catalog; provider contributions extend the event map without taking those responsibilities.

## Alternatives considered

**Keep every LLM-related package under Engine.** This leaves official provider protocols grouped with provider-neutral execution and hides the ownership of request contributions.

**Keep `dsh-session-log-deepseek` with Session storage.** The package sends one provider-specific request field and its delivery event; it does not provide storage or querying and depends on the official DeepSeek request-extension registry.

**Rename the public packages to match the new directories.** Directory ownership can change without breaking package-name imports or published entry points.

## Consequences

New official provider adapters and their provider-specific request contributions belong under `rsh/Modules/Official/llm`. Provider-neutral routing, model selection, retries, token measurement, and Session storage remain in their Engine groups. The Cordis-only contributions still need a separate Native-support disposition under the P4 capability plan. Workspace references, generated package maps, and documentation must describe the physical locations while consumers continue using the existing package names.
