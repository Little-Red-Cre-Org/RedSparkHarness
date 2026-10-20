---
description: "Native 的 standard 预设可以通过 Cordis 桥接运行随包发布的 Cordis persona 插件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-persona

[English](README.md) | 中文

## 概述

`dsh-native-persona` 是随包发布的 Cordis persona 插件的 Native 行。它通过 `dsh-cordis-bridge` 运行该插件，并发布把 Native 提示词注册表呈现为 Cordis `systemPrompt` 服务的翻译。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

该行接受 Cordis persona 配置：必需的 `prefix`、可选的 `suffix`，以及可选的 `complete` 和 `includeRuntimeContext`。它必须安装在能够读取 `promptSections` 的预设作用域里。Native 的 web 和 TUI 模板把它安装在 `standard` 作用域上。

`personaServices` 把 Native 提示词注册表翻译成 persona 插件所读的 Cordis 服务界面，并把 persona 段落登记在安装作用域上，而不是注册表根上。

<a id="model-experience"></a>
## 模型体验

前缀和后缀成为该预设作用域内代理的 persona 系统提示词段落。消费方应用渲染它们并记录组装后的提示词。

#### KV Cache effect

修改前缀或后缀会改变该预设作用域渲染出的系统提示词。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- `complete` 不会替换整份 Native 提示词。
- `includeRuntimeContext: false` 不会抑制 Native 的运行时上下文段落。

不发布 invariant 伴随包。提示词所有权仍属于消费方应用。

<a id="dev-note"></a>
### 开发备注

无。
