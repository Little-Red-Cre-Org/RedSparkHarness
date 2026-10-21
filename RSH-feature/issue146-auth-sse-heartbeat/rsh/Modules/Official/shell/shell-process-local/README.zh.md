---
description: "Bash 和 PowerShell shell Provider 共用的原生进程生命周期。"
kind: "package-reference"
---

# @deepseek-ai/dsh-shell-process-local

[English](README.md) | 中文

## 概述

这个不依赖 Cordis 的库负责本地 shell Provider 的请求预算解析、受管理的 subprocess 启动、前台超时分类和后台增量输出读取。Bash 与 PowerShell 各自选择可执行文件参数、超时原因和环境默认值。该库不注册 shell，也不提供面向模型的工具。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

`resolveConfig(input, label, extraFields)` 验证正有限数值的执行预算，并拒绝未知字段。Provider 向 `LocalShellController` 提供 `ShellDialect` 和受管理的 `subprocess` 服务。控制器先设置语法环境默认值，再叠加调用方环境，最后叠加可信的 `dshEnv`。前台运行分别报告超时和取消事实；后台句柄在受管理进程结束后结算。

本包不发布不变式伴生入口，因为 subprocess 服务负责进程归属和完成，而请求预算在构造控制器之前得到验证。

<a id="model-experience"></a>

输出观察回调使用每个流独立的 UTF-8 解码器处理现有捕获字节事件，取消或结束后停止发布。取消的后台句柄在结束前等待托管进程范围退出；清理失败使 `done` 拒绝。

## 模型体验

间接通过 Bash 与 PowerShell 工具渲染这些进程结果；本库不注册面向模型的贡献。

#### KV Cache 影响

无。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 本库需要语法 Provider 选择可执行文件，无法单独运行命令。

<a id="dev-note"></a>
### 开发备注

无。
