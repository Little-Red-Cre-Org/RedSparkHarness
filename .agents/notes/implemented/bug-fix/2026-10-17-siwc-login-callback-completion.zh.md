# Agent Note: SIWC 登录等待回调处理完成

Status: implemented

[English](2026-10-17-siwc-login-callback-completion.md) | 中文

## 问题

loopback callback 在 token exchange 和身份验证完成前就回复了浏览器，因此浏览器可能会报告登录成功，但登录随后失败。监听器关闭逻辑等待 `server.close()` 完成，而 Chrome 空闲的预连接套接字仍保持打开，导致登录完成延迟到 `requestTimeout`。

## 决策

callback 仅在 token exchange 和身份验证成功后才回复成功；失败时返回通用文本。监听器关闭时调用 `closeAllConnections()`，因此空闲套接字不会让 callback server 一直保持打开。此改动扩展了 [提供方决策](../architecture/2026-10-08-codex-siwc-provider.zh.md) 中描述的 SIWC 流程。

## 考虑过的替代方案

**在 token exchange 和身份验证前回复。**不采用，因为浏览器可能会在登录有效前显示成功。

**等待 `server.close()` 排空空闲连接。**不采用，因为 Chrome 的预连接套接字可能会让关闭等待到 `requestTimeout`。

## 后果

浏览器会等待 token exchange 和身份验证完成后才显示成功；失败文本不会暴露具体的身份验证错误。空闲浏览器连接不再延迟监听器关闭。

## 测试

空闲连接回归测试覆盖 callback 成功与失败两种情况；如果没有这项 SIWC 实现更改，这些测试会失败。
