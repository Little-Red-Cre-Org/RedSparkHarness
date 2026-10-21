---
kind: upgrade-guide
description: pi-ai 1.0 目录替换了 DeepSeek Flash 的 ID，并更新了可用的 ChatGPT 模型。
---

# 更新 pi-ai 模型选择

[English](guide.md) | 中文

## 变更

pi-ai 提供商使用已安装的 pi-ai 1.0 目录。继承的 DeepSeek Flash 模型 ID 是 `deepseek-flash`，替换了 `deepseek-v4-flash`。ChatGPT 目录包含 `gpt-6.1-sol`。显式的 `providers.<provider>.models` 列表会替换继承的目录，并可能隐藏新模型。

## 迁移

1. 使用继承目录时，在 `cordis.yml`、profile overlay 和保存的模型选择中，将 `deepseek/deepseek-v4-flash` 替换为 `deepseek/deepseek-flash`。`deepseek-v4-pro` ID 保持不变。
2. 移除受限的 `providers.openai-codex.models` 列表以继承当前 ChatGPT 目录，或将所需的当前 ID 加入列表。
3. 重启 RSH，在新会话中选择 `openai-codex/gpt-6.1-sol`，使用已有的 ChatGPT 登录发送消息。已记录的 Session 代际保持不变。
