---
description: "在分阶段迁移期间为选定 Cordis 包提供显式原生运行时适配器。"
kind: "package-group"
---

# DSH 兼容桥接

[English](README.md) | 中文

## 概述

兼容 bridge 让原生 profile 选择范围明确的 Cordis 贡献，而不加载旧应用 bundle。每个 bridge 都保持原生 Agent、Session 和工具结果所有权不变，并随原生安装释放所挂载的插件。

可选的 [`compat-dsh-runtime`](compat-dsh-runtime/README.zh.md) 为所选 bridge 持有一个共享 Cordis Context。原生安装计划不包含此包时，Cordis 不会加载。

[文件系统子系统](../../../Docs/subsystems/filesystem.zh.md)定义这些 bridge 所适配的共享操作和策略事件。

## 包

| 包 | 用途 |
|---|---|
| [`compat-dsh-runtime/`](compat-dsh-runtime/README.zh.md) | 可选共享 Cordis Context，并只挂载 allowlist 中的 DSH 插件 |
| [`compat-fs-local/`](compat-fs-local/README.zh.md) | 面向原生 Consumer 的本地文件系统 Provider |
| [`compat-fs-policy/`](compat-fs-policy/README.zh.md) | 面向原生事件的文件系统观察策略 |
| [`compat-fs-sandbox/`](compat-fs-sandbox/README.zh.md) | 要求策略的 sandbox 文件系统 Provider |
| [`compat-tool-fs/`](compat-tool-fs/README.zh.md) | 旧文件系统工具和提示词贡献 |
