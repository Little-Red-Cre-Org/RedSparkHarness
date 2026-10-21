---
description: "原生 profile 可接收可撤销的工具贡献，同时应用仍保留唯一的持久 Session 结果记录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-tools

[English](README.md) | 中文

## 概述

`dsh-native-tools` 让原生 profile 添加可由模型调用的工具，而不添加第二个工具循环或 Session 写入者。每项贡献提供一个 schema 和执行函数，其 disposer 只移除该项贡献。执行时会收到精确的原生 Agent、Session 和取消信号。消费应用拥有工具调用校验，并且只记录一次返回结果。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

`./native` 入口只接受空配置对象。它要求 `agents` 并提供 `tools`；Consumer 必须在注册贡献前声明该服务。贡献可声明带有 reason 的 `approval`。其消费应用提供对应的 `authorize()` 回调；注册表会在 executor 前调用它，受保护贡献没有审批 authority 时会失败。重复 schema 名称会在激活期间失败，携带未注册 Agent 的调用会在执行前失败，释放时会清除其余注册项。

<a id="model-experience"></a>
## 模型体验

只有消费应用把 schema 放入请求时，注册表才会添加 schema。工具实现返回文本、结构化内容和可选错误元数据；应用把该结果转换为一个面向模型的 Session 事件。

#### KV Cache 影响

添加、移除或重排 schema 会改变消费应用选择的模型请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 注册表不解析模型参数、不渲染 UI，也不写入 Session 事件。
- 注册项限定于一个原生安装，不替代旧工具生命周期服务。

不发布 invariant companion，因为注册表没有超出其所属应用的独立持久化观测。

<a id="dev-note"></a>
### 开发备注

无。
