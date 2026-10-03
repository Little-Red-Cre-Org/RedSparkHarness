---
kind: upgrade-guide
description: The pi-ai 1.0 catalog replaces the DeepSeek Flash ID and updates the available ChatGPT models.
---

# Updating pi-ai model selections

English | [中文](guide.zh.md)

## Change

The pi-ai provider uses the installed pi-ai 1.0 catalog. The inherited DeepSeek Flash model ID is `deepseek-flash`, replacing `deepseek-v4-flash`. The ChatGPT catalog includes `gpt-6.1-sol`. An explicit `providers.<provider>.models` list replaces the inherited catalog and can hide new models.

## Migration

1. In `cordis.yml`, profile overlays and saved model selections, replace `deepseek/deepseek-v4-flash` with `deepseek/deepseek-flash` when using the inherited catalog. The `deepseek-v4-pro` ID remains unchanged.
2. Remove restricted `providers.openai-codex.models` lists to inherit the current ChatGPT catalog, or add the desired current IDs to the list.
3. Restart RSH, select `openai-codex/gpt-6.1-sol` in a new conversation and send a message using the existing ChatGPT login. Recorded Session generations remain unchanged.
