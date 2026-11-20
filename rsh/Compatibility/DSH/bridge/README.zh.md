---
description: "在分阶段迁移期间为选定原生运行时和兼容 profile 消费方提供显式 Cordis 适配器。"
kind: "package-group"
---

# DSH 兼容桥接

[English](README.md) | 中文

## 概述

兼容 bridge 让原生 profile 选择范围明确的 Cordis 贡献，而不加载旧应用 bundle，并把 profile 专用的 Cordis 接线留在 Engine owner 之外。它们保持原生 Agent、Session 和工具结果所有权不变，并随原生安装释放所挂载的插件。本组还拥有 Cordis 声明包，以及供旧 Cordis profile 使用的显式 Settings 适配器。

原生 profile 直接选择[文件系统子系统](../../../Docs/subsystems/filesystem.zh.md)的 Provider 和工具；本组不再桥接旧 DSH 文件系统插件。

## 包

| 包 | 用途 |
|---|---|
| [`compat-settings-definition/`](compat-settings-definition/README.zh.md) | Cordis Settings Context 与事件声明 |
| [`compat-settings-adapters/`](compat-settings-adapters/README.zh.md) | 面向选定 Engine 服务、由 owner 管理的 Cordis Settings 适配器 |
| [`subagent-codex/`](subagent-codex/README.zh.md) | 面向 Cordis 兼容 profile 的 Codex app-server 子 agent 适配器 |
