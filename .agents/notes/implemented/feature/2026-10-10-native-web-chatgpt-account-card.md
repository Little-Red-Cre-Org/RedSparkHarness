# Agent Note: Native Web ChatGPT account card

Status: implemented

English | [中文](2026-10-10-native-web-chatgpt-account-card.zh.md)

## Problem

The native Web Settings page could start the allowlisted ChatGPT login but did not show its plan, quota windows or credits.

## Decision

The Accounts section renders each Host-projected `openai-codex` account as a ChatGPT card. It reads identity and usage only through the native account APIs and never handles OAuth values. Each quota window shows clamped remaining percent and a localized reset time. A failed usage read keeps the last ready result and shows a stale hint; without a ready result the card shows unavailable. A signed-out result clears old usage.

The card embeds the existing `AuthorizationRow` for the matching credential key. Sign-out calls the Host account operation, then reloads accounts and authorization entries; authorization settlement also reloads both. Generic Settings and Credentials ownership remains as recorded in the [native Settings decision](../architecture/2026-10-06-native-web-settings-credentials.md).

## Alternatives considered

**Build ChatGPT login controls into the card.** The existing authorization row already owns prompts, frames and cancellation, so another flow would duplicate its lifecycle.

**Clear quota values after a failed refresh.** A read failure does not mean the provider reported zero remaining quota; retaining the last result makes that distinction visible.

## Consequences

The card presents ChatGPT plan usage and credits only. It adds no DeepSeek balance view or model selection controls. Reset times follow the browser locale, and a retained usage result can be stale until a later successful read.

## Testing

The native Settings page spec checks ready plan and remaining quota rendering, and verifies that a failed refresh preserves the last result with a stale hint.
