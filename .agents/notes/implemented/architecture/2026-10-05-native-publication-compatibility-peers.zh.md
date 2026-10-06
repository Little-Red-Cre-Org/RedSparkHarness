# Agent Note: 原生发布中的可选兼容 peer

Status: implemented

[English](2026-10-05-native-publication-compatibility-peers.md) | 中文

## 问题

混合包可以同时发布纯原生入口与兼容入口。必需的兼容 peer 会让原生安装引入无关运行时包，即使所选入口从不导入这些包。

## 决策

[Fs](../../../../rsh/Modules/Official/fs/fs/README.zh.md) 将 invariants 和 plugin-host 声明为可选兼容对等依赖（peer dependency）。[Session](../../../../rsh/Engine/core/session/README.zh.md) 将 scope 声明为可选 Cordis 对等依赖。[LLM](../../../../rsh/Engine/llm/llm/README.zh.md) 将 typert-protocol 声明为可选对等依赖和开发依赖。[subagent 工具](../../../../rsh/Engine/subagent/tool-subagent/README.zh.md) 与 [terminal 工具](../../../../rsh/Modules/Official/terminal/tool-terminal/README.zh.md) 保留 Cordis 包根 API，但只在 `apply` 中加载兼容实现；原生入口与包根导入不会加载可选兼容对等依赖。[文件搜索](../../../../rsh/Modules/Official/fs/tool-fs-search/README.zh.md) 将 output-retention 与 timeout 声明为运行时依赖，并将权威 errors 包声明为必需对等依赖。[本地 spill](../../../../rsh/Modules/Official/spill/spill-local/README.zh.md) 保留 spill Definition 和 NativeRuntime 必需对等依赖，同时让 Cordis 保持可选。原生入口不静态加载兼容运行时；所选兼容入口仍需要其实际对等依赖。

## 考虑过的替代方案

完全移除 peer 会丢失兼容依赖声明。保持必需会为原生 Consumer 安装无关兼容运行时。把实际原生依赖标为可选则会隐藏不完整安装；有运行时代码导入或实现的运行库与 Provider Definition 仍必须声明为必需。

## 后果

普通对等依赖安装可让原生消费者从四个混合包的 tarball 安装而不带 Cordis。每个被原生入口静态导入的运行时包，以及每个被实现的 Provider Definition，仍需要真实发布依赖声明。兼容部署提供所选入口要求的可选对等依赖；subagent 与 terminal 入口会在兼容导入缺失时报告加载错误，并把原始错误保留为 cause。
