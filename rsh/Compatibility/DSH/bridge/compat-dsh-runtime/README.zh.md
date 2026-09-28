---
description: "可选原生 Host 持有选定 DSH 兼容 bridge 共用的 Cordis Context。"
kind: "package-reference"
---

# @deepseek-ai/dsh-compat-dsh-runtime

[English](README.md) | 中文

## 概述

`dsh-compat-dsh-runtime` 是选定原生 DSH bridge 的可选 Cordis Host。它创建一个 Cordis Context，安装现有 plugin-host adapter，并且只挂载具名的一方插件。原生安装不包含此包时，不会导入兼容运行时。

## 配置

此原生插件不接受配置。Cordis 主版本必须为 4。挂载请求仅允许受支持 bridge 使用的一方 DSH 文件系统 Provider、观察策略、文件系统工具、系统提示词和工具注册表。未知包名会被拒绝。

每个挂载都通过 `dsh-plugin-host` 适配，由它持有 Cordis 子 Fiber 和 descriptor 注册。原生 bridge disposer 会等待插件卸载；启动失败时会释放部分启动的子插件并传播启动异常。Host 关闭时会释放并排空共享 Context。

## 已知限制

- 此包不会加载 Cordis Loader profile、旧应用 bundle 或任意 DSH 插件。
- 它不会让现有 Cordis 应用 profile 自动摆脱 Cordis；profile 组合必须只在原生兼容路径中选择此包。
- 当前支持的 adapter 覆盖文件系统能力组；新增 DSH 插件需要显式 manifest、配置映射和生命周期测试。
