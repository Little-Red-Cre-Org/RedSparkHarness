---
description: "在分阶段迁移期间为选定原生运行时和兼容 profile 消费方提供显式 Cordis 适配器。"
kind: "package-group"
---

# DSH 兼容桥接

[English](README.md) | 中文

## 概述

兼容 bridge 让原生 profile 选择范围明确的 Cordis 贡献，而不加载旧应用 bundle，并把 profile 专用的 Cordis 接线留在 Engine owner 之外。运行时 bridge 保持原生 Agent、Session 和工具结果所有权不变，并随原生安装释放所挂载的插件。本组还拥有 Cordis 声明包，以及供旧 Cordis profile 使用的显式 Settings 适配器。

可选的 [`compat-dsh-runtime`](compat-dsh-runtime/README.zh.md) 为所选 bridge 持有一个共享 Cordis Context。原生安装计划不包含此包时，Cordis 不会加载。

[文件系统子系统](../../../Docs/subsystems/filesystem.zh.md)定义这些 bridge 所适配的共享操作和策略事件。

## 包

| 包 | 用途 |
|---|---|
| [`compat-dsh-runtime/`](compat-dsh-runtime/README.zh.md) | 可选共享 Cordis Context，并只挂载 allowlist 中的 DSH 插件 |
| [`compat-settings-definition/`](compat-settings-definition/README.zh.md) | Cordis Settings Context 与事件声明 |
| [`compat-settings-adapters/`](compat-settings-adapters/README.zh.md) | 面向选定 Engine 服务、由 owner 管理的 Cordis Settings 适配器 |
| [`compat-fs-local/`](compat-fs-local/README.zh.md) | 面向原生 Consumer 的本地文件系统 Provider |
| [`compat-fs-policy/`](compat-fs-policy/README.zh.md) | 面向原生事件的文件系统观察策略 |
| [`compat-fs-sandbox/`](compat-fs-sandbox/README.zh.md) | 要求策略的 sandbox 文件系统 Provider |
| [`compat-tool-fs/`](compat-tool-fs/README.zh.md) | 旧文件系统工具和提示词贡献 |
| [`subagent-codex/`](subagent-codex/README.zh.md) | 面向 Cordis 兼容 profile 的 Codex app-server 子 agent 适配器 |
