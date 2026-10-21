---
description: "Shell Provider 共用的原生隔离与结果分类。"
kind: "package-reference"
---

# @deepseek-ai/dsh-shell-sandbox-core

[English](README.md) | 中文

## 概述

这个不依赖 Cordis 的库把选定的 sandbox 策略应用于 shell 命令参数，并报告执行保障、拒绝和 runner 故障事实。Bash 与 PowerShell Provider 各自提供命令参数和受管理的本地执行器。受限调用绝不回退为非隔离命令。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

`SandboxShellController` 需要受管理的本地 shell、进程 sandbox、策略 Provider 和语法参数构造器。前台调用先判断 runner 故障，再匹配拒绝信息；后台调用保留所选 runner 的事实，直到进程结算。只有解析后的策略明确选择 `danger-full-access`，全权限调用才绕过隔离 runner。

本包不发布不变式伴生入口，因为每个进程的 sandbox 事实都保存在所属控制器内，并在完成 promise 结算前写入。

<a id="model-experience"></a>
## 模型体验

间接通过 Bash 与 PowerShell 工具渲染这些隔离结果；本库不注册面向模型的贡献。

#### KV Cache 影响

无。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 本库需要语法 Provider，不能自行选择 runner 或命令可执行文件。

<a id="dev-note"></a>
### 开发备注

无。
