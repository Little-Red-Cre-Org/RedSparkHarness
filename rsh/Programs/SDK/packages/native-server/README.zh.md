---
description: "基于共享 Session 执行器的原生 SDK JSON-RPC 应用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-sdk-server

[English](README.md) | 中文

## 概述

显式选择的 `dsh --profile native-sdk` 应用通过标准输入输出提供现有的按行分帧 SDK JSON-RPC 方法：`initialize`、`session/prompt` 和 `shutdown`。它使用一个原生 Session 执行器处理具名 Session，发送已持久化的 `session.event` 通知和整个 Session 的 `session.status` 状态变化，并在关闭或输入结束时等待已接收的工作结束。TypeScript 与 Python 客户端仍默认使用 `sdk` profile；调用方需显式选择 `native-sdk`。

## 配置

Profile 设置 `systemPrompt` 和正整数 `maxSteps`。`initialize` 为当前进程选择一个工作目录、提供方、模型，以及可选的推理强度和输出 token 上限。每个 Session ID 同时只运行一个轮次；后续提示从该 Session 的持久日志恢复，包括进程重启之后。`session/prompt` 仅在收件箱回执持久化后返回消息 ID；在此之前的失败以 JSON-RPC 错误返回给两个 SDK 客户端。此阶段原生 SDK 仅接收非空文本内容块；内联图片输入和子 Agent 通知仍由兼容 SDK profile 提供。

## 开发备注

[原生 SDK 决策记录](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-sdk-session-execution.zh.md)说明了进程和 Session 的所有权选择。
