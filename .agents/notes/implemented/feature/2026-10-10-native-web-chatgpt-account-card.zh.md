# Agent Note: Native Web ChatGPT 账户卡

Status: implemented

[English](2026-10-10-native-web-chatgpt-account-card.md) | 中文

## 问题

原生 Web Settings 页面可以启动 Host 允许的 ChatGPT 登录流程，但没有显示套餐、额度窗口或 credits。

## 决策

Accounts 区域把 Host 投影的每个 `openai-codex` 账户显示为 ChatGPT 账户卡。页面只通过原生账户 API 读取身份和用量，不处理 OAuth 值。每个额度窗口显示经过限制的剩余百分比及本地化重置时间。用量读取失败时保留上次 ready 结果并显示过期提示；从未读到 ready 结果时显示不可用。signed-out 结果会清除旧用量。

账户卡为匹配的 credential key 内嵌现有 `AuthorizationRow`。退出登录会调用 Host 账户操作，再重新读取账户和授权条目；授权结算也会重新读取两者。通用 Settings 与 Credentials 的所有权仍遵循[原生 Settings 决策](../architecture/2026-10-06-native-web-settings-credentials.zh.md)。

## 考虑过的替代方案

**在账户卡中实现 ChatGPT 登录控件。**现有授权行已经拥有提示、帧和取消流程；新增流程会重复其生命周期。

**用量刷新失败后清空额度。**读取失败不代表 Provider 报告剩余额度为零；保留上次结果可明确区分两者。

## 后果

账户卡只显示 ChatGPT 套餐用量和 credits，不增加 DeepSeek 余额或模型选择控件。重置时间遵循浏览器区域设置，保留的用量在后续成功读取前可能过期。

## 测试

原生 Settings 页面 spec 检查套餐与剩余额度的正常显示，并验证刷新失败时保留上次结果且显示过期提示。
