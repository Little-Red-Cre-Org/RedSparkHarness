---
description: "Native persona 行不依赖 Cordis 运行时，直接注册预设的提示词段落。"
kind: "package-reference"
---

# @redspark/rsh-native-persona

[English](README.md) | 中文

## 概述

`dsh-native-persona` 是预设 persona 文本的 Native 行。它直接在该预设作用域的提示词注册表上登记前缀和后缀段落，与 Cordis 的 `dsh-persona` 行共用同一个 owner。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

该行接受共享的 persona 配置：必需的 `prefix`、可选的 `suffix`，以及可选的 `complete` 和 `includeRuntimeContext`。它必须安装在能够读取 `promptSections` 的预设作用域里。Native 的 web 和 TUI 模板把它安装在 `standard` 和 `minimal` 作用域上。

`nativePromptSections` 通过共享的 `PersonaPromptSections` 协议呈现 Native 提示词注册表，并把 persona 段落登记在安装作用域上，而不是注册表根上。该行不导入任何 Cordis 包。

<a id="model-experience"></a>
## 模型体验

前缀和后缀成为该预设作用域内代理的 persona 系统提示词段落。消费方应用渲染它们并记录组装后的提示词。

#### KV Cache effect

修改前缀或后缀会改变该预设作用域渲染出的系统提示词。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- `complete` 会替换其余可见提示词段落。`native-headless` 把这段文本当作整份系统提示词。
- `includeRuntimeContext: false` 会抑制该 scope 及其后代 Agent 的系统提示词运行时上下文快照。

不发布 invariant 伴随包。提示词所有权仍属于消费方应用。

<a id="dev-note"></a>
### 开发备注

`@redspark/rsh-persona/native` 拥有两个 persona 段落、完整提示词策略和运行时上下文抑制。段落名称来自 `@redspark/rsh-system-prompt/sections`；本行提供 Native 注册表的顺序。Cordis 入口与这个 Native installer 在注册表适配对象和绑定返回 disposer 的方式上不同：Cordis 用 `ctx.effect`，这里用 `NativeContext.effect`。
