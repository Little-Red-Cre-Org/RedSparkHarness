# Agent Note: 原生发布中的可选兼容 peer

Status: implemented

[English](2026-10-05-native-publication-compatibility-peers.md) | 中文

## 问题

混合包可以同时发布纯原生入口与兼容入口。必需的兼容 peer 会让原生安装引入无关运行时包，即使所选入口从不导入这些包。

## 决策

[Fs](../../../../rsh/Modules/Official/fs/fs/README.zh.md) 将 invariants 和 plugin-host 声明为可选兼容 peer。[Session](../../../../rsh/Engine/core/session/README.zh.md) 将 scope 声明为可选 Cordis peer。[LLM](../../../../rsh/Engine/llm/llm/README.zh.md) 将 typert-protocol 声明为可选 peer 和开发依赖。这些包的纯原生入口不静态加载上述兼容运行时。所选兼容入口仍需要其实际 peer。

## 考虑过的替代方案

完全移除 peer 会丢失兼容依赖声明。保持必需会为原生 Consumer 安装无关兼容运行时。把实际原生依赖标为可选则会隐藏不完整安装；此决策只适用于已识别的兼容导入。

## 后果

原生运行时依赖保持不变。每个被原生入口静态导入的运行时包仍需要实际发布依赖声明。兼容部署提供其所选入口需要的 peer。
