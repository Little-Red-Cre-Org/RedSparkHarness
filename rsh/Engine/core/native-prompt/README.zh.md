---
description: "原生 profile 可在应用记录最终提示词前组装有序、可撤销的系统提示词 section。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-prompt

[English](README.md) | 中文

## 概述

`dsh-native-prompt` 为原生应用收集具名系统提示词 section。section 按数值顺序渲染，并以名称作为确定性的并列排序依据。应用决定结果文本出现的位置，并在 Session 中记录最终的模型可见提示词。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

`./native` 入口只接受空配置对象并提供 `promptSections`。同一注册作用域内重复 section 名称会在注册时失败。渲染选择消费作用域可见的贡献；后代同名 section 遮蔽祖先 section，兄弟作用域相互隔离。disposer 只移除创建它的 section，而 Provider 释放会移除所有剩余 section。

应用可以向 `render(scope)` 传入请求 Agent 的 scope。感知 scope 的贡献在选择可见声明时使用该精确 scope；忽略可选参数的贡献保持其行为。应用仍须在模型发送前记录组装后的文本。

<a id="model-experience"></a>
## 模型体验

注册表自身不发送文本。其 Consumer 在发出请求前渲染当前 section，并且必须先持久化完全组装的系统消息，才能让模型看到它。

#### KV Cache 影响

改变一个已渲染 section 会从首个变更 token 起改变系统消息前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- section 没有 locale 选择、用户界面展示或直接的 Session 写入者。
- 注册表不会自行加载旧提示词插件。

不发布 invariant companion，因为已渲染提示词的所有权仍归消费应用。

<a id="dev-note"></a>
### 开发备注

无。
